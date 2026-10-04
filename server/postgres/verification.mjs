import { recordRepository,validId } from './repositories.mjs';
import { validateSnapshot } from './importer.mjs';
import { recordRevision } from '../../src/collection-record.mjs';
import { wishlistRevision } from '../../src/wishlist-record.mjs';
import { snapshotReport,stateHash,MIRROR_LOCK } from './mirror.mjs';
export async function verifyImport(pool,input) {
  const source=validateSnapshot(input),client=await pool.connect();let broken=false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report={};
    for(const section of ['collection','wishlist']) {
      const rows=await recordRepository(client,source.user.id,section).list();
      const revision=section==='collection'?recordRevision:wishlistRevision;
      const sourceRevisions=await Promise.all(source[section].map(revision));
      const actualRevisions=await Promise.all(rows.map(revision));
      const table=section==='collection'?'collection_records':'wishlist_records';
      const stored=(await client.query(`SELECT id,revision FROM vinyl.${table} WHERE user_id=$1 ORDER BY position,id`,[source.user.id])).rows;
      report[section]={...snapshotReport({[section]:rows, [section==='collection'?'wishlist':'collection']:[]})[section],
        valuesMatch:stateHash(rows)===stateHash(source[section]),
        revisionsMatch:stateHash(sourceRevisions)===stateHash(actualRevisions)&&stored.every((r,i)=>r.revision===actualRevisions[i])};
    }
    await client.query('COMMIT');
    return {verified:Object.values(report).every(r=>r.valuesMatch&&r.revisionsMatch),canonicalizedIds:source.report.canonicalizedIds,...report};
  }catch(error){try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}finally{client.release(broken);}
}
export async function rollbackGate(pool,userId,adapter) {
  // Read-only evidence, not an automatic backend switch. Stop worker before using.
  userId=validId(userId);
  const client=await pool.connect();let broken=false;
  try {
  const locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[MIRROR_LOCK])).rows[0].locked;
  if(!locked)throw Error('Stop mirror worker before rollback verification');
  await client.query('SELECT pg_advisory_lock(44160403)');
  const control=(await client.query('SELECT * FROM vinyl.runtime_control WHERE singleton')).rows[0];
  if(!control?.frozen)throw Error('Freeze and drain required');
  const report={};
  for(const section of ['collection','wishlist']) {
    const pg=await recordRepository(client,userId,section).list(),sheet=await adapter.read(section);
    report[section]={count:pg.length,hash:stateHash(pg),matches:stateHash(pg)===stateHash(sheet)};
  }
  return {verified:Object.values(report).every(r=>r.matches),businessWrites:control.business_writes,scope:'Owner Collection/Wishlist only; not full DB rollback',...report};
  }finally{try{await client.query('SELECT pg_advisory_unlock_all()');}catch{broken=true;}client.release(broken);}
}
