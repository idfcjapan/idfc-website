import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizePublicSEO } from './normalize-public-seo.mjs';
await normalizePublicSEO('dist/client');
await mkdir('dist/.openai', {recursive:true});
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/drizzle', {recursive:true});
// The native Sites packager loads the callable default export at this path.
await readFile('dist/server/index.js');
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
config.d1_databases[0].migrations_dir = '../drizzle';
await writeFile('dist/server/wrangler.json', JSON.stringify(config, null, 2)+'\n');
