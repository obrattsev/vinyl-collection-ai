import { readFile,writeFile,rename } from 'node:fs/promises';
// Local acceptance only; production config rejects this adapter.
export function fakeMirror(file) {
  const load=async()=>JSON.parse(await readFile(file,'utf8'));
  return {
    read:async section=>{const data=await load();if(data.outage)throw Error('Simulated Google outage');return data[section];},
    async replace(section,records) {
      const data=await load();if(data.outage)throw Error('Simulated Google outage');
      data[section]=records;
      await writeFile(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});await rename(file+'.tmp',file);
    }
  };
}
