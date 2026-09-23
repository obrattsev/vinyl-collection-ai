import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { OperationError } from './record-operations.mjs';

const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const DAY = 86400000;
const token = () => randomBytes(32).toString('hex');
const pattern = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password) > 1024) throw Error('Use a password of 16–1024 bytes');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
export function authConfiguration(env) {
  const production = env.NODE_ENV === 'production';
  if (!['production', 'development', undefined].includes(env.NODE_ENV)) throw Error('Invalid configuration');
  let origin;
  try { origin = new URL(env.APP_ORIGIN); } catch { throw Error('Invalid configuration'); }
  if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password ||
      (production ? origin.protocol !== 'https:' : !['http://127.0.0.1', 'http://localhost'].includes(`${origin.protocol}//${origin.hostname}`))) throw Error('Invalid configuration');
  return { passwordHash: env.OWNER_PASSWORD_HASH, origin: origin.origin, production };
}

// Fixed windows, bounded memory, both per-peer and aggregate ceilings. Never trust forwarded headers.
export function createLimiter({ limit, total, windowMs, now = Date.now }) {
  const peers = new Map(); let global = { count: 0, until: 0 };
  return key => {
    const time = now();
    if (time >= global.until) { global = { count: 0, until: time + windowMs }; peers.clear(); }
    const count = peers.get(key) || 0;
    if (count >= limit || global.count >= total) return Math.max(1, Math.ceil((global.until - time) / 1000));
    peers.set(key, count + 1); global.count++; return 0;
  };
}
export function createAuth({ passwordHash, origin, production = false, now = Date.now } = {}) {
  const match = pattern.exec(passwordHash || '');
  if (!match || (production && !origin?.startsWith('https://'))) throw Error('Invalid authentication configuration');
  const sessions = new Map(); let verifying = false;
  const cookieName = production ? '__Host-vinyl_session' : 'vinyl_session';
  const loginLimit = createLimiter({ limit: 5, total: 30, windowMs: 15 * 60000, now });
  const readLimit = createLimiter({ limit: 60, total: 300, windowMs: 60000, now });
  const cookie = (id, seconds) => `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${production ? '; Secure' : ''}`;
  function idFrom(req) {
    const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${cookieName}=`));
    if (values.length !== 1) return null;
    const id = values[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(id) ? id : null;
  }
  function prune() {
    const time = now();
    for (const [id, session] of sessions) if (time >= session.created + 7 * DAY || time >= session.seen + DAY) sessions.delete(id);
  }
  function session(req) {
    prune(); const found = sessions.get(idFrom(req));
    if (found) found.seen = now();
    return found || null;
  }
  return {
    session,
    describe: s => s ? { role: 'owner', csrfToken: s.csrf, expiresAt: s.created + 7 * DAY } : { role: 'guest' },
    checkOrigin(req) {
      const expected = origin || `http://127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== new URL(expected).host || req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') throw new OperationError(403, 'FORBIDDEN');
    },
    requireOwner(req, s) {
      if (!s) throw new OperationError(401, 'AUTH_REQUIRED');
      if (req.headers['x-csrf-token'] !== s.csrf) throw new OperationError(403, 'FORBIDDEN');
    },
    limit(req, kind, res) {
      const retry = (kind === 'login' ? loginLimit : readLimit)(req.socket.remoteAddress || 'unknown');
      if (retry) { res.setHeader('Retry-After', retry); throw new OperationError(429, 'RATE_LIMITED'); }
    },
    async login(req, res, input) {
      if (!input || Object.keys(input).length !== 1 || typeof input.password !== 'string' || Buffer.byteLength(input.password) > 1024) throw new OperationError(400, 'INVALID_REQUEST');
      if (verifying) { res.setHeader('Retry-After', '1'); throw new OperationError(429, 'RATE_LIMITED'); }
      verifying = true;
      let valid;
      try { valid = timingSafeEqual(await derive(input.password, match[1], 64, options), Buffer.from(match[2], 'hex')); }
      finally { verifying = false; }
      if (!valid) throw new OperationError(401, 'INVALID_CREDENTIALS');
      prune(); sessions.delete(idFrom(req));
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
      const id = token(); const s = { csrf: token(), created: now(), seen: now() }; sessions.set(id, s);
      res.setHeader('Set-Cookie', cookie(id, 7 * DAY / 1000));
      return this.describe(s);
    },
    logout(req, res) { sessions.delete(idFrom(req)); res.setHeader('Set-Cookie', cookie('', 0)); return { role: 'guest' }; }
  };
}
