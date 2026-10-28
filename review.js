/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — output + review for one module (no UI)
   output(page, module, state)  → the new module code
   review(page, module, state)  → { out, res: { ok, errors, warnings }, changes: [{product, field, before, after}] }
   The copy button must stay disabled unless res.ok && changes.length.

   state shape per editor (s.mode is 'form' or 'code'; s.original = pasted code; s.code = code-mode text):
     products : s.doc = PCTEngine.load(code, page.data), s.order = [ids], s.fields = { id: { path: value } }
     content / banner : s.base = code, s.fields = PCTModules.htmlFields(code, {overriddenIds}), s.edits = { fieldIdx: value },
                        s.structural = true after a banner add/remove
     scripts  : s.base = code, s.vedits = { 'VAR|path': { v, path, value } }
     products may also carry s.vedits for tables in the same module (premium table, FAQ)
     any      : s.allowHookRemoval (code-mode tick box), s.fromCode (form re-read from edited code)
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var E = root.PCTEngine || require('./engine.js'), M = root.PCTModules || require('./modules.js');
  function get(o, p) { return String(p).split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function output(page, m, s) {
    if (s.mode === 'code') return s.code;
    if (m.editor === 'products') {
      var built = E.build(s.doc, { order: s.order, fields: s.fields });
      var ve = Object.keys(s.vedits || {}).map(function (k) { return s.vedits[k]; });
      return ve.length ? M.applyVars(built, ve) : built;
    }
    if (m.editor === 'content' || m.editor === 'banner') return M.applyHtml(s.base, s.fields, s.edits);
    if (m.editor === 'scripts') return M.applyVars(s.base, Object.keys(s.vedits).map(function (k) { return s.vedits[k]; }));
    return s.code;
  }
  function review(page, m, s) {
    var cfg = function () { return page.data; };
    var out, res = { errors: [], warnings: [] }, changes = [];
    try { out = output(page, m, s); } catch (e) { return { out: null, res: { ok: false, errors: [e.message], warnings: [] }, changes: [] }; }
    if (out === s.original) return { out: out, res: { ok: true, errors: [], warnings: [] }, changes: [] };
    var safe = M.safety(s.original, out, { allowHookRemoval: s.allowHookRemoval, expectStructure: s.structural && s.mode !== 'code', plainJs: !!m.hosted });
    res.errors = res.errors.concat(safe.errors); res.warnings = res.warnings.concat(safe.warnings);
    if (m.editor === 'products') {
      var tablesEdited = Object.keys(s.vedits || {}).length > 0; // premium table / FAQ live outside the product list
      var c = E.check(s.original, out, Object.assign({}, cfg(), { allowOutside: s.mode === 'code' || s.fromCode || tablesEdited, allowNewIds: s.added || [] }));
      res.errors = res.errors.concat(c.errors.filter(function (x) { return res.errors.indexOf(x) < 0; }));
      res.warnings = res.warnings.concat(c.warnings);
      if (s.mode !== 'code') res.errors = res.errors.concat(productPatternErrors(page, s));
      try { changes = E.changeList(s.original, out, cfg()); } catch (e) {}
      if (m.vars) { changes = changes.concat(varChanges(s.original, out, m)); if (s.mode !== 'code') rateWarnings(s.original, out, m).forEach(function (w) { res.warnings.push(w); }); }
      if (m.vars) { var tb = tierBadges(page, m, s.original, out); changes = changes.concat(tb.changes); res.warnings = res.warnings.concat(tb.warnings); }
    } else if ((m.editor === 'content' || m.editor === 'banner') && s.mode !== 'code') {
      res.errors = res.errors.concat(M.htmlFieldErrors(s.fields, s.edits));
      changes = contentChanges(page, s.original, out, m);
    } else if (m.editor === 'scripts') {
      changes = varChanges(s.original, out, m);
      if (s.mode !== 'code') rateWarnings(s.original, out, m).forEach(function (w) { res.warnings.push(w); });
    } else if (m.editor === 'content' || m.editor === 'banner') {
      changes = contentChanges(page, s.original, out, m);
    }
    if (!changes.length) changes = [{ product: m.file, field: 'Code', before: '', after: E.lineDiff(s.original, out).length + ' lines changed — see code changes' }];
    res.ok = res.errors.length === 0;
    return { out: out, res: res, changes: changes };
  }
  function contentChanges(page, a, b, m) {
    var fa = M.htmlFields(a, { overriddenIds: page.overriddenIds }), fb = M.htmlFields(b, { overriddenIds: page.overriddenIds }), out = [];
    if (m.editor === 'banner') { var na = M.slides(a).length, nb = M.slides(b).length; if (na !== nb) out.push({ product: 'Banners', field: 'Number of banners', before: String(na), after: String(nb) }); }
    if (fa.length === fb.length) fa.forEach(function (f, k) { if (f.value !== fb[k].value) out.push({ product: f.where, field: f.label, before: f.value, after: fb[k].value }); });
    else { // structure changed (banner added/removed): list what is new or gone
      var key = function (f) { return f.where + '|' + f.label + '|' + f.value; }, ka = fa.map(key), kb = fb.map(key);
      fb.forEach(function (f, k) { if (ka.indexOf(kb[k]) < 0 && /[\p{L}\p{N}]/u.test(f.value)) out.push({ product: f.where, field: f.label + ' (new)', before: '', after: f.value }); });
      fa.forEach(function (f, k) { if (kb.indexOf(ka[k]) < 0 && /[\p{L}\p{N}]/u.test(f.value)) out.push({ product: f.where, field: f.label + ' (removed)', before: f.value, after: '' }); });
    }
    return out;
  }
  function varChanges(a, b, m) {
    var out = [];
    (m.vars || []).forEach(function (v) {
      var x = M.readVar(a, v.v), y = M.readVar(b, v.v);
      if (!x || !y) { if (x && !y) out.push({ product: v.title, field: v.v, before: 'present', after: 'MISSING' }); return; }
      M.deepDiff(x.data, y.data).forEach(function (d) { out.push({ product: v.title, field: d.path, before: fmt(d.before), after: fmt(d.after) }); });
    });
    return out;
  }
  function fmt(v) { return v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v); }
  // Premium cells: [original, discounted] · [original, null] (no discount, where allowed) · 'NA' · {n: 'note'}.
  // Only cells that differ from the original are checked, so old data never floods the review.
  function rateWarnings(original, out, m) {
    var w = [];
    (m.vars || []).filter(function (v) { return v.kind === 'rates'; }).forEach(function (v) {
      var r = M.readVar(out, v.v), o = M.readVar(original, v.v); if (!r) return;
      Object.keys(r.data).forEach(function (pid) { Object.keys(r.data[pid]).forEach(function (age) { Object.keys(r.data[pid][age]).forEach(function (k) {
        var c = r.data[pid][age][k], before = o && o.data[pid] && o.data[pid][age] ? o.data[pid][age][k] : undefined;
        if (JSON.stringify(c) === JSON.stringify(before)) return;
        var where = pid + ' age ' + age + ' ' + k + ': ';
        if (c === 'NA' && v.na) return;
        if (c && typeof c === 'object' && !Array.isArray(c)) { if (!c.n || !String(c.n).trim()) w.push(where + 'the note is empty.'); return; }
        var okNum = function (x) { return typeof x === 'number' && x > 0; };
        if (!Array.isArray(c) || c.length !== 2 || !okNum(c[0]) || !(okNum(c[1]) || (v.discountOptional && c[1] === null))) w.push(where + 'enter the original premium' + (v.discountOptional ? ' (discounted is optional)' : ' and the discounted premium') + ' as numbers above 0.');
        else if (c[1] !== null && c[1] > c[0]) w.push(where + 'discounted (' + c[1] + ') is higher than original (' + c[0] + ').');
      }); }); });
    });
    return w;
  }
  /* VHIS deductible badges (保費 −XX%). The page works them out in module 09 deductibleBlock();
     this mirrors that sum so PCT sees the badges a premium upload produces before copying.
     Per tier the price shown is the first-year offer price where there is one, else the full
     premium; the badge compares it with the lowest deductible of the same geography.
     Philip, 2026-10-16: FWD 尊衛您 discounts each tier differently, so promo-vs-full mixes and
     promo above full now give visibly wrong badges. Only changed product/age/profile rows are
     checked, so old data never floods the review. */
  var BADGE_PREVIEW = { age: '30', combo: 'male-non-smoker' }; // the page's default profile
  function tierBadges(page, m, original, out) {
    var res = { changes: [], warnings: [] };
    var v = (m.vars || []).filter(function (x) { return x.kind === 'productRates'; })[0];
    if (!v) return res;
    var A, B;
    try { A = E.load(original, page.data).records; B = E.load(out, page.data).records; } catch (e) { return res; }
    var byId = {}; A.forEach(function (r) { byId[r.id] = r.data; });
    B.forEach(function (r) {
      var p = r.data, o = byId[r.id], tiers = get(p, v.tiersPath) || [];
      if (tiers.length < 2) return;
      var rates = get(p, v.path) || {}, disc = get(p, v.discPath);
      var ended = p.offer && p.offer.end && Date.now() > Date.parse(p.offer.end + 'T23:59:59+08:00');
      var row = function (d, path, age, k) { var t = get(d, path); return t && t[age] ? t[age][k] : null; };
      var changed = function (age, k) { return !o || JSON.stringify(row(p, v.path, age, k)) !== JSON.stringify(row(o, v.path, age, k)) || JSON.stringify(row(p, v.discPath, age, k)) !== JSON.stringify(row(o, v.discPath, age, k)); };
      var badges = function (d, age, k) {
        var full = row(d, v.path, age, k); if (!full) return null;
        var promo = ended ? null : row(d, v.discPath, age, k);
        var shown = function (i) { return promo && promo[i] != null ? promo[i] : full[i]; };
        var groups = {}; (get(d, v.tiersPath) || []).forEach(function (t, i) { if (full[i] == null) return; (groups[t.variant || ''] = groups[t.variant || ''] || []).push(i); });
        var outB = [];
        Object.keys(groups).forEach(function (g) {
          var idx = groups[g]; if (idx.length < 2) return;
          var base = idx.reduce(function (a, b) { return (tiers[a].amount || 0) <= (tiers[b].amount || 0) ? a : b; });
          idx.forEach(function (i) { if (i !== base) outB.push({ i: i, g: g, off: shown(base) ? Math.round((1 - shown(i) / shown(base)) * 100) : 0, promo: promo && promo[i] != null, basePromo: promo && promo[base] != null, high: promo && promo[i] != null && promo[i] > full[i] }); });
        });
        return outB;
      };
      var label = page.data.productLabel(p), tl = function (b) { return (b.g ? b.g + ' ' : '') + 'HK$' + (tiers[b.i].amount || 0).toLocaleString('en-US'); };
      var high = [], mixed = [], flat = [];
      Object.keys(rates).forEach(function (age) { Object.keys(rates[age] || {}).forEach(function (k) {
        if (!changed(age, k)) return;
        var bs = badges(p, age, k) || [], where = 'age ' + age + ' ' + k;
        if (bs.some(function (b) { return b.high; })) high.push(where);
        if (!ended && disc && bs.some(function (b) { return b.promo !== b.basePromo; })) mixed.push(where);
        bs.filter(function (b) { return b.off <= 0; }).forEach(function (b) { flat.push(where + ' ' + tl(b) + ' (' + b.off + '%)'); });
      }); });
      var some = function (a) { return a.slice(0, 3).join('; ') + (a.length > 3 ? ' and ' + (a.length - 3) + ' more' : ''); };
      if (high.length) res.warnings.push(label + ': a first-year offer price is higher than the full premium in ' + high.length + ' row(s): ' + some(high) + '.');
      if (mixed.length) res.warnings.push(label + ': some deductible tiers have an offer price and others do not in ' + mixed.length + ' row(s): ' + some(mixed) + '. The 保費 −XX% badge would compare an offer price with a full price.');
      if (flat.length) res.warnings.push(label + ': a higher deductible is not cheaper than the lowest one, so its badge would read 保費 −0% or less: ' + some(flat) + '.');
      var a = BADGE_PREVIEW.age, k = BADGE_PREVIEW.combo;
      if (changed(a, k)) {
        var show = function (bs) { return bs ? bs.map(function (b) { return tl(b) + ' −' + b.off + '%'; }).join(' · ') : '(none)'; };
        res.changes.push({ product: label, field: '保費 −XX% badges (age ' + a + ', ' + k + ')', before: o ? show(badges(o, a, k)) : '(new plan)', after: show(badges(p, a, k)) });
      }
    });
    return res;
  }
  function productPatternErrors(page, s) {
    var cfg = function () { return page.data; };
    var prodLabel = function (s, id) { return page.data.productLabel(s.doc.records.filter(function (r) { return r.id === id; })[0].data); };
    var out = [];
    Object.keys(s.fields).forEach(function (id) {
      cfg().fields.forEach(function (f) {
        var v = (s.fields[id] || {})[f.path];
        // a tag left empty would show as a blank chip on the card
        if ((f.type === 'tags' || f.type === 'strtags') && Array.isArray(v) && v.some(function (t) { return typeof t === 'string' ? !t.trim() : !t || !String(t.zh || '').trim(); })) out.push(prodLabel(s, id) + ': a tag is empty — type it or remove it.');
        if ((f.type === 'number' || f.type === 'number-null') && v !== undefined && v !== null && (typeof v !== 'number' || !isFinite(v) || v < 0)) out.push(prodLabel(s, id) + ': ' + f.label + ' — enter a number' + (f.type === 'number-null' ? ' or leave it empty' : '') + '.');
        if (f.pattern && typeof v === 'string' && !new RegExp(f.pattern).test(v)) out.push(prodLabel(s, id) + ': ' + f.label + ' — ' + f.patternMsg);
      });
    });
    return out;
  }
  var api = { output: output, review: review };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
