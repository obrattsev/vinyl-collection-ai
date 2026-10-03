import { createPool, localDatabaseUrl } from '../server/postgres/config.mjs';
import { migrate } from '../server/postgres/migrations.mjs';
if (!['development','test'].includes(process.env.NODE_ENV)) throw Error('Local NODE_ENV required');
const pool = createPool(localDatabaseUrl(process.env.DATABASE_URL));
try { console.log(await migrate(pool)); } finally { await pool.end(); }
