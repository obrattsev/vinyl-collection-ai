import { statisticsConfiguration, createStatisticsReporter } from '../server/statistics.mjs';
import { configuredDatabaseUrl,createPool } from '../server/postgres/config.mjs';
import { createEmailService } from '../server/security/email.mjs';
const config=statisticsConfiguration(process.env);
if(!config)throw Error('Statistics must be explicitly enabled');
const pool=createPool(configuredDatabaseUrl(process.env));
try {
 const reporter=createStatisticsReporter(pool,{mail:createEmailService(process.env),recipient:config.recipient});
 const result=await reporter.run();console.log(JSON.stringify({event:'daily-statistics',...result}));
 if(['pending','failed','unknown','not-started','deferred','attention'].includes(result.state))process.exitCode=1;
}catch{console.error(JSON.stringify({event:'daily-statistics',state:'error',error:'STATISTICS_JOB_FAILED'}));process.exitCode=1;}
finally{await pool.end();}
