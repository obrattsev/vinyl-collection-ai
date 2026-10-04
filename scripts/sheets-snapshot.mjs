import {GoogleAuth} from 'google-auth-library';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {sheetsMirror} from '../server/mirror-sheets.mjs';
import {validateSnapshot} from '../server/postgres/importer.mjs';
import {safeFiles,fileHash} from '../server/postgres/backup.mjs';
import sharp from 'sharp';
const [ownerFile,directory]=process.argv.slice(2);
if(!ownerFile||!directory||!isAbsolute(directory)||!process.env.COVERS_DIR)throw Error('Usage: sheets-snapshot.mjs owner-manifest.json new-absolute-directory');
const owner=JSON.parse(await readFile(ownerFile,'utf8'));
const targets={};for(const section of ['collection','wishlist']){
 const prefix=section.toUpperCase(),id=process.env[prefix+'_SPREADSHEET_ID'],name=process.env[prefix+'_SHEET_NAME'];
 if(!/^[a-zA-Z0-9_-]+$/.test(id||'')||!name)throw Error('Explicit source targets required');targets[section]={id,name};
}
if(targets.collection.id===targets.wishlist.id)throw Error('Distinct source documents required');
const auth=new GoogleAuth({keyFile:process.env.GOOGLE_APPLICATION_CREDENTIALS,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const adapter=sheetsMirror({targets},auth);
const files=await safeFiles(process.env.COVERS_DIR);
const raw={importKey:owner.importKey,user:owner.user,collectionValues:await adapter.raw('collection'),wishlistValues:await adapter.raw('wishlist'),covers:[]};
// Inventory includes only UUID directories with both image files. Preserve other files in archive.
const ids=new Set(files.map(f=>f.path.split('/')[0]).filter(id=>/^[a-f0-9-]{36}$/.test(id)));
for(const id of ids){if(!['image.webp','thumb.webp'].every(name=>files.some(f=>f.path===`${id}/${name}`&&f.size>0)))throw Error('Incomplete cover files');raw.covers.push(id);}
for(const id of raw.covers)for(const name of ['image.webp','thumb.webp'])await sharp(join(process.env.COVERS_DIR,id,name),{limitInputPixels:16_000_000,failOn:'warning'}).raw().toBuffer();
const canonical=validateSnapshot(raw);
await mkdir(directory,{mode:0o700});
await writeFile(join(directory,'source-raw.json'),JSON.stringify(raw,null,2),{mode:0o600});
await writeFile(join(directory,'source-canonical.json'),JSON.stringify({importKey:canonical.importKey,user:raw.user,collection:canonical.collection,wishlist:canonical.wishlist,covers:canonical.covers},null,2),{mode:0o600});
await writeFile(join(directory,'verification.json'),JSON.stringify({report:canonical.report,manifestHash:canonical.manifestHash,coverFiles:files,rawHash:await fileHash(join(directory,'source-raw.json')),canonicalHash:await fileHash(join(directory,'source-canonical.json')),requiresWriteFreeze:true},null,2),{mode:0o600});
console.log(JSON.stringify({directory,report:canonical.report,requiresFrozenSource:true}));
