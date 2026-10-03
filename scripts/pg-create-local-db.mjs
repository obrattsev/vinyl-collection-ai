// Provision NEW local fixture databases only. This script has no reset/drop operation.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const [kind,output] = process.argv.slice(2);
if (!['test','acceptance'].includes(kind) || !output || !['development','test'].includes(process.env.NODE_ENV)) throw Error('Usage: NODE_ENV=development PG_LOCAL_ADMIN_URL=... node scripts/pg-create-local-db.mjs test|acceptance /absolute/new.env');
const url = new URL(process.env.PG_LOCAL_ADMIN_URL);
if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/postgres' || url.search || url.hash || url.username !== 'vinyl_4a_admin' || !output.startsWith('/')) throw Error('Explicit local fixture cluster required');
const admin = new pg.Client({connectionString:url.href,connectionTimeoutMillis:3000});
await admin.connect();
try {
 const { rows:[row] } = await admin.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
 if (row.marker !== 'vinyl-4a-local-cluster') throw Error('Refusing unmarked cluster');
 const suffix=randomBytes(8).toString('hex');const name=`vinyl_4a_${kind}_${suffix}`;
 const token=randomBytes(24).toString('hex');
 // Identifiers/literals are generated exclusively from fixed ASCII prefixes + hex.
 await admin.query(`CREATE DATABASE ${name}`);
 await admin.query(`COMMENT ON DATABASE ${name} IS 'vinyl-4a-${kind}:${token}'`);
 url.pathname='/'+name;
 await writeFile(output,`NODE_ENV=${kind==='test'?'test':'development'}\nDATABASE_URL=${url.href}\n${kind==='test'?'PG_TEST_TOKEN='+token+'\n':''}`,{mode:0o600,flag:'wx'});
 console.log(`Created ${name}; private environment file: ${output}`);
} finally {await admin.end();}
