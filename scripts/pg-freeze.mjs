import { backendConfiguration,createPool } from '../server/postgres/config.mjs';
import { freeze } from '../server/postgres/boundary.mjs';
const mode=process.argv[2];if(!['on','off','status'].includes(mode))throw Error('Usage: pg-freeze.mjs on|off|status');
const config=backendConfiguration(process.env);if(config.backend!=='postgres')throw Error('PG required');
const pool=createPool(config.url);
try{console.log(JSON.stringify(mode==='status'?(await pool.query('SELECT * FROM vinyl.runtime_control WHERE singleton')).rows[0]:await freeze(pool,mode==='on')));}finally{await pool.end();}
