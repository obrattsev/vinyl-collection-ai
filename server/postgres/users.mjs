import { randomUUID } from 'node:crypto';
import { UUID } from '../../src/base-record.mjs';
import { normalizeLogin, normalizeEmail } from '../security/identity.mjs';
export function userInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['id','login','email','fullName','collectionPublic','wishlistPublic'].includes(k))) throw Error('Invalid fixture user');
  const login = normalizeLogin(input.login);
  const { email: address } = normalizeEmail(input.email);
  if (input.fullName != null && (typeof input.fullName !== 'string' || !input.fullName.trim())) throw Error('Invalid full name');
  for (const key of ['collectionPublic','wishlistPublic']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Error('Invalid visibility');
  const id = input.id ?? randomUUID();
  if (!UUID.test(id)) throw Error('Invalid user UUID');
  return { id: id.toLowerCase(), login, email: address, emailNormalized: address.toLowerCase(), fullName: input.fullName ?? null,
    collectionPublic: input.collectionPublic ?? false, wishlistPublic: input.wishlistPublic ?? false };
}
// Caller owns transaction; no registration/auth flow is exposed in 4A.
export async function insertUser(client, input) {
  const u = userInput(input);
  await client.query('INSERT INTO vinyl.login_reservations(login_normalized) VALUES ($1)', [u.login]);
  await client.query(`INSERT INTO vinyl.users(id,login,login_normalized,email,email_normalized,full_name,collection_public,wishlist_public)
    VALUES ($1,$2,$2,$3,$4,$5,$6,$7)`, [u.id,u.login,u.email,u.emailNormalized,u.fullName,u.collectionPublic,u.wishlistPublic]);
  return u;
}
