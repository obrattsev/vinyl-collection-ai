// Structural verification after restoring a full dump. Never emit auth contents.
export async function verifyAuthRestore(pool) {
  const installed=(await pool.query("SELECT to_regclass('vinyl.user_auth') AS name")).rows[0].name;
  if(!installed)return {present:false};
  const tables=['user_auth','auth_sessions','auth_flows','auth_challenges','auth_rate_limits'];
  const counts={};for(const table of tables)counts[table]=Number((await pool.query(`SELECT count(*) AS n FROM vinyl.${table}`)).rows[0].n);
  const invalid=(await pool.query(`SELECT count(*) AS n FROM vinyl.user_auth a LEFT JOIN vinyl.users u ON u.id=a.user_id WHERE u.id IS NULL OR a.email_verified_at IS NULL OR a.auth_version<1 OR a.password_hash NOT LIKE 'argon2id$v=19$%'`)).rows[0].n;
  if(Number(invalid))throw Error('Restored auth integrity failure');
  return {present:true,counts};
}
