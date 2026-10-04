import { GoogleAuth } from 'google-auth-library';
import { SHEETS_COLUMNS,mapSheetValues } from './google-sheets-collection.mjs';
import { WISHLIST_COLUMNS,mapWishlistValues } from './google-sheets-wishlist.mjs';
import { UUID } from '../src/base-record.mjs';
import { isAbsolute } from 'node:path';
const models={collection:{columns:SHEETS_COLUMNS,map:mapSheetValues},wishlist:{columns:WISHLIST_COLUMNS,map:mapWishlistValues}};
export function mirrorConfiguration(env,backend) {
  if (!['true','false',undefined].includes(env.MIRROR_ENABLED)) throw Error('Invalid MIRROR_ENABLED');
  if(env.MIRROR_ENABLED!=='true') {
    if(Object.keys(env).some(k=>k.startsWith('MIRROR_')&&k!=='MIRROR_ENABLED'&&env[k])) throw Error('Disabled mirror has configuration');
    return null;
  }
  if(backend.backend!=='postgres'||!UUID.test(env.MIRROR_OWNER_ID||'')||env.MIRROR_OWNER_ID.toLowerCase()!==backend.ownerId) throw Error('Mirror owner must match server bridge');
  const file=env.MIRROR_FAKE_FILE;
  if(file) {
    if(env.NODE_ENV==='production'||!isAbsolute(file)||Object.keys(env).some(k=>/^MIRROR_(COLLECTION|WISHLIST)_/.test(k)&&env[k])) throw Error('Fake mirror requires isolated local configuration');
    return {ownerId:backend.ownerId,fakeFile:file};
  }
  const targets={};
  for(const section of ['collection','wishlist']) {
    const prefix=`MIRROR_${section.toUpperCase()}`;
    const id=env[prefix+'_SPREADSHEET_ID'],name=env[prefix+'_SHEET_NAME'];
    if(!/^[a-zA-Z0-9_-]+$/.test(id||'')||!name?.trim())throw Error('Incomplete mirror target');
    targets[section]={id,name};
  }
  if(targets.collection.id===targets.wishlist.id||!isAbsolute(env.GOOGLE_APPLICATION_CREDENTIALS||''))throw Error('Invalid mirror configuration');
  if([targets.collection.id,targets.wishlist.id].includes(env.BUG_REPORT_SPREADSHEET_ID))throw Error('Bug Reports must be separate from mirror');
  return {ownerId:backend.ownerId,targets,keyFile:env.GOOGLE_APPLICATION_CREDENTIALS};
}
export function sheetsMirror({targets,keyFile},auth=new GoogleAuth({keyFile,scopes:['https://www.googleapis.com/auth/spreadsheets']})) {
  async function request(options) {return (await auth.getClient()).request({timeout:15000,retry:false,...options});}
  function target(section){if(!models[section]||!targets[section])throw Error('Invalid mirror section');return targets[section];}
  async function raw(section) {
    const {id,name}=target(section);const range="'"+name.replaceAll("'","''")+"'";
    return (await request({method:'GET',url:`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,params:{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'}})).data.values;
  }
  return {
    raw,
    read:async section=>models[section].map(await raw(section)),
    async replace(section,records) {
      const {id,name}=target(section);const model=models[section];const base=`https://sheets.googleapis.com/v4/spreadsheets/${id}`;
      const properties=(await request({method:'GET',url:base,params:{fields:'sheets.properties'}})).data.sheets.map(s=>s.properties).find(p=>p.title===name);
      if(!properties||(properties.sheetType&&properties.sheetType!=='GRID'))throw Error('Invalid target sheet');
      const previous=await raw(section);const headers=Object.keys(model.columns);
      if(JSON.stringify(previous?.[0])!==JSON.stringify(headers))throw Error('Unexpected mirror headers');
      const rows=[headers,...records.map(r=>Object.values(model.columns).map(f=>r[f]))].map(row=>({values:row.map(value=>value==null?{}:{userEnteredValue:typeof value==='boolean'?{boolValue:value}:typeof value==='number'?{numberValue:value}:{stringValue:value}})}));
      const required=Math.max(rows.length,previous.length);const requests=[];
      if(required>properties.gridProperties.rowCount)requests.push({appendDimension:{sheetId:properties.sheetId,dimension:'ROWS',length:required-properties.gridProperties.rowCount}});
      // Unspecified rows inside range are cleared; formatting is left intact.
      requests.push({updateCells:{range:{sheetId:properties.sheetId,startRowIndex:0,endRowIndex:required,startColumnIndex:0,endColumnIndex:headers.length},rows,fields:'userEnteredValue'}});
      await request({method:'POST',url:base+':batchUpdate',data:{requests}});
    }
  };
}
