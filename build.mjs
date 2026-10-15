// Builds dist/index.html — one self-contained file PCT can open in any browser.
// Run: node _ops/pct-editor/build.mjs   (from projects/)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
// mhg-design fonts + tokens, copied from the mhg-design skill into design/ so GitHub can build without it
const skill = path.join(here, 'design');
const read = p => fs.readFileSync(p, 'utf8');

const fonts = read(path.join(skill, 'fonts.css'));
const tokens = read(path.join(skill, 'tokens.css'));
let html = read(path.join(here, 'app.src.html'));
const parts = { '/*@@FONTS@@*/': fonts, '/*@@TOKENS@@*/': tokens, '/*@@ENGINE@@*/': read(path.join(here, 'engine.js')), '/*@@PAGES@@*/': read(path.join(here, 'pages.js')), '/*@@MODULES@@*/': read(path.join(here, 'modules.js')), '/*@@REVIEW@@*/': read(path.join(here, 'review.js')), '/*@@EXCEL@@*/': read(path.join(here, 'excel.js')), '/*@@APP@@*/': read(path.join(here, 'app.js')) };
for (const [k, v] of Object.entries(parts)) {
  if (html.split(k).length !== 2) throw new Error('placeholder ' + k + ' must appear exactly once');
  // Inlined code must not contain "</script", "<script" or "<!--": the HTML parser would end or
  // re-enter the script early. "\x3C" is "<" to JavaScript (in strings and regexes alike), so behaviour is unchanged.
  const safe = /^\/\*@@(ENGINE|PAGES|MODULES|REVIEW|EXCEL|APP)@@\*\/$/.test(k) ? v.replace(/<(\/?script|!--)/gi, '\\x3C$1') : v;
  html = html.split(k).join(safe);
}

// Checks: every var(--token) used in the page styles resolves; every script parses.
const ownCss = read(path.join(here, 'app.src.html')).match(/<style>\n[\s\S]*?<\/style>/)[0];
const used = [...new Set([...ownCss.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))];
const missing = used.filter(t => !new RegExp('\\s' + t + '\\s*:').test(tokens));
if (missing.length) throw new Error('Tokens not defined in mhg-design tokens.css: ' + missing.join(', '));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { new Function(s); });
// The HTML parser must see exactly the scripts we wrote: count <script> tags vs closing tags.
const opens = (html.match(/<script\b/gi) || []).length, closes = (html.match(/<\/script>/gi) || []).length;
if (opens !== 6 || closes !== 6) throw new Error(`expected 6 <script> blocks, HTML has ${opens} opening / ${closes} closing tags`);
if (/<!--/.test(scripts.join(''))) throw new Error('"<!--" inside an inlined script');

fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
fs.writeFileSync(path.join(here, 'dist/index.html'), html);
console.log(`dist/index.html — ${(html.length / 1024).toFixed(0)} KB, ${used.length} tokens resolved, ${scripts.length} scripts parse`);
