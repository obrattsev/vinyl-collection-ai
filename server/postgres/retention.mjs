// Keep newest seven daily artifacts, plus newest artifact in each of four UTC ISO weeks.
export function retainedBackups(entries) {
  const sorted=[...entries].sort((a,b)=>b.localeCompare(a));
  if(sorted.some(n=>!/^\d{8}T\d{6}Z$/.test(n)))throw Error('Invalid backup name');
  const keep=new Set(sorted.slice(0,7)),weeks=new Set();
  for(const name of sorted){const d=new Date(`${name.slice(0,4)}-${name.slice(4,6)}-${name.slice(6,8)}T00:00:00Z`);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);const week=d.toISOString().slice(0,10);if(!weeks.has(week)&&weeks.size<4){weeks.add(week);keep.add(name);}}
  return keep;
}
