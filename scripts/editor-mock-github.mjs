// Local stand-in for the GitHub API and raw file host, used only to test the
// member editor (site/edit/) without touching the real repository.
// Usage: node scripts/build-pages.mjs && node scripts/editor-mock-github.mjs . 8765
// then open http://localhost:8765/idfc-website/edit/?branch=editor-test, run
// localStorage.setItem("idfc-editor-test-config", JSON.stringify({api:location.origin+"/gh", raw:location.origin+"/raw"}))
// in the page, reload, and sign in with the token "test-token-local".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repoDir = process.argv[2];
const port = Number(process.argv[3] || 8765);
const siteDir = path.join(repoDir, '_site');
const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
const id = () => crypto.randomBytes(20).toString('hex');
trees.set('t0', {base:null, entries:new Map()});
commits.set('c0', {tree:'t0', parents:[], message:'base'});
refs.set('main', 'c0'); refs.set('editor-test', 'c0');
const log = [];

function diskFiles(dir, prefix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, entry.name), rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...diskFiles(p, rel + '/')); else out.push(rel);
  }
  return out;
}
function read(treeSha, file) {
  for (let t = trees.get(treeSha); t; t = trees.get(t.base)) {
    if (t.entries.has(file)) { const v = t.entries.get(file); return v === null ? null : blobs.get(v); }
    if (!t.base) break;
  }
  const disk = path.join(repoDir, file);
  return fs.existsSync(disk) && fs.statSync(disk).isFile() ? fs.readFileSync(disk) : null;
}
function list(treeSha) {
  const set = new Set([...diskFiles(path.join(repoDir, 'site'), 'site/'), 'worker/pages.json']);
  const chain = []; for (let t = trees.get(treeSha); t; t = trees.get(t.base)) { chain.unshift(t); if (!t.base) break; }
  for (const t of chain) for (const [k, v] of t.entries) v === null ? set.delete(k) : set.add(k);
  return [...set];
}
function putBlob(buffer) { const sha = id(); blobs.set(sha, buffer); return sha; }
function body(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
function send(res, status, data, headers = {}) {
  res.writeHead(status, {'content-type':'application/json', 'access-control-allow-origin':'*', ...headers});
  res.end(JSON.stringify(data));
}
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.json':'application/json', '.gif':'image/gif', '.pdf':'application/pdf'};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/idfc-website/')) {
      let file = path.join(siteDir, p.slice('/idfc-website/'.length));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store'});
      return res.end(fs.readFileSync(file));
    }
    if (p.startsWith('/raw/')) {
      const [, , owner, repo, sha, ...rest] = p.split('/');
      const commit = commits.get(sha);
      if (!commit) { res.writeHead(404); return res.end('404'); }
      const data = read(commit.tree, rest.join('/'));
      res.writeHead(data ? 200 : 404, {'access-control-allow-origin':'*', 'content-type':'text/plain; charset=utf-8'});
      return res.end(data || '404: Not Found');
    }
    if (p.startsWith('/mock/')) {
      if (p === '/mock/state') return send(res, 200, {refs:Object.fromEntries(refs), log});
      if (p === '/mock/file') { const c = commits.get(refs.get(url.searchParams.get('ref') || 'main')); const d = read(c.tree, url.searchParams.get('path')); res.writeHead(d ? 200 : 404, {'content-type':'text/plain; charset=utf-8'}); return res.end(d || ''); }
      if (p === '/mock/commit' && req.method === 'POST') {
        // Simulate another member saving: replace text in one file on a branch.
        const {branch = 'main', file, find, replace} = JSON.parse(await body(req));
        const head = refs.get(branch), c = commits.get(head), text = read(c.tree, file).toString('utf8');
        if (!text.includes(find)) return send(res, 400, {error:'find not found'});
        const t = id(); trees.set(t, {base:c.tree, entries:new Map([[file, putBlob(Buffer.from(text.replace(find, replace)))]])});
        const n = id(); commits.set(n, {tree:t, parents:[head], message:'other member'}); refs.set(branch, n);
        return send(res, 200, {sha:n});
      }
    }
    if (p.startsWith('/gh/')) {
      if (req.method === 'OPTIONS') { res.writeHead(204, {'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET,POST,PATCH'}); return res.end(); }
      if (req.headers.authorization !== 'Bearer test-token-local') return send(res, 401, {message:'Bad credentials'});
      const route = p.slice(3);
      if (route === '/user') return send(res, 200, {login:'local-tester'});
      const m = route.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
      if (!m) return send(res, 404, {message:'Not Found'});
      const rest = m[3] || '';
      if (!rest) return send(res, 200, {full_name:m[1] + '/' + m[2], permissions:{push:true}});
      let r;
      if ((r = rest.match(/^\/git\/ref\/heads\/(.+)$/)) && req.method === 'GET') return refs.has(r[1]) ? send(res, 200, {object:{sha:refs.get(r[1])}}) : send(res, 404, {message:'Not Found'});
      if ((r = rest.match(/^\/git\/commits\/(\w+)$/)) && req.method === 'GET') { const c = commits.get(r[1]); return c ? send(res, 200, {sha:r[1], tree:{sha:c.tree}, parents:c.parents.map(sha => ({sha}))}) : send(res, 404, {}); }
      if ((r = rest.match(/^\/git\/trees\/(\w+)$/)) && req.method === 'GET') return send(res, 200, {sha:r[1], truncated:false, tree:list(r[1]).map(f => ({path:f, type:'blob', mode:'100644', sha:'x'}))});
      if (rest === '/git/blobs' && req.method === 'POST') { const b = JSON.parse(await body(req)); return send(res, 201, {sha:putBlob(Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8'))}); }
      if (rest === '/git/trees' && req.method === 'POST') {
        const b = JSON.parse(await body(req)), entries = new Map();
        for (const e of b.tree) entries.set(e.path, e.content !== undefined ? putBlob(Buffer.from(e.content, 'utf8')) : e.sha);
        const t = id(); trees.set(t, {base:b.base_tree, entries}); return send(res, 201, {sha:t});
      }
      if (rest === '/git/commits' && req.method === 'POST') { const b = JSON.parse(await body(req)); const c = id(); commits.set(c, {tree:b.tree, parents:b.parents, message:b.message}); return send(res, 201, {sha:c}); }
      if ((r = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method === 'PATCH') {
        const b = JSON.parse(await body(req)), current = refs.get(r[1]), commit = commits.get(b.sha);
        if (!commit || !commit.parents.includes(current)) return send(res, 422, {message:'Update is not a fast forward'});
        refs.set(r[1], b.sha);
        const t = trees.get(commit.tree);
        log.push({branch:r[1], sha:b.sha, message:commit.message, files:[...t.entries.keys()]});
        return send(res, 200, {object:{sha:b.sha}});
      }
      return send(res, 404, {message:'Not Found'});
    }
    res.writeHead(404); res.end();
  } catch (error) { console.error(error); send(res, 500, {message:error.message}); }
}).listen(port, () => console.log('mock on ' + port));
