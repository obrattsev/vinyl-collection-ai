import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {validateAuthStartup} from '../server/security/startup-policy.mjs';
const base=()=>({NODE_ENV:'production',DATA_BACKEND:'postgres',AUTH_MODE:'multiuser',PG_PRODUCTION_ACK:'stage4b',PG_OWNER_ID:randomUUID(),DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:5432/vinyl_production',EMAIL_ADAPTER:'smtp',POSTBOX_KEY_ID:'fixture',POSTBOX_KEY_SECRET:'fixture-secret',AUTH_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'https://vinyl-collection.ru',AUTH_REGISTRATION_ENABLED:'true',AUTH_LEGACY_ENABLED:'false'});
const capabilities={ledger:{productionReady:true},mail:{check:async()=>true}};
test('production registration is permitted only with explicit safe config without a mandatory ledger',()=>{
 assert.doesNotThrow(()=>validateAuthStartup(base(),{mail:capabilities.mail}));
 assert.doesNotThrow(()=>validateAuthStartup(base(),capabilities));
 for(const [key,value] of [['DATA_BACKEND','sheets'],['AUTH_MODE','legacy'],['AUTH_SECRET','0'.repeat(64)],['APP_ORIGIN','http://vinyl-collection.ru'],['EMAIL_ADAPTER','capture'],['POSTBOX_KEY_SECRET',''],['AUTH_REGISTRATION_ENABLED','yes'],['AUTH_LEGACY_ENABLED',undefined],['PG_PRODUCTION_ACK',undefined]]){
  assert.throws(()=>validateAuthStartup({...base(),[key]:value},capabilities));
 }
 assert.throws(()=>validateAuthStartup(base(),{...capabilities,ledger:{productionReady:false}}),/ledger capability/);
 assert.throws(()=>validateAuthStartup(base(),{...capabilities,mail:{}}),/SMTP/);
});
