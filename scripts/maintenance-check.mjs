import{checkMaintenance}from'../ops/maintenance-gate.mjs';
try{
 const[token,...urls]=process.argv.slice(2);
 console.log(JSON.stringify(await checkMaintenance({token,urls})));
}catch{
 // Never continue to freeze/DDL after a failed gate; this command has no mutations.
 console.error('Maintenance not proven. Keep the old release running; do not freeze, back up, migrate or switch.');process.exitCode=1;
}
