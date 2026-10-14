import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { passwordWorkGate } from './resource-gate.mjs';
// Mac screening: 232 MiB process peak with real Covers pipeline, concurrency one.
// Production CPU latency / cgroup validation remains an explicit rollout check.
export const ARGON2_PROFILE = Object.freeze({ memory: 65536, passes: 3, parallelism: 1, tagLength: 32 });
const derive = promisify(argon2);
const gate = passwordWorkGate;
const weak = new Set(['passwordpassword','password123456','123456789012','1234567890123','12345678901234','123456789012345','1234567890123456','qwertyuiopasdf','qwertyuiopasdfgh','letmeinletmein','changemeplease','iloveyou12345','adminadminadmin','парольпароль']);
export function validatePassword(value, repeat) {
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length < 12 || [...value].length > 128 || Buffer.byteLength(value) > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw Object.assign(Error('INVALID_PASSWORD'), { status: 400 });
  if (repeat !== undefined && value !== repeat) throw Object.assign(Error('PASSWORD_MISMATCH'), { status: 400 });
  const folded = value.toLowerCase();
  if (weak.has(folded) || /^(.)\1+$/u.test(value)) throw Object.assign(Error('COMMON_PASSWORD'), { status: 400 });
  return value;
}
export async function passwordHash(password) {
  validatePassword(password);
  return gate.run(async () => {
    const salt = randomBytes(16);
    const hash = await derive('argon2id', { ...ARGON2_PROFILE, message: Buffer.from(password), nonce: salt });
    return `argon2id$v=19$m=65536,t=3,p=1$${salt.toString('hex')}$${hash.toString('hex')}`;
  });
}
export async function passwordMatches(password, encoded) {
  if (typeof password !== 'string' || !password.isWellFormed() || [...password].length > 128 || Buffer.byteLength(password) > 1024) return false;
  // Explicit allowlist: corrupt DB parameters cannot request unbounded native memory.
  const match = /^argon2id\$v=19\$m=65536,t=3,p=1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded || '');
  if (!match) throw Error('Unsupported password hash');
  return gate.run(async () => {
    const hash = await derive('argon2id', { ...ARGON2_PROFILE, message: Buffer.from(password), nonce: Buffer.from(match[1], 'hex') });
    return timingSafeEqual(hash, Buffer.from(match[2], 'hex'));
  });
}
