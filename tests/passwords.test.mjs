import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,passwordMatches,validatePassword} from '../server/security/passwords.mjs';
import {normalizeLogin,normalizeEmail,registrationInput} from '../server/security/identity.mjs';
test('Argon2id hashes are salted, versioned and verify exact Unicode/space bytes',async()=>{
 const password='  длинный пароль 🎶  ';const a=await passwordHash(password),b=await passwordHash(password);
 assert.notEqual(a,b);assert.match(a,/^argon2id\$v=19\$/);
 assert.equal(await passwordMatches(password,a),true);assert.equal(await passwordMatches(password.trim(),a),false);
 await assert.rejects(passwordMatches(password,a.replace('m=65536','m=999999999')),/Unsupported/);
});
test('password policy counts code points, does not truncate and rejects common passwords',()=>{
 assert.equal(validatePassword('🎶b'.repeat(6)),'🎶b'.repeat(6));
 assert.throws(()=>validatePassword('🎶'.repeat(11)));assert.throws(()=>validatePassword('a'.repeat(129)));assert.throws(()=>validatePassword('password123456'));
 assert.throws(()=>validatePassword('valid fixture password','different'));
});
test('identity validation prevents Unicode login folding, reserves routes and preserves email aliases',()=>{
 assert.equal(normalizeLogin(' Obrattsev '),'obrattsev');assert.throws(()=>normalizeLogin('Kelvin'));assert.throws(()=>normalizeLogin('static'));
 assert.deepEqual(normalizeEmail(' A.B+tag@EXAMPLE.test '),{email:'A.B+tag@example.test',emailNormalized:'a.b+tag@example.test'});
 assert.throws(()=>normalizeEmail('a@-bad.test'));assert.throws(()=>registrationInput({login:'valid',email:'a@example.test',userId:'forged'}));
});

test('production refuses capture mail before any file IO',async()=>{
 const {createEmailService}=await import('../server/security/email.mjs');
 assert.throws(()=>createEmailService({NODE_ENV:'production',EMAIL_ADAPTER:'capture',EMAIL_CAPTURE_FILE:'/tmp/forbidden-capture'}));
});
