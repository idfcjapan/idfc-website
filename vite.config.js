import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_WRITE_LOGS = 'false';
process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';

export default defineConfig({
  publicDir: 'site',
  plugins: [cloudflare({configPath: './wrangler.jsonc', inspectorPort: false})],
  build: {rolldownOptions: {input: './worker/client-entry.js'}},
});
