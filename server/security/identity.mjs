import { domainToASCII } from 'node:url';
export const RESERVED_LOGINS = new Set(['collection','wishlist','api','assets','static','src','media','prototype','u','account','login','logout','register','verify','reset','forgot-password','reset-password','verify-email','auth','admin','support','system']);
export function normalizeLogin(value) {
  if (typeof value !== 'string') throw Error('INVALID_LOGIN');
  const raw = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,29}$/.test(raw)) throw Error('INVALID_LOGIN');
  const login = raw.toLowerCase();
  if (RESERVED_LOGINS.has(login)) throw Error('INVALID_LOGIN');
  return login;
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw Error('INVALID_EMAIL');
  const input = value.trim(), parts = input.split('@');
  if (parts.length !== 2) throw Error('INVALID_EMAIL');
  const [local, rawDomain] = parts, domain = domainToASCII(rawDomain).toLowerCase();
  if (!local || local.length > 64 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw Error('INVALID_EMAIL');
  const email = `${local}@${domain}`;
  if (email.length > 254) throw Error('INVALID_EMAIL');
  return { email, emailNormalized: email.toLowerCase() };
}
export function registrationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['login','email','fullName'].includes(key))) throw Error('INVALID_REQUEST');
  const login = normalizeLogin(input.login), email = normalizeEmail(input.email);
  if (input.fullName != null && (typeof input.fullName !== 'string' || [...input.fullName].length > 200 || /[\u0000-\u001f\u007f]/u.test(input.fullName))) throw Error('INVALID_NAME');
  return { login, ...email, fullName: input.fullName?.trim() || null };
}
