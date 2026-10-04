import { createPool, configuredDatabaseUrl } from '../server/postgres/config.mjs';
import { migrate } from '../server/postgres/migrations.mjs';
const pool = createPool(configuredDatabaseUrl(process.env));
try { console.log(await migrate(pool)); } finally { await pool.end(); }
