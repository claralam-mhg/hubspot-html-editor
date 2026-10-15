// Reads every live page in pages.js and writes <out>/live/<page key>.json with each module's live code.
// GitHub Actions runs this every 15 minutes before deploying the site (see .github/workflows/deploy.yml).
// Never exits non-zero for a fetch problem: the editor then just asks PCT to paste instead.
// Usage: node scripts/snapshot.mjs <outDir> [--from-file <page key>=<html file>]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = require(path.join(root, 'modules.js'));
const { PAGES } = require(path.join(root, 'pages.js'));

const out = process.argv[2] || 'site';
const fromFile = Object.fromEntries(process.argv.slice(3).filter(a => a.includes('=')).map(a => a.split('=')));
fs.mkdirSync(path.join(out, 'live'), { recursive: true });

for (const page of PAGES.filter(p => p.status === 'live' && p.liveUrl)) {
  const result = { page: page.key, url: page.liveUrl, fetchedAt: new Date().toISOString(), modules: {} };
  try {
    let html;
    if (fromFile[page.key]) html = fs.readFileSync(fromFile[page.key], 'utf8');
    else {
      const res = await fetch(page.liveUrl, { headers: { 'user-agent': 'MoneyHero-PCT-Page-Editor-snapshot/1.0', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    }
    for (const m of page.modules) result.modules[m.file] = M.liveModuleCode(html, m.fingerprint);
  } catch (e) {
    result.error = String(e.message || e);
  }
  fs.writeFileSync(path.join(out, 'live', page.key + '.json'), JSON.stringify(result, null, 1));
  const ok = Object.values(result.modules).filter(x => x.code).length;
  console.log(`${page.key}: ${result.error ? 'ERROR ' + result.error : ok + '/' + page.modules.length + ' modules'}`);
  for (const [k, v] of Object.entries(result.modules)) if (v.error) console.log(`  ${k}: ${v.error}`);
}
