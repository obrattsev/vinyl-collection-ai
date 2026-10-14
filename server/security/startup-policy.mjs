import { backendConfiguration } from '../postgres/config.mjs';
export function validateAuthStartup(env, { ledger, mail } = {}) {
  for (const name of ['AUTH_REGISTRATION_ENABLED','AUTH_LEGACY_ENABLED']) {
    if (env[name] !== undefined && !['true','false'].includes(env[name])) throw Error('Invalid auth boolean configuration');
  }
  if (env.NODE_ENV !== 'production') return;
  if (backendConfiguration(env).backend !== 'postgres' || env.AUTH_MODE !== 'multiuser') throw Error('Production auth requires PostgreSQL multiuser configuration');
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN || origin.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(origin.hostname)) throw Error('Production auth requires HTTPS origin');
  if (!/^[a-f0-9]{64}$/.test(env.AUTH_SECRET || '') || new Set(env.AUTH_SECRET).size < 8 || env.AUTH_SECRET === env.POSTBOX_KEY_SECRET) throw Error('Independent strong auth secret required');
  if (env.EMAIL_ADAPTER !== 'smtp' || !env.POSTBOX_KEY_ID?.trim() || !env.POSTBOX_KEY_SECRET?.trim() || typeof mail?.check !== 'function') throw Error('Production SMTP configuration required');
  if (env.AUTH_REGISTRATION_ENABLED === undefined || env.AUTH_LEGACY_ENABLED === undefined) throw Error('Explicit registration and bridge policy required');
  // Optional historical adapter must still be verified when explicitly injected.
  if (ledger && !ledger.productionReady) throw Error('Production deletion ledger capability verification required');
}
