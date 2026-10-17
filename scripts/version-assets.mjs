import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const site=path.resolve(import.meta.dirname,'../site');
const hash=createHash('sha256');
for(const file of ['assets/js/site.js','assets/js/content-sync.js'])hash.update(await readFile(path.join(site,file)));
const version=hash.digest('hex').slice(0,12);
async function visit(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())await visit(file);
    else if(file.endsWith('.html')){
      const html=await readFile(file,'utf8');
      const next=html.replace(/src="(\/assets\/js\/site\.js)(?:\?[^"]*)?"/g,`src="$1?v=${version}"`);
      if(next!==html)await writeFile(file,next);
    }
  }
}
await visit(site);
console.log(JSON.stringify({public_script_version:version}));
