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
    var safe = M.safety(s.original, out, { allowHookRemoval: s.allowHookRemoval, expectStructure: s.structural && s.mode !== 'code' });
    res.errors = res.errors.concat(safe.errors); res.warnings = res.warnings.concat(safe.warnings);
    if (m.editor === 'products') {
      var tablesEdited = Object.keys(s.vedits || {}).length > 0; // premium table / FAQ live outside the product list
      var c = E.check(s.original, out, Object.assign({}, cfg(), { allowOutside: s.mode === 'code' || s.fromCode || tablesEdited }));
      res.errors = res.errors.concat(c.errors.filter(function (x) { return res.errors.indexOf(x) < 0; }));
      res.warnings = res.warnings.concat(c.warnings);
      if (s.mode !== 'code') res.errors = res.errors.concat(productPatternErrors(page, s));
      try { changes = E.changeList(s.original, out, cfg()); } catch (e) {}
      if (m.vars) { changes = changes.concat(varChanges(s.original, out, m)); if (s.mode !== 'code') rateWarnings(s.original, out, m).forEach(function (w) { res.warnings.push(w); }); }
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
