// Interactive only: never pass the password in argv, environment, or shell history.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/auth.mjs';

if (!process.stdin.isTTY || process.argv.length !== 3) {
  console.error('Usage: node scripts/hash-owner-password.mjs /absolute/path/outside-repository/owner-auth.env (interactive terminal)');
  process.exit(1);
}
const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  const destination = process.argv[2];
  if (!isAbsolute(destination)) throw Error('Use an absolute path');
  const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const parent = await realpath(dirname(destination));
  const rel = relative(root, parent);
  if (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel)) throw Error('Destination must be outside the repository');
  process.stderr.write('Owner password (16+ characters, hidden): ');
  const password = await rl.question('');
  process.stderr.write('\nRepeat password (hidden): ');
  const confirmation = await rl.question('');
  process.stderr.write('\n');
  if (password !== confirmation) throw Error('Passwords do not match');
  const hash = await hashPassword(password);
  await writeFile(resolve(destination), `OWNER_PASSWORD_HASH='${hash}'\n`, { mode: 0o600, flag: 'wx' });
  console.error('Created owner-auth.env with permissions 0600. Existing files are never overwritten.');
} catch (error) { console.error(error.code ? 'Cannot create file. Check destination and whether it already exists.' : error.message); process.exitCode = 1; }
finally { rl.close(); }
