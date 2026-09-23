import { createAuth, hashPassword } from '../../server/auth.mjs';
export const password = 'test-only-owner-password-12345';
export const passwordHash = await hashPassword(password);
export const testAuth = options => createAuth({ passwordHash, ...options });
const clients = new Map();
export async function loginOwner(url, secret = password) {
  const result = await globalThis.fetch(url + '/api/auth/login', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: secret }) });
  if (result.status !== 200) throw Error(`Login failed: ${result.status}`);
  const session = await result.json();
  const headers = { Cookie: result.headers.get('set-cookie').split(';')[0], Origin: url, 'X-CSRF-Token': session.csrfToken };
  clients.set(url, headers); return headers;
}
export function ownerFetch(url, options = {}) {
  const headers = clients.get(new URL(url).origin);
  if (!headers) throw Error('Test must log in first');
  return globalThis.fetch(url, { ...options, headers: { ...headers, ...options.headers } });
}
