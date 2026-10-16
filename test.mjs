// Tests the engine against the real Life product-data module.
// Run: node _ops/pct-editor/test.mjs   (from projects/)
import { createRequire } from 'module';
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const E = require('./engine.js');
const { PAGES } = require('./pages.js');
const cfg = PAGES.find(p => p.key === 'life-zh').data;
const SRC = fs.readFileSync(path.join(here, 'fixtures/life-zh-repo-2026-10-15/product-data.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Evaluate the module the way the browser would, to compare with the engine's view.
function runModule(html) {
  const ctx = {}; ctx.window = ctx;
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], ctx);
  return ctx;
}

console.log('\nLife product-data (' + SRC.length + ' bytes)');
const doc = E.load(SRC, cfg);
const live = runModule(SRC);

t('parser reads the same data the browser sees', () => {
  eq(JSON.stringify(doc.records.map(r => r.data)), JSON.stringify(live.P));
});
t('no changes → output is byte-identical', () => eq(E.build(doc, {}), SRC));
t('same order, no field edits → byte-identical', () => eq(E.build(doc, { order: doc.records.map(r => r.id) }), SRC));
t('unchanged module passes all checks', () => { const c = E.check(SRC, SRC, cfg); assert(c.ok, c.errors.join('; ')); });

const reversed = doc.records.map(r => r.id).reverse();
const out = E.build(doc, { order: reversed });
t('reorder: browser sees the new order', () => eq(runModule(out).P.map(p => p.id).join(), reversed.join()));
t('reorder: rank and rankClass follow the new order', () => {
  const P = runModule(out).P;
  P.forEach((p, i) => { eq(p.rank, i + 1); eq(p.rankClass, i < 3 ? 'rank-' + (i + 1) : 'rank-other'); });
});
t('reorder: every product otherwise identical', () => {
  const strip = p => { const { rank, rankClass, ...rest } = p; return JSON.stringify(rest); };
  const before = Object.fromEntries(live.P.map(p => [p.id, strip(p)]));
  runModule(out).P.forEach(p => eq(strip(p), before[p.id], p.id));
});
t('reorder: START/END comments travel with their product', () => {
  const after = E.load(out, cfg);
  after.records.forEach((r, k) => {
    const block = out.slice(after.blocks[k].from, after.blocks[k].to);
    const name = (block.match(/PRODUCT CARD START: (.*?) =/) || [])[1];
    const endName = (block.match(/PRODUCT CARD END: (.*?) =/) || [])[1];
    assert(name && name === endName, `block ${k} (${r.id}) START "${name}" END "${endName}"`);
  });
});
t('reorder: code outside the list untouched + checks pass', () => { const c = E.check(SRC, out, cfg); assert(c.ok, c.errors.join('; ')); });
t('reorder: line count unchanged (blocks moved, not rewritten)', () => eq(out.split('\n').length, SRC.split('\n').length));
t('reorder back → original bytes', () => eq(E.build(E.load(out, cfg), { order: doc.records.map(r => r.id) }), SRC));

const first = doc.records[0].id;
t('field edit changes exactly one value', () => {
  const o = E.build(doc, { fields: { [first]: { 'exclusive.code': 'NEWCODE' } } });
  const d = E.lineDiff(SRC, o);
  eq(d.length, 2, 'diff lines'); // one removed, one added
  eq(runModule(o).P[0].exclusive.code, 'NEWCODE');
  assert(E.check(SRC, o, cfg).ok, 'checks');
});
t('text with quotes and <br> survives round-trip', () => {
  const v = "It's 50% off<br>首年'快閃'";
  const o = E.build(doc, { fields: { [first]: { 'exclusive.text.en': v } } });
  eq(runModule(o).P[0].exclusive.text.en, v);
});
t('tags list edit', () => {
  const tags = [{ zh: '新標籤', en: 'New tag', c: 't-green' }];
  const o = E.build(doc, { fields: { [first]: { tags } } });
  eq(JSON.stringify(runModule(o).P[0].tags), JSON.stringify(tags));
  assert(E.check(SRC, o, cfg).ok, 'checks');
});
t('reorder + edit together', () => {
  const o = E.build(doc, { order: reversed, fields: { [first]: { url: 'https://example.com/x?a=1&b=2' } } });
  const P = runModule(o).P; eq(P[P.length - 1].id, first); eq(P[P.length - 1].url, 'https://example.com/x?a=1&b=2');
});
t('change list describes ranking and field edits', () => {
  const o = E.build(doc, { order: reversed, fields: { [first]: { 'exclusive.code': 'X1' } } });
  const cl = E.changeList(SRC, o, cfg);
  assert(cl.some(c => c.product === 'Ranking'), 'ranking row'); assert(cl.some(c => c.after === 'X1'), 'code row');
});

console.log('\nChecks catch bad input');
t('missing comma → blocked', () => {
  const bad = SRC.replace("rank:2,rankClass", "rank:2 rankClass");
  assert(!E.check(SRC, bad, cfg).ok, 'should fail');
});
t('missing quote → blocked', () => {
  const bad = SRC.replace("url:'https://go.blue.com.hk/47kDZE7'", "url:'https://go.blue.com.hk/47kDZE7");
  assert(!E.check(SRC, bad, cfg).ok, 'should fail');
});
t('url without https → blocked', () => {
  const o = E.build(doc, { fields: { [first]: { url: 'www.fwd.com.hk' } } });
  assert(!E.check(SRC, o, cfg).ok, 'should fail');
});
t('url with a double quote → blocked (would break href)', () => {
  const o = E.build(doc, { fields: { [first]: { url: 'https://a.com/"x' } } });
  assert(!E.check(SRC, o, cfg).ok, 'should fail');
});
t('empty Chinese name → blocked', () => {
  const o = E.build(doc, { fields: { [first]: { 'name.zh': '' } } });
  assert(!E.check(SRC, o, cfg).ok, 'should fail');
});
t('expired offer date → warning', () => {
  const o = E.build(doc, { fields: { [first]: { 'exclusive.expiry.zh': '限時至2026年1月31日' } } });
  const c = E.check(SRC, o, { ...cfg, today: '2026-10-15' });
  assert(c.ok && c.warnings.some(w => /expired/.test(w)), JSON.stringify(c.warnings));
});
t('unclosed <b> in offer → warning', () => {
  const o = E.build(doc, { fields: { [first]: { 'exclusive.text.zh': '<b>首年1折' } } });
  assert(E.check(SRC, o, cfg).warnings.some(w => /unclosed/.test(w)), 'warn');
});
t('wrong module pasted → clear error', () => {
  try { E.load('<script>var ISSUERS={};</script>', cfg); throw new Error('no error'); }
  catch (e) { assert(/does not look like the Life product-data module/.test(e.message), e.message); }
});
t('positive control: drop a product → blocked', () => {
  const after = E.load(SRC, cfg); const b = after.blocks[1];
  const dropped = SRC.slice(0, b.from) + SRC.slice(b.to);
  assert(!E.check(SRC, dropped, cfg).ok, 'should fail');
});

console.log('\nEvery other Life module');
const M = require('./modules.js');
const COMP = path.join(here, 'fixtures/life-zh-repo-2026-10-15');
const life = PAGES.find(p => p.key === 'life-zh');
for (const m of life.modules) {
  const h = fs.readFileSync(path.join(COMP, m.file + '.html'), 'utf8');
  t(`${m.file}: fingerprint present, safety passes on live code, no-op is byte-identical`, () => {
    assert(h.includes(m.fingerprint), 'fingerprint "' + m.fingerprint + '" missing');
    const s = M.safety(h, h); assert(s.ok, s.errors.join('; '));
    const F = M.htmlFields(h, { overriddenIds: life.overriddenIds });
    eq(M.applyHtml(h, F, {}), h);
    if (m.vars) eq(M.applyVars(h, []), h);
  });
}
const SCR = fs.readFileSync(path.join(COMP, 'scripts.html'), 'utf8');
t('page text edit: one value changes, browser sees it', () => {
  const o = M.applyVars(SCR, [{ v: 'T', path: 'zh.faq1q', value: '新問題？' }]);
  eq(E.lineDiff(SCR, o).length, 2); eq(M.readVar(o, 'T').data.zh.faq1q, '新問題？');
  assert(M.safety(SCR, o).ok, 'safety');
});
t('premium edit: one cell changes, NA works, scripts still parse', () => {
  const o = M.applyVars(SCR, [{ v: 'PREMIUM_RATES', path: 'fwd-standard.30.male-smoker', value: [3500, 350] }, { v: 'PREMIUM_RATES', path: 'fwd-standard.35.male-smoker', value: 'NA' }]);
  const r = M.readVar(o, 'PREMIUM_RATES').data['fwd-standard'];
  eq(JSON.stringify(r[30]['male-smoker']), '[3500,350]'); eq(r[35]['male-smoker'], 'NA');
  assert(M.safety(SCR, o).ok, 'safety'); eq(E.lineDiff(SCR, o).length, 4);
});
t('premium edit with an empty box → blocked with a clear message', () => {
  try { M.applyVars(SCR, [{ v: 'PREMIUM_RATES', path: 'fwd-standard.30.male-smoker', value: [NaN, 350] }]); throw new Error('no error'); }
  catch (e) { assert(/empty or not a number/.test(e.message), e.message); }
});
const HERO = fs.readFileSync(path.join(COMP, 'hero.html'), 'utf8');
t('hero text controlled by Page text is marked locked', () => {
  const F = M.htmlFields(HERO, { overriddenIds: life.overriddenIds });
  assert(F.filter(f => f.kind === 'text').every(f => f.lockedBy), JSON.stringify(F.map(f => f.lockedBy)));
});
const SEO = fs.readFileSync(path.join(COMP, 'seo-content.html'), 'utf8');
t('content edit: one text changes, tags untouched', () => {
  const F = M.htmlFields(SEO); const k = F.findIndex(f => f.kind === 'text' && f.value.length > 10);
  const o = M.applyHtml(SEO, F, { [k]: 'New paragraph text' });
  eq(E.lineDiff(SEO, o).length, 2); assert(M.safety(SEO, o).ok, 'safety');
});
t('content edit: text with < is rejected', () => {
  const F = M.htmlFields(SEO); const k = F.findIndex(f => f.kind === 'text');
  assert(M.htmlFieldErrors(F, { [k]: 'a <b>bold' }).length === 1, 'should reject');
});
const BAN = fs.readFileSync(path.join(COMP, 'promo-banner.html'), 'utf8');
t('banner: link must be https, alt cannot be empty', () => {
  const F = M.htmlFields(BAN); const href = F.findIndex(f => f.attr === 'href'), alt = F.findIndex(f => f.attr === 'alt');
  eq(M.htmlFieldErrors(F, { [href]: 'www.fwd.com', [alt]: ' ' }).length, 2);
});
t('banner: add then remove → original bytes; added banner keeps tracking hooks', () => {
  const a = M.addSlide(BAN); eq(M.slides(a).length, 2); assert(M.safety(BAN, a, { expectStructure: true }).ok, 'safety');
  eq(M.removeSlide(a, 1), BAN);
});
t('direct code: removing an id the scripts use → blocked', () => {
  const SB = fs.readFileSync(path.join(COMP, 'sidebar-and-products.html'), 'utf8');
  const o = SB.replace(/\sid="[^"]+"/, '');
  assert(o !== SB, 'fixture has an id'); const s = M.safety(SB, o); assert(!s.ok && /relies on/.test(s.errors.join()), s.errors.join());
  assert(M.safety(SB, o, { allowHookRemoval: true }).ok, 'override should allow');
});
t('direct code: deleting a function from scripts → blocked', () => {
  const o = SCR.replace('function getPlanPrice(', 'function getPlanPriceX(');
  assert(!M.safety(SCR, o).ok, 'should block');
});
t('direct code: syntax error in scripts → blocked', () => assert(!M.safety(SCR, SCR.replace('var LANG=', 'var LANG==')).ok, 'should block'));
t('direct code: broken CSS brace → blocked', () => {
  const ST = fs.readFileSync(path.join(COMP, 'styles.html'), 'utf8');
  assert(!M.safety(ST, ST.replace('}', '')).ok, 'should block');
});
t('direct code: broken JSON-LD in head → blocked', () => {
  const HD = fs.readFileSync(path.join(COMP, 'head.html'), 'utf8');
  const i = HD.indexOf('ld+json'); const o = HD.slice(0, i) + HD.slice(i).replace('{', '{,');
  assert(!M.safety(HD, o).ok, 'should block');
});

console.log('\nreview.js (the copy-button gate)');
const R = require('./review.js');
const pd = life.modules.find(m => m.file === 'product-data');
t('review: untouched module → no changes, copy stays off', () => {
  const d = E.load(SRC, cfg); const r = R.review(life, pd, { mode: 'form', original: SRC, doc: d, order: d.records.map(x => x.id), fields: {} });
  eq(r.changes.length, 0);
});
t('review: ranking change → ok with a Ranking row', () => {
  const d = E.load(SRC, cfg); const r = R.review(life, pd, { mode: 'form', original: SRC, doc: d, order: d.records.map(x => x.id).reverse(), fields: {} });
  assert(r.res.ok && r.changes.some(c => c.product === 'Ranking'), JSON.stringify(r.res));
});
t('review: bad promo code → blocked', () => {
  const d = E.load(SRC, cfg); const r = R.review(life, pd, { mode: 'form', original: SRC, doc: d, order: d.records.map(x => x.id), fields: { [first]: { 'exclusive.code': 'BAD CODE' } } });
  assert(!r.res.ok, 'should block');
});
t('review: scripts premium edit → change row; empty cell → blocked', () => {
  const sm = life.modules.find(m => m.file === 'scripts');
  const ok = R.review(life, sm, { mode: 'form', original: SCR, base: SCR, vedits: { 'PREMIUM_RATES|bowtie.30.male-non-smoker': { v: 'PREMIUM_RATES', path: 'bowtie.30.male-non-smoker', value: [1776, 1500] } } });
  assert(ok.res.ok && ok.changes.length === 1, JSON.stringify(ok));
  const bad = R.review(life, sm, { mode: 'form', original: SCR, base: SCR, vedits: { 'PREMIUM_RATES|bowtie.30.male-non-smoker': { v: 'PREMIUM_RATES', path: 'bowtie.30.male-non-smoker', value: [NaN, 1500] } } });
  assert(!bad.res.ok, 'should block');
});

console.log('\nLive-page check (snapshot of the live ZH page, 2026-10-15)');
const LIVE = fs.readFileSync(path.join(here, 'fixtures/life-zh-live-2026-10-15.html'), 'utf8');
// What the live page actually held on 2026-10-15, verified by hand: these repo copies are current…
const CURRENT = ['head', 'styles', 'hero', 'promo-banner', 'sidebar-and-products', 'claims-section', 'seo-content', 'sticky-elements', 'product-data'];
// …these were edited in HubSpot and never copied back (emoji added, 💪🏻 → 💪🏽)…
const DRIFTED = ['trust-bar', 'compare-banner', 'footer-cta', 'scripts'];
// …and these are not on the live page at all.
const ABSENT = ['mobile-quote-bar', 'category-tabs', 'faq-section'];
for (const m of life.modules) {
  const h = fs.readFileSync(path.join(COMP, m.file + '.html'), 'utf8');
  const want = CURRENT.includes(m.file) ? 'match' : DRIFTED.includes(m.file) ? 'changed' : ABSENT.includes(m.file) ? 'missing' : '?';
  t(`live check: ${m.file} → ${want}`, () => eq(M.liveCheck(h, LIVE, m.fingerprint).status, want));
}
t('live check positive control: one-character edit to a matching module → changed', () => {
  const h = fs.readFileSync(path.join(COMP, 'product-data.html'), 'utf8').replace("code:'MHFWD'", "code:'MHFWX'");
  eq(M.liveCheck(h, LIVE, 'PRODUCT DATA').status, 'changed');
});
t('live check positive control: a line added on the live page → changed', () => {
  const h = fs.readFileSync(path.join(COMP, 'hero.html'), 'utf8');
  const L2 = LIVE.replace('<!-- Component: Hero Section -->', '<!-- Component: Hero Section -->\n<p>new line</p>');
  eq(M.liveCheck(h, L2, 'Component: Hero Section').status, 'changed');
});

console.log('\nLoad from live page (snapshot script logic)');
for (const m of life.modules) {
  t(`live code for ${m.file}: found once, passes safety, loads in its editor`, () => {
    const r = M.liveModuleCode(LIVE, m.fingerprint); assert(r.code, r.error);
    assert(M.safety(r.code, r.code).ok, 'safety');
    if (m.editor === 'products') eq(E.load(r.code, cfg).records.length, 6);
    if (m.vars) m.vars.filter(v => v.v[0] !== '@').forEach(v => assert(M.readVar(r.code, v.v), v.v));
    eq(M.liveCheck(r.code, LIVE, m.fingerprint).status, 'match');
  });
}
t('live product-data: ranking change on live code → checks pass, browser order correct', () => {
  const code = M.liveModuleCode(LIVE, 'PRODUCT DATA').code; const d = E.load(code, cfg);
  const order = d.records.map(r => r.id).reverse(); const o = E.build(d, { order });
  assert(E.check(code, o, cfg).ok, 'check'); eq(runModule(o).P.map(p => p.id).join(), order.join());
});

/* ===== Life EN, CI, OSI — against saved copies of their live pages (2026-10-15) ===== */
for (const key of ['life-en', 'ci', 'osi']) {
  const page = PAGES.find(p => p.key === key), pc = page.data;
  const LV = fs.readFileSync(path.join(here, `fixtures/${key}-live-2026-10-15.html`), 'utf8');
  console.log(`\n${page.label} (live copy)`);
  const codeOf = m => M.liveModuleCode(LV, m.fingerprint).code;
  for (const m of page.modules) {
    t(`${key} ${m.file}: found once on live, passes safety, loads in its editor`, () => {
      const r = M.liveModuleCode(LV, m.fingerprint); assert(r.code, r.error);
      assert(M.safety(r.code, r.code).ok, M.safety(r.code, r.code).errors.join());
      if (m.editor === 'products') { const d = E.load(r.code, pc); assert(d.records.length > 3, 'records'); const c = E.check(r.code, r.code, pc); assert(c.ok, c.errors.join('; ')); const other = c.warnings.filter(w => !/expired/.test(w)); eq(other.length, 0, 'warnings on untouched live data: ' + other.join('; ')); }
      (m.vars || []).filter(v => v.v[0] !== '@').forEach(v => assert(M.readVar(r.code, v.v), v.v + ' missing'));
      if (m.editor === 'banner') assert(M.slides(r.code).length >= 1, 'no banner slides found');
      if (m.editor === 'content' || m.editor === 'banner') M.htmlFields(r.code, { overriddenIds: page.overriddenIds });
      eq(M.liveCheck(r.code, LV, m.fingerprint).status, 'match');
    });
  }
  const pdm = page.modules.find(m => m.editor === 'products'), PD = codeOf(pdm), D = E.load(PD, pc), ids = D.records.map(r => r.id);
  const allIds = h => { const c = runModule(h); return (c.P_ALL || c.P).map(p => p.id); };
  t(`${key}: no-op build is byte-identical; parser matches the browser`, () => {
    eq(E.build(D, {}), PD);
    eq(JSON.stringify(D.records.map(r => r.data)), JSON.stringify(runModule(PD).P_ALL || runModule(PD).P));
  });
  t(`${key}: reverse ranking → browser order, checks pass, reverse back → original bytes`, () => {
    const o = E.build(D, { order: [...ids].reverse() });
    eq(allIds(o).join(), [...ids].reverse().join()); assert(E.check(PD, o, pc).ok, E.check(PD, o, pc).errors.join());
    eq(E.build(E.load(o, pc), { order: ids }), PD);
  });
  t(`${key}: each product's label comment moves with it`, () => {
    const o = E.build(D, { order: [...ids].reverse() }), L = E.load(o, pc);
    L.records.forEach((r, k) => {
      const block = o.slice(L.blocks[k].from, L.blocks[k].to);
      const name = typeof r.data.name === 'string' ? r.data.name : (r.data.name.zh || r.data.name.en);
      const first = (block.match(/\/\*[\s\S]*?\*\//) || [''])[0];
      assert(first.includes(name.slice(0, 6)) || /PRODUCT CARD START/.test(first), `block ${k} (${r.id}) starts with ${JSON.stringify(first.slice(0, 80))}`);
    });
  });
  const fv = (pdm.vars || []).find(v => v.kind === 'list');
  if (fv) {
    t(`${key}: FAQ edit → one value changes; review gate passes with a FAQ row`, () => {
      const p0 = '0.' + fv.fields[0].p, o = M.applyVars(PD, [{ v: 'FAQS', path: p0, value: '新問題？' }]);
      eq(String(p0.split('.').slice(1).reduce((x, k) => x[k], M.readVar(o, 'FAQS').data[0])), '新問題？');
      const st = { mode: 'form', original: PD, doc: D, order: ids, fields: {}, base: PD, vedits: { ['FAQS|' + p0]: { v: 'FAQS', path: p0, value: '新問題？' } } };
      const r = R.review(page, pdm, st); assert(r.res.ok, r.res.errors.join()); assert(r.changes.some(c => /FAQ/.test(c.product)), JSON.stringify(r.changes));
    });
  }
}

console.log('\nCI on/off switch');
{
  const page = PAGES.find(p => p.key === 'ci'), pc = page.data, pdm = page.modules.find(m => m.editor === 'products');
  const PD = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/ci-live-2026-10-15.html'), 'utf8'), pdm.fingerprint).code, D = E.load(PD, pc);
  const on = D.records.find(r => r.data.enabled !== false).id, off = D.records.find(r => r.data.enabled === false).id;
  t('turning a product off adds enabled:false; the page drops it; Ranking row lists the change', () => {
    const o = E.build(D, { fields: { [on]: { enabled: false } } });
    assert(!runModule(o).P.some(p => p.id === on), 'still shown'); eq(E.lineDiff(PD, o).length, 1, 'one added line');
    assert(E.check(PD, o, pc).ok, 'check'); const cl = E.changeList(PD, o, pc);
    assert(cl.some(c => c.product === 'Ranking') && cl.some(c => c.after === 'Off (hidden)'), JSON.stringify(cl));
  });
  t('turning a hidden product on flips enabled:false → true and the page shows it', () => {
    const o = E.build(D, { fields: { [off]: { enabled: true } } });
    assert(runModule(o).P.some(p => p.id === off), 'not shown'); eq(E.lineDiff(PD, o).length, 2);
  });
  t('switching on a product that is already on changes nothing', () => eq(E.build(D, { fields: { [on]: { enabled: true } } }), PD));
}

console.log('\nOSI numbers, badges, empty values');
{
  const page = PAGES.find(p => p.key === 'osi'), pc = page.data, pdm = page.modules.find(m => m.editor === 'products');
  const PD = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/osi-live-2026-10-15.html'), 'utf8'), pdm.fingerprint).code, D = E.load(PD, pc);
  const a = D.records.find(r => r.data.disc != null && r.data.badge), id = a.id;
  t('price, discount, empty discount, empty badge → browser sees numbers and null', () => {
    const o = E.build(D, { fields: { [id]: { price: 4500, disc: null, badge: null, promo: null } } });
    const p = runModule(o).P.find(x => x.id === id); eq(p.price, 4500); eq(p.disc, null); eq(p.badge, null); eq(p.promo, null);
    assert(E.check(PD, o, pc).ok, E.check(PD, o, pc).errors.join());
  });
  t('removing a badge moves the product down the visible ranking', () => {
    const o = E.build(D, { fields: { [id]: { badge: null } } });
    assert(E.changeList(PD, o, pc).some(c => c.product === 'Ranking'), 'no Ranking row');
  });
  t('discount higher than price → warning; empty price → blocked', () => {
    const o = E.build(D, { fields: { [id]: { disc: a.data.price + 100 } } });
    assert(E.check(PD, o, pc).warnings.some(w => /not lower/.test(w)), 'warn');
    try { E.build(D, { fields: { [id]: { price: NaN } } }); throw new Error('no error'); } catch (e) { assert(/empty or not a number/.test(e.message), e.message); }
  });
  t('unknown destination or issuer → blocked', () => {
    assert(!E.check(PD, E.build(D, { fields: { [id]: { dest: 'europe' } } }), pc).ok, 'dest');
    assert(!E.check(PD, E.build(D, { fields: { [id]: { iss: 'nobody' } } }), pc).ok, 'iss');
  });
}

console.log('\nCI premium table formats');
{
  const page = PAGES.find(p => p.key === 'ci'), pdm = page.modules.find(m => m.editor === 'products');
  const PD = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/ci-live-2026-10-15.html'), 'utf8'), pdm.fingerprint).code, D = E.load(PD, page.data);
  const st = ve => ({ mode: 'form', original: PD, doc: D, order: D.records.map(r => r.id), fields: {}, base: PD, vedits: Object.fromEntries(ve.map(e => ['PREMIUM_RATES|' + e.path, { v: 'PREMIUM_RATES', ...e }])) });
  t('a ranking change alone raises no premium warnings (old data is not re-checked)', () => {
    const r = R.review(page, pdm, { ...st([]), order: D.records.map(r => r.id).reverse() }); eq(r.res.warnings.length, 0, r.res.warnings.slice(0, 3).join(' | '));
  });
  t('empty discount → null is fine; note cell edit is fine', () => {
    const r = R.review(page, pdm, st([{ path: 'fwd-upgrade.0.male-smoker-1y', value: [800, null] }, { path: 'zurich-care.0.male-smoker-1y', value: { n: '請到官網索取報價。' } }]));
    assert(r.res.ok && r.res.warnings.length === 0, JSON.stringify(r.res)); eq(r.changes.length, 2);
  });
  t('empty note or discount above original → warning', () => {
    const r = R.review(page, pdm, st([{ path: 'zurich-care.0.male-smoker-1y', value: { n: '' } }, { path: 'fwd-upgrade.0.male-smoker-1y', value: [100, 200] }]));
    eq(r.res.warnings.length, 2, r.res.warnings.join(' | '));
  });
}

console.log('\nVHIS (live copy)');
{
  const page = PAGES.find(p => p.key === 'vhis'), pc = page.data;
  const LV = fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-15.html'), 'utf8');
  for (const m of page.modules) {
    t(`vhis ${m.file}: found once on live, passes safety, loads in its editor`, () => {
      const r = M.liveModuleCode(LV, m.fingerprint); assert(r.code, r.error);
      assert(M.safety(r.code, r.code).ok, M.safety(r.code, r.code).errors.join());
      if (m.editor === 'products') { const c = E.check(r.code, r.code, pc); assert(c.ok, c.errors.join('; ')); }
      (m.vars || []).filter(v => v.v[0] !== '@').forEach(v => assert(M.readVar(r.code, v.v), v.v));
      if (m.editor === 'content') M.htmlFields(r.code, {});
      eq(M.liveCheck(r.code, LV, m.fingerprint).status, 'match');
    });
  }
  const pdm = page.modules.find(m => m.editor === 'products'), PD = M.liveModuleCode(LV, pdm.fingerprint).code, D = E.load(PD, pc);
  const shown = h => runModule(h).DATA.products.slice().sort((a, b) => ((a.rank == null ? Infinity : a.rank) - (b.rank == null ? Infinity : b.rank)) || a.name.localeCompare(b.name)).map(p => p.id);
  const base = shown(PD);
  t('vhis: parser matches the browser; no-op and "same order" builds are byte-identical', () => {
    eq(JSON.stringify(D.records.map(r => r.data)), JSON.stringify(runModule(PD).DATA.products));
    eq(E.build(D, {}), PD); eq(E.build(D, { order: base }), PD);
  });
  t('vhis: reverse the ranking → page order reversed, products stay in place, only rank numbers change', () => {
    const o = E.build(D, { order: [...base].reverse() });
    eq(shown(o).join(), [...base].reverse().join());
    eq(runModule(o).DATA.products.map(p => p.id).join(), runModule(PD).DATA.products.map(p => p.id).join(), 'array order');
    eq(o.split('\n').length, PD.split('\n').length); assert(E.check(PD, o, pc).ok, E.check(PD, o, pc).errors.join());
    assert(E.changeList(PD, o, pc).some(c => c.product === 'Ranking'), 'ranking row');
    const strip = h => runModule(h).DATA.products.map(({ rank, ...rest }) => JSON.stringify(rest)).join();
    eq(strip(o), strip(PD), 'only rank changed');
  });
  t('vhis: offer end, tags, code, link edits → browser sees them; bad date is caught by the form rule', () => {
    const id = D.records.find(r => r.data.offer).id;
    const o = E.build(D, { fields: { [id]: { 'offer.end': '2026-12-31', tags: ['新標籤'], 'offer.code': 'MHVHIS', url: 'https://example.com/a?b=1' } } });
    const p = runModule(o).DATA.products.find(x => x.id === id);
    eq(p.offer.end, '2026-12-31'); eq(JSON.stringify(p.tags), '["新標籤"]'); eq(p.offer.code, 'MHVHIS'); assert(E.check(PD, o, pc).ok, 'check');
    const f = pc.fields.find(x => x.path === 'offer.end'); assert(!new RegExp(f.pattern).test('31/12/2026'), 'pattern');
  });
  t('vhis: expired offer end → warning', () => {
    const id = D.records.find(r => r.data.offer).id, o = E.build(D, { fields: { [id]: { 'offer.end': '2026-01-01' } } });
    assert(E.check(PD, o, { ...pc, today: '2026-10-15' }).warnings.some(w => /expired/.test(w)), 'warn');
  });
  t('vhis: banner list edit (module 09) → one value changes, safety passes', () => {
    const m9 = page.modules.find(m => m.file === '09 banner'), C9 = M.liveModuleCode(LV, m9.fingerprint).code;
    const o = M.applyVars(C9, [{ v: 'BANNERS', path: '0.alt', value: '新 banner 文字' }]);
    eq(M.readVar(o, 'BANNERS').data[0].alt, '新 banner 文字'); eq(E.lineDiff(C9, o).length, 2); assert(M.safety(C9, o).ok, 'safety');
  });
}

console.log('\nVHIS premiums');
{
  const page = PAGES.find(p => p.key === 'vhis'), pc = page.data, pdm = page.modules.find(m => m.editor === 'products');
  const PD = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-15.html'), 'utf8'), pdm.fingerprint).code, D = E.load(PD, pc);
  const id = 'fwd-vprime', old = D.records.find(r => r.id === id).data;
  t('change one premium and one first-year price → browser sees them; summary lists each cell', () => {
    const p1 = old.premiums['30']['male-non-smoker'].slice(); p1[0] = 9999;
    const p2 = old.discount.prices['30']['male-non-smoker'].slice(); p2[1] = 1234;
    const o = E.build(D, { fields: { [id]: { 'premiums.30.male-non-smoker': p1, 'discount.prices.30.male-non-smoker': p2 } } });
    const p = runModule(o).DATA.products.find(x => x.id === id);
    eq(p.premiums['30']['male-non-smoker'][0], 9999); eq(p.discount.prices['30']['male-non-smoker'][1], 1234);
    assert(E.check(PD, o, pc).ok, E.check(PD, o, pc).errors.join());
    const cl = E.changeList(PD, o, pc); eq(cl.length, 2, JSON.stringify(cl));
    assert(/Premium 30 · male-non-smoker/.test(cl[0].field), cl[0].field);
  });
  // Philip, 2026-10-16: badges compare the prices the tiles show. FWD 尊衛您's real 16/10 numbers.
  const st = f => ({ mode: 'form', original: PD, doc: D, order: D.records.map(r => r.id), fields: f, base: PD, vedits: {} });
  const fwd = (full, promo) => st({ [id]: { 'premiums.30.male-non-smoker': full, 'discount.prices.30.male-non-smoker': promo } });
  const FULL = [14265, 6700, 5756, 4380, 3441, 2774], PROMO = [10699, 3908, 3358, 2555, 2007, 1618];
  const badgeRow = r => r.changes.find(c => /badges/.test(c.field));
  t('premium upload → review shows the badges the page will show (−63% … −85%), no warnings', () => {
    const r = R.review(page, pdm, fwd(FULL, PROMO));
    assert(r.res.ok, r.res.errors.join()); eq(r.res.warnings.length, 0, r.res.warnings.join());
    eq(badgeRow(r).after, 'HK$16,000 −63% · HK$25,000 −69% · HK$50,000 −76% · HK$100,000 −81% · HK$250,000 −85%');
  });
  t('live module 09 (16/10) works the badge out from the shown price (same sum as review.js)', () => {
    const m9 = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-16.html'), 'utf8'), 'MODULE 09 —').code;
    assert(m9.includes("function shown(i){ return discAmt(p,i)!=null ? discAmt(p,i) : rates[i]; }") && m9.includes('(1 - shown(i)/basePrice)'),
      'deductibleBlock changed - update tierBadges in review.js to match');
  });
  t('removing the shown-price badge from module 09 → copy blocked', () => {
    const m9 = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-16.html'), 'utf8'), 'MODULE 09 —').code;
    const old = m9.replace(/function shown\(i\)\{[^\n]*\}\n\s*var basePrice = shown\(base\);/, 'var basePrice = rates[base];').replace(/shown\(i\)/g, 'rates[i]');
    assert(old !== m9, 'replace did not apply');
    assert(!M.safety(m9, old, {}).ok, 'safety should refuse removing shown()');
  });
  t('offer price above full premium → warning', () => {
    const r = R.review(page, pdm, fwd(FULL, [10699, 7000, 3358, 2555, 2007, 1618]));
    assert(r.res.warnings.some(w => /higher than the full premium/.test(w)), r.res.warnings.join());
  });
  t('only some tiers have an offer price → warning', () => {
    const r = R.review(page, pdm, fwd(FULL, [10699, null, 3358, 2555, 2007, 1618]));
    assert(r.res.warnings.some(w => /some deductible tiers have an offer price/.test(w)), r.res.warnings.join());
  });
  t('higher deductible not cheaper → −0% warning', () => {
    const r = R.review(page, pdm, fwd(FULL, [3000, 3908, 3358, 2555, 2007, 1618]));
    assert(r.res.warnings.some(w => /−0% or less/.test(w)), r.res.warnings.join());
  });
  t('unrelated edit (tags) → no badge row, no badge warnings', () => {
    const r = R.review(page, pdm, st({ [id]: { tags: ['a'] } }));
    assert(!badgeRow(r), 'unexpected badge row'); eq(r.res.warnings.length, 0, r.res.warnings.join());
  });
  t('empty premium cell → blocked', () => {
    const p1 = old.premiums['30']['male-non-smoker'].slice(); p1[0] = NaN;
    try { E.build(D, { fields: { [id]: { 'premiums.30.male-non-smoker': p1 } } }); throw new Error('no error'); } catch (e) { assert(/empty or not a number/.test(e.message), e.message); }
  });
}

console.log('\nTags');
{
  const page = PAGES.find(p => p.key === 'vhis'), pdm = page.modules.find(m => m.editor === 'products');
  const PD = M.liveModuleCode(fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-15.html'), 'utf8'), pdm.fingerprint).code, D = E.load(PD, page.data);
  const st = f => ({ mode: 'form', original: PD, doc: D, order: D.records.map(r => r.id), fields: f, base: PD, vedits: {} });
  t('empty tag → blocked; filled tag → fine', () => {
    assert(!R.review(page, pdm, st({ 'fwd-vprime': { tags: ['a', ''] } })).res.ok, 'empty should block');
    assert(R.review(page, pdm, st({ 'fwd-vprime': { tags: ['a', 'b'] } })).res.ok, 'filled should pass');
  });
  const lp = PAGES.find(p => p.key === 'life-zh'), lm = lp.modules.find(m => m.editor === 'products');
  const LPD = M.liveModuleCode(LIVE, lm.fingerprint).code, LD = E.load(LPD, lp.data);
  t('Life tag with empty Chinese → blocked', () => {
    const r = R.review(lp, lm, { mode: 'form', original: LPD, doc: LD, order: LD.records.map(r => r.id), fields: { bowtie: { tags: [{ zh: '', en: 'x', c: 't-blue' }] } }, base: LPD, vedits: {} });
    assert(!r.res.ok, 'should block');
  });
}

console.log('\nPaste the Excel sheet (real RP Product Details exports)');
{
  const X = require('./excel.js');
  const XL = f => fs.readFileSync(path.join(here, 'fixtures/excel', f), 'utf8');
  const get = (o, p) => p.split('.').reduce((x, k) => x == null ? x : x[k], o);
  const live = key => fs.readFileSync(path.join(here, `fixtures/${key}-live-2026-10-15.html`), 'utf8');
  const prodsOf = (page, code) => E.load(code, page.data).records.map(r => ({ id: r.id, names: [page.data.productLabel(r.data)], aliases: [], provider: [r.data.insurer || r.data.iss || '', r.data.providerId || ''], tiers: r.data.deductibleTiers ? r.data.deductibleTiers.length : null, data: r.data }));
  const count = (res, curOf) => { let same = 0, change = 0, off = 0; res.edits.forEach(e => { if (e.hide) return; const c = curOf(e); if (c === undefined) off++; else if (JSON.stringify(c) === JSON.stringify(e.value)) same++; else change++; }); return { same, change, off }; };
  // Life
  const lp = PAGES.find(p => p.key === 'life-zh'), lv = lp.modules.find(m => m.file === 'scripts').vars.find(v => v.excel);
  const LP = prodsOf(lp, M.liveModuleCode(live('life-zh'), 'PRODUCT DATA').code).map(p => ({ ...p, aliases: lv.excel.aliases[p.id] || [] }));
  const LR = M.readVar(M.liveModuleCode(live('life-zh'), 'var PREMIUM_RATES').code, 'PREMIUM_RATES').data;
  for (const f of ['fwd', 'zurich', 'bowtie', 'blue']) t(`Life "Premium ${f}" sheet → matches live exactly (0 changes)`, () => {
    const res = X.importSheet(XL(`life-premium-${f}.tsv`), LP, { v: 'PREMIUM_RATES', sumInsured: '3M', expect: ['long'] });
    const c = count(res, e => get(LR, e.path)); eq(c.change, 0, JSON.stringify(c)); assert(c.same >= 16, JSON.stringify(c)); eq(res.unmatched.length, 0, res.unmatched.join());
  });
  t('Life: names match by the known Excel names, not by guessing', () => {
    const res = X.importSheet(XL('life-premium-fwd.tsv'), LP, { v: 'PREMIUM_RATES', sumInsured: '3M' });
    assert(res.matches.every(m => m.how === 'known name' || m.how === 'same name'), JSON.stringify(res.matches));
  });
  t('Life: one changed number in the sheet → exactly one change', () => {
    const txt = XL('life-premium-bowtie.tsv').replace('\t1332\t1132.2', '\t1332\t999');
    eq(count(X.importSheet(txt, LP, { v: 'PREMIUM_RATES', sumInsured: '3M' }), e => get(LR, e.path)).change, 1);
  });
  // CI
  const cp = PAGES.find(p => p.key === 'ci'), CPD = M.liveModuleCode(live('ci'), 'var PREMIUM_RATES').code, CR = M.readVar(CPD, 'PREMIUM_RATES').data;
  t('CI "Premium" sheet → all 16 plans matched (Bowtie by provider), 0 changes', () => {
    const res = X.importSheet(XL('ci-premium.tsv'), prodsOf(cp, CPD), { v: 'PREMIUM_RATES', expect: ['ci'] });
    eq(res.matches.length, 16, res.unmatched.join()); const c = count(res, e => get(CR, e.path)); eq(c.change, 0); assert(c.same > 700, JSON.stringify(c));
  });
  // VHIS
  const vp = PAGES.find(p => p.key === 'vhis'), VPD = M.liveModuleCode(live('vhis'), 'MODULE 08 —').code, VP = prodsOf(vp, VPD), by = Object.fromEntries(VP.map(p => [p.id, p.data]));
  t('VHIS "Premium" sheet → 0 changes; female rows ("W") read; another insurer\'s plan (Avo) never matched', () => {
    const res = X.importSheet(XL('vhis-premium.tsv'), VP, { which: 'premium', expect: ['vhis'] });
    const c = count(res, e => get(by[e.id], e.path)); eq(c.change, 0, JSON.stringify(c)); eq(c.same, 4536);
    assert(res.edits.some(e => /female-smoker/.test(e.path)), 'female rows'); assert(res.unmatched.some(n => /Avo/.test(n)), 'Avo should be unmatched');
  });
  t('VHIS "Discounted Premium" sheet → 0 changes (rounding matches the build script)', () => {
    const res = X.importSheet(XL('vhis-discounted.tsv'), VP, { which: 'discount', premiumOf: (id, a, k) => get(by[id], 'premiums.' + a + '.' + k) });
    eq(count(res, e => get(by[e.id], e.path)).change, 0);
  });
  // OSI
  const op = PAGES.find(p => p.key === 'osi'), OPD = M.liveModuleCode(live('osi'), 'var ISSUERS').code, OP = prodsOf(op, OPD), ob = Object.fromEntries(OP.map(p => [p.id, p.data]));
  t('OSI sheet (June file) → 23 plans matched; repeated plan row flagged; old values show as changes', () => {
    const res = X.importSheet(XL('osi-sheet1.tsv'), OP, { expect: ['osi'] });
    eq(res.matches.length, 23); assert(res.notes.some(n => /more than one row/.test(n)), res.notes.join(' | '));
    assert(count(res, e => get(ob[e.id], e.path)).change > 0, 'old file should differ');
  });
  // safety
  t('wrong sheet for the page → clear error', () => assert(/different sheet/.test(X.importSheet(XL('ci-premium.tsv'), LP, { expect: ['long'] }).error), 'error'));
  t('random text → clear error', () => assert(/does not look like/.test(X.importSheet('hello\tworld', LP, {}).error), 'error'));
  t('Excel quoting: cells with tabs, newlines and quotes survive', () => {
    const rows = X.parseTSV('a\t"line1\nline2"\t"say ""hi"""\nb\tc\td\n');
    eq(rows[0][1], 'line1\nline2'); eq(rows[0][2], 'say "hi"'); eq(rows[1].join(), 'b,c,d');
  });
  t('numbers with commas, HK$ and $ are read', () => {
    const txt = XL('life-premium-bowtie.tsv').replace('\t2400\t2040', '\tHK$2,400\t$2,040');
    eq(count(X.importSheet(txt, LP, { v: 'PREMIUM_RATES', sumInsured: '3M' }), e => get(LR, e.path)).change, 0);
  });
}

console.log('\nVHIS: add a plan from the Product Details sheet');
{
  const X = require('./excel.js'), XL = f => fs.readFileSync(path.join(here, 'fixtures/excel', f), 'utf8');
  const vp = PAGES.find(p => p.key === 'vhis'), LV = fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-15.html'), 'utf8');
  const M8 = M.liveModuleCode(LV, 'MODULE 08 —').code, M9 = M.liveModuleCode(LV, 'MODULE 09 —').code;
  const live = E.toJS(E.parseValueAt(M8, M8.indexOf('var DATA = ') + 11)).products;
  const det = X.vhisDetails(XL('vhis-product-details.tsv'));
  const build = (name, id, prov) => X.vhisBuildPlan(det, { col: det.plans.find(p => p.name === name).col, id, providerId: prov, premium: XL('vhis-premium.tsv'), discount: XL('vhis-discounted.tsv') });
  t('every live plan rebuilds from Phillip\'s sheets exactly as the build script made it (all fields, all premiums)', () => {
    let n = 0;
    for (const lp of live) {
      const base = lp.id.replace(/-(asia|global)$/, ''), p = det.plans.find(x => lp.name === x.name || lp.name.indexOf(x.name + ' - ') === 0);
      const r = build(p.name, base, lp.providerId).records.find(x => x.id === lp.id);
      eq(JSON.stringify({ ...r, rank: lp.rank }), JSON.stringify(lp), lp.id); n++;
    }
    eq(n, 16);
  });
  t('a plan priced for two areas becomes two plans (Blue Cross 愛自己 → -asia / -global)', () => eq(build('藍十字 愛自己自願醫保計劃', 'bluecross-self', 'bluecross').records.map(r => r.id).join(), 'bluecross-self-asia,bluecross-self-global'));
  t('no apply link → refused; Disabled in the sheet → warned', () => {
    const avo = build('Avo ⾃願醫保(標準)計劃', 'avo-standard', 'avo'); assert(avo.problems.some(p => /Referral Link/.test(p)), 'link'); assert(avo.warnings.some(w => /Disabled/.test(w)), 'disabled');
  });
  t('remove a live plan, add it back from the sheet → same record; page checks pass; ranking puts it where asked', () => {
    const cfg = vp.data, D = E.load(M8, cfg), without = D.records.filter(r => r.id !== 'fwd-family');
    // module 08 without fwd-family, as if it were a new plan
    const b = D.blocks[D.records.findIndex(r => r.id === 'fwd-family')];
    let m8 = M8.slice(0, b.from) + M8.slice(b.to); m8 = m8.replace(',]', ']').replace(',,', ',');
    E.load(m8, cfg);
    const rec = build('FWD 醫家保醫療計劃', 'fwd-family', 'fwd').records[0];
    const out = E.appendRecords(m8, cfg, [rec]);
    const got = runModule(out).DATA.products.find(p => p.id === 'fwd-family');
    eq(JSON.stringify(got), JSON.stringify({ ...live.find(p => p.id === 'fwd-family'), rank: null }));
    const D2 = E.load(out, cfg), order = cfg.displayOrder(D2.records.map(r => r.data)).map(d => d.id).filter(id => id !== 'fwd-family');
    order.splice(2, 0, 'fwd-family');
    const o2 = E.build(D2, { order });
    const shown = cfg.displayOrder(runModule(o2).DATA.products).map(p => p.id);
    eq(shown.indexOf('fwd-family'), 2);
    const c = E.check(m8, o2, { ...cfg, allowNewIds: ['fwd-family'] }); assert(c.ok, c.errors.join());
    assert(!E.check(m8, o2, cfg).ok, 'without allowNewIds the new product must be flagged');
    assert(E.changeList(m8, o2, cfg).some(x => x.field === 'New product'), 'change list shows the new plan');
  });
  t('module 09: a new plan\'s "viewed" count and a new provider logo are added in the module\'s own style', () => {
    const o = M.applyVars(M9, [{ v: 'SOCIAL_PROOF', path: 'bluecross-premier-asia', value: 5 }, { v: 'LOGOS', path: 'newco', value: 'https://www.google.com/s2/favicons?domain=newco.hk&sz=128' }]);
    eq(M.readVar(o, 'SOCIAL_PROOF').data['bluecross-premier-asia'], 5); eq(M.readVar(o, 'LOGOS').data.newco, 'https://www.google.com/s2/favicons?domain=newco.hk&sz=128');
    assert(o.includes("'bluecross-premier-asia':5"), 'quoted like the other keys'); assert(M.safety(M9, o).ok, 'safety');
  });
}

console.log('\nVHIS add a plan: one column copied on its own');
{
  const X = require('./excel.js'), XL = f => fs.readFileSync(path.join(here, 'fixtures/excel', f), 'utf8');
  const LV = fs.readFileSync(path.join(here, 'fixtures/vhis-live-2026-10-15.html'), 'utf8'), M8 = M.liveModuleCode(LV, 'MODULE 08 —').code;
  const live = E.toJS(E.parseValueAt(M8, M8.indexOf('var DATA = ') + 11)).products;
  t('Clara\'s copied column Q (Product Card Status → Referral Link, "31 Mar 2027") → both 愛自己 plans identical to live', () => {
    const det = X.vhisDetails(XL('vhis-column-q-as-copied.txt')); assert(!det.error && det.single, det.error);
    const b = X.vhisBuildPlan(det, { col: 2, id: 'bluecross-self', providerId: 'bluecross', premium: XL('vhis-premium.tsv'), discount: XL('vhis-discounted.tsv') });
    b.records.forEach(r => { const lp = live.find(x => x.id === r.id); eq(JSON.stringify({ ...r, rank: lp.rank }), JSON.stringify(lp), r.id); });
  });
  for (const [what, cut] of [['6 rows missing', [20, 6]], ['one row missing in the middle', [30, 1]], ['one row missing near the links', [70, 1]]])
    t(`a column with ${what} → asks for the whole sheet instead of guessing`, () => {
      const lines = XL('vhis-column-q-as-copied.txt').replace(/\n+$/, '').split('\n'); lines.splice(cut[0], cut[1]);
      assert(/could not line this up/.test(X.vhisDetails(lines.join('\n')).error || ''), 'should refuse');
    });
  t('one row too many (an extra blank line in the middle) → refused too', () => {
    const lines = XL('vhis-column-q-as-copied.txt').replace(/\n+$/, '').split('\n'); lines.splice(30, 0, '');
    assert(/could not line this up/.test(X.vhisDetails(lines.join('\n')).error || ''), 'should refuse');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
