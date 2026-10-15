/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — paste a whole sheet from the "RP Product Details" Excel
   PCT selects the sheet in Excel (click the corner, Cmd+C) and pastes it.
   The headers say what every number is, so nothing has to line up by hand:

     long   Life "Premium <provider>": Product | Age | Sum insured | Gender | Smoking | Original | Discounted
     ci     CI "Premium": provider row / ORIGINAL-DISCOUNTED row / Age | Gender | Smoking | Policy Length | <plan> …
     vhis   VHIS "Premium" and "Discounted Premium": provider row / plan row / Age | Gender | Smoking | <deductible> …
     osi    OSI "Sheet1": one row per plan — 保險計劃 | Badge | Link | … | 保費 | Discounted Price

   Rounding and empty-cell rules copy the scripts that built the live data from these
   same sheets (mh_ci_page / mh_vhis docs/source/extract-excel.py), so importing the
   Excel a page was built from changes nothing.

   Output: { format, matches:[{excel, id, label, how}], unmatched:[names], edits:[…], notes:[…] }
     edit = { kind: 'var', v, path, value }   (Life / CI premium tables)
          | { kind: 'field', id, path, value } (VHIS / OSI product fields)
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* ===== Excel clipboard → rows. Excel quotes cells containing tabs, newlines or quotes. ===== */
  function parseTSV(text) {
    var rows = [], row = [], cell = '', i = 0, q = false, t = String(text || '').replace(/\r\n?/g, '\n');
    while (i < t.length) {
      var c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { q = true; i++; continue; }
      if (c === '\t') { row.push(cell.trim()); cell = ''; i++; continue; }
      if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x !== ''; }); });
  }

  /* ===== matching ===== */
  function norm(s) {
    return String(s || '').normalize('NFKC').toLowerCase()
      .replace(/[\s()（）\[\]「」『』《》,，、.。·・:：;；'"’‘“”\-–—_\/]+/g, '');
  }
  function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var b = s.substr(i, 2); o[b] = (o[b] || 0) + 1; } return o; }
  function dice(a, b) {
    a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1;
    var A = bigrams(a), B = bigrams(b), n = 0, ta = 0, tb = 0, k;
    for (k in A) ta += A[k]; for (k in B) tb += B[k];
    for (k in A) if (B[k]) n += Math.min(A[k], B[k]);
    return (2 * n) / (ta + tb || 1);
  }
  // products: [{ id, names: [page names…], aliases: [Excel names…], provider: [insurer, providerId] }]
  // Exact names win outright. Partial and close matches only count inside the same provider
  // (the sheet's provider row), so another insurer's similar plan can never take a product's prices.
  function sameProvider(p, prov) {
    var q = norm(prov); if (!q) return true;
    return (p.provider || []).some(function (x) { var m = norm(x); return m && (m.indexOf(q) >= 0 || q.indexOf(m) >= 0 || dice(m, q) >= 0.5); });
  }
  function matchName(name, products, provider) {
    var n = norm(name); if (!n) return null;
    var hit = products.filter(function (p) { return (p.aliases || []).some(function (a) { return norm(a) === n; }); });
    if (hit.length === 1) return { id: hit[0].id, how: 'known name', rank: 3 };
    hit = products.filter(function (p) { return p.names.some(function (a) { return norm(a) === n; }); });
    if (hit.length === 1) return { id: hit[0].id, how: 'same name', rank: 3 };
    if (provider) products = products.filter(function (p) { return sameProvider(p, provider); });
    hit = products.filter(function (p) { return p.names.some(function (a) { var m = norm(a); return m && (m.indexOf(n) >= 0 || n.indexOf(m) >= 0); }); });
    if (hit.length === 1) return { id: hit[0].id, how: 'name contains', rank: 2 };
    if (hit.length > 1) { // several contain it: take the one whose name is closest in length
      hit.sort(function (a, b) { return Math.abs(norm(a.names[0]).length - n.length) - Math.abs(norm(b.names[0]).length - n.length); });
      if (Math.abs(norm(hit[0].names[0]).length - n.length) < Math.abs(norm(hit[1].names[0]).length - n.length)) return { id: hit[0].id, how: 'name contains', rank: 2 };
    }
    var scored = products.map(function (p) { return { id: p.id, s: Math.max.apply(null, p.names.concat(p.aliases || []).map(function (a) { return dice(name, a); })) }; })
      .sort(function (a, b) { return b.s - a.s; });
    if (scored[0] && scored[0].s >= 0.6 && (!scored[1] || scored[0].s - scored[1].s >= 0.08)) return { id: scored[0].id, how: 'close match (' + Math.round(scored[0].s * 100) + '%)', rank: 1, score: scored[0].s };
    return null;
  }

  /* ===== cells ===== */
  function num(s) {
    var t = String(s == null ? '' : s).replace(/HK\$|\$|,|\s/gi, '');
    if (t === '') return null;
    var v = Number(t); return isFinite(v) ? v : NaN;
  }
  // Python's round() (round half to even) — the build scripts used it, so .5 must round the same way
  function roundEven(v, dp) {
    // Decide from the number's exact decimal expansion (toFixed with spare digits is exact), never from v*100,
    // which can manufacture a fake .5. A true half rounds to the even digit, as Python does.
    dp = dp || 0; var neg = v < 0, s = Math.abs(v).toFixed(dp + 30), dot = s.indexOf('.');
    var keep = s.slice(0, dot + (dp ? dp + 1 : 0)), rest = s.slice(dot + 1 + dp), up;
    if (rest[0] > '5') up = true; else if (rest[0] < '5') up = false;
    else up = /[1-9]/.test(rest.slice(1)) ? true : Number(keep.slice(-1)) % 2 === 1;
    var r = Number(keep) + (up ? Math.pow(10, -dp) : 0);
    r = Number(r.toFixed(dp)); return neg ? -r : r;
  }


  var r2 = function (v) { return roundEven(v, 2); };
  function headerRow(rows, need) {
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var low = rows[i].map(function (c) { return c.toLowerCase(); });
      if (need.every(function (h) { return low.some(function (c) { return c === h || c.indexOf(h) === 0; }); })) return i;
    }
    return -1;
  }
  function col(row, h) { var low = row.map(function (c) { return c.toLowerCase(); }); for (var i = 0; i < low.length; i++) if (low[i] === h || low[i].indexOf(h) === 0) return i; return -1; }
  function gs(g, s) { g = String(g).trim().toUpperCase(); if (g === 'W') g = 'F'; s = String(s).trim().toUpperCase(); if (!/^[MF]$/.test(g) || !/^[YN]$/.test(s)) return null; return (g === 'M' ? 'male' : 'female') + '-' + (s === 'Y' ? 'smoker' : 'non-smoker'); }
  function intAge(a) { var v = num(a); return v != null && isFinite(v) && v >= 0 && v <= 120 && Math.round(v) === v ? String(v) : null; }

  /* ===== detect ===== */
  function detect(rows) {
    if (headerRow(rows, ['product', 'age', 'gender', 'smoking']) >= 0) return 'long';
    if (headerRow(rows, ['age', 'gender', 'smoking', 'policy length']) >= 0) return 'ci';
    var h = headerRow(rows, ['age', 'gender', 'smoking']);
    if (h >= 0 && rows[h].some(function (c) { return /墊底費|deductible/i.test(c); })) return 'vhis';
    if (headerRow(rows, ['保險計劃', '保費']) >= 0) return 'osi';
    return null;
  }

  function result(format) { return { format: format, matches: [], unmatched: [], edits: [], notes: [] }; }
  // groups: [{ name, m }] — if two Excel plans point at one product, keep the stronger match only
  function oneEach(groups, res) {
    var best = {};
    groups.forEach(function (g) { if (!g.m) return; var b = best[g.m.id]; if (!b || g.m.rank > b.m.rank || (g.m.rank === b.m.rank && (g.m.score || 1) > (b.m.score || 1))) best[g.m.id] = g; });
    groups.forEach(function (g) { if (g.m && best[g.m.id] !== g) { res.notes.push('"' + g.name + '" also looked like ' + g.m.id + ', which already matches "' + best[g.m.id].name + '" — skipped.'); g.m = null; } });
  }
  function byName(names, products, res) {
    var groups = [], seen = {};
    names.forEach(function (n) { if (n && !seen[n]) { seen[n] = 1; groups.push({ name: n, m: matchName(n, products) }); } });
    oneEach(groups, res); var out = {}; groups.forEach(function (g) { out[g.name] = g.m; }); return out;
  }
  // the provider for column c: nearest non-empty provider cell at or left of c
  function providerAt(row, c) { for (var i = c; i >= 0; i--) if (row && row[i]) return row[i]; return ''; }
  function noteMatch(res, seen, excel, m, products) {
    if (seen[excel]) return; seen[excel] = 1;
    if (m) { var p = products.filter(function (x) { return x.id === m.id; })[0]; res.matches.push({ excel: excel, id: m.id, label: p ? p.names[0] : m.id, how: m.how }); }
    else res.unmatched.push(excel);
  }

  /* Life: one row per product × age × gender × smoker */
  function importLong(rows, products, opts) {
    var res = result('long'), h = headerRow(rows, ['product', 'age', 'gender', 'smoking']), H = rows[h], seen = {};
    var cP = col(H, 'product'), cA = col(H, 'age'), cS = col(H, 'sum insured'), cG = col(H, 'gender'), cK = col(H, 'smoking');
    var cO = H.findIndex(function (c) { return /original/i.test(c); }), cD = H.findIndex(function (c) { return /discount/i.test(c); });
    var skipSum = 0, mm = byName(rows.slice(h + 1).map(function (r) { return r[cP]; }), products, res);
    rows.slice(h + 1).forEach(function (r) {
      var name = r[cP]; if (!name) return;
      var m = mm[name]; noteMatch(res, seen, name, m, products); if (!m) return;
      if (opts.sumInsured && cS >= 0 && norm(r[cS]) !== norm(opts.sumInsured)) { skipSum++; return; }
      var age = intAge(r[cA]), key = gs(r[cG], r[cK]); if (!age || !key) return;
      var o = num(r[cO]), d = cD >= 0 ? num(r[cD]) : null;
      if (o === null) return; // blank row in the sheet: leave the page as it is
      if (isNaN(o) || (d !== null && isNaN(d))) { res.notes.push(name + ' age ' + age + ' ' + key + ': not a number, skipped.'); return; }
      res.edits.push({ kind: 'var', v: opts.v, path: m.id + '.' + age + '.' + key, value: [r2(o), d === null ? r2(o) : r2(d)] });
    });
    if (skipSum) res.notes.push(skipSum + ' rows for a sum insured other than ' + opts.sumInsured + ' were skipped (the page shows ' + opts.sumInsured + ').');
    return res;
  }

  /* CI: products across in ORIGINAL / DISCOUNTED pairs */
  function importCI(rows, products, opts) {
    var res = result('ci'), h = headerRow(rows, ['age', 'gender', 'smoking', 'policy length']), H = rows[h], seen = {};
    var lab = rows[h - 1] || [], groups = [];
    for (var c = 4; c < H.length; c++) {
      if (!H[c]) continue;
      var disc = /discount/i.test(lab[c + 1] || '') ? c + 1 : null;
      groups.push({ name: H[c], o: c, d: disc, provider: (rows[h - 2] || [])[c] || '' });
      if (disc) c++;
    }
    groups.forEach(function (g) { g.m = matchName(g.name, products, providerAt(rows[h - 2], g.o)); });
    oneEach(groups, res);
    groups.forEach(function (g) { noteMatch(res, seen, g.name, g.m, products); });
    var hidden = 0;
    rows.slice(h + 1).forEach(function (r) {
      var age = intAge(r[0]), key = gs(r[1], r[2]); if (!age || !key) return;
      var term = /^1\s/.test(String(r[3]).trim()) || String(r[3]).trim() === '1' ? '1y' : '10y';
      groups.forEach(function (g) {
        if (!g.m) return;
        var ov = (r[g.o] || '').trim(), path = g.m.id + '.' + age + '.' + key + '-' + term;
        if (!ov || /^do not show product/i.test(ov)) { hidden++; res.edits.push({ kind: 'var', v: opts.v, path: path, value: undefined, hide: true }); return; }
        var o = num(ov);
        if (isNaN(o)) { res.edits.push({ kind: 'var', v: opts.v, path: path, value: { n: ov } }); return; }
        var d = g.d != null ? num(r[g.d]) : null;
        res.edits.push({ kind: 'var', v: opts.v, path: path, value: [r2(o), d !== null && !isNaN(d) && r2(d) !== r2(o) ? r2(d) : null] });
      });
    });
    return res;
  }

  /* VHIS: plans across, one column per deductible level */
  function importVHIS(rows, products, opts) {
    var res = result('vhis'), h = headerRow(rows, ['age', 'gender', 'smoking']), H = rows[h], N = rows[h - 1] || [], seen = {};
    var groups = [], cur = null;
    for (var c = 3; c < H.length; c++) {
      if (!H[c]) continue;
      if (N[c]) { cur = { name: N[c], cols: [] }; groups.push(cur); }
      if (cur) cur.cols.push(c);
    }
    groups.forEach(function (g) { g.m = matchName(g.name, products, providerAt(rows[h - 2], g.cols[0])); });
    oneEach(groups, res);
    groups.forEach(function (g) {
      noteMatch(res, seen, g.name, g.m, products);
      if (g.m) { var p = products.filter(function (x) { return x.id === g.m.id; })[0]; if (p.tiers != null && p.tiers !== g.cols.length) { res.notes.push(g.name + ': the sheet has ' + g.cols.length + ' deductible columns but the page has ' + p.tiers + ' — skipped. Deductible levels change in "Edit code directly".'); g.m = null; } }
    });
    rows.slice(h + 1).forEach(function (r) {
      var age = intAge(r[0]), key = gs(r[1], r[2]); if (!age || !key) return;
      groups.forEach(function (g) {
        if (!g.m) return;
        var vals = g.cols.map(function (cc) { var v = num(r[cc]); return v === null || isNaN(v) ? null : roundEven(v, 0); });
        if (opts.which === 'discount') {
          var prem = opts.premiumOf(g.m.id, age, key) || [];
          vals = vals.map(function (d, i) { return d !== null && prem[i] != null && d < prem[i] ? d : null; });
          res.edits.push({ kind: 'field', id: g.m.id, path: 'discount.prices.' + age + '.' + key, value: vals });
        } else res.edits.push({ kind: 'field', id: g.m.id, path: 'premiums.' + age + '.' + key, value: vals });
      });
    });
    return res;
  }

  /* OSI: one row per plan */
  var OSI_COLS = [
    { h: 'badge', p: 'badge', t: 'text' }, { h: 'link', p: 'url', t: 'url' }, { h: '產品單張', p: 'leaflet', t: 'url' }, { h: '保單條款', p: 'policy', t: 'url' },
    { h: '受保年齡', p: 'age', t: 'string' }, { h: '醫療費用保障', p: 'med', t: 'num' }, { h: '人身意外保障', p: 'acc', t: 'num' },
    { h: '學費損失保障', p: 'tui', t: 'num' }, { h: '教育基金', p: 'edu', t: 'num' }, { h: '保費', p: 'price', t: 'num' }, { h: 'discounted price', p: 'disc', t: 'numnull' }
  ];
  function importOSI(rows, products, opts) {
    var res = result('osi'), h = headerRow(rows, ['保險計劃', '保費']), H = rows[h].map(function (c) { return c.toLowerCase(); }), seen = {};
    var cN = col(rows[h], '保險計劃');
    var cols = OSI_COLS.map(function (x) { return { x: x, i: H.indexOf(x.h.toLowerCase()) }; }).filter(function (c) { return c.i >= 0; });
    var mm = byName(rows.slice(h + 1).map(function (r) { return r[cN]; }), products, res), done = {};
    rows.slice(h + 1).forEach(function (r) {
      var name = r[cN]; if (!name) return;
      if (done[name]) { res.notes.push('"' + name + '" appears on more than one row — only the first row was used. Check the sheet.'); return; }
      done[name] = 1;
      var m = mm[name]; noteMatch(res, seen, name, m, products); if (!m) return;
      cols.forEach(function (c) {
        var raw = (r[c.i] || '').trim(), v;
        if (c.x.t === 'num') { v = num(raw); if (v === null || isNaN(v)) return; }
        else if (c.x.t === 'numnull') { v = /^(na|n\/a|-)?$/i.test(raw) ? null : num(raw); if (v !== null && isNaN(v)) return; }
        else if (c.x.t === 'url') { if (!/^https:\/\//.test(raw)) { if (raw) res.notes.push(name + ': ' + c.x.h + ' "' + raw.slice(0, 40) + '" is not an https link — skipped.'); return; } v = raw; }
        else if (c.x.t === 'text') v = raw && !/^(na|n\/a|-)$/i.test(raw) ? raw : null;
        else { if (!raw) return; v = raw; }
        res.edits.push({ kind: 'field', id: m.id, path: c.x.p, value: v });
      });
    });
    return res;
  }

  function importSheet(text, products, opts) {
    var rows = parseTSV(text), f = detect(rows);
    if (!f) {
      var cells = [].concat.apply([], rows), numeric = cells.filter(function (c) { return c !== '' && !isNaN(num(c)); }).length;
      if (cells.length && numeric / cells.length > 0.8) return { error: opts.numbersIntoTable
        ? 'This looks like just the numbers, without the headers. That works too: click the cell in the table below where the first number should go, and paste there (Cmd+V). Or select the whole sheet in Excel and paste it here.'
        : 'This looks like just the numbers. The tool needs the whole sheet, because the Product, Age, Gender and Smoking columns tell it where each number goes. Click the corner above row 1 in Excel, copy, and paste again.' };
      return { error: 'This does not look like one of the RP Product Details sheets. Select the whole sheet in Excel (click the corner above row 1), copy, and paste again. Or paste just the numbers straight into the table below.' };
    }
    if (opts.expect && opts.expect.indexOf(f) < 0) return { error: 'This looks like a different sheet (' + ({ long: 'a Life premium sheet', ci: 'the CI Premium sheet', vhis: 'a VHIS premium sheet', osi: 'the OSI sheet' })[f] + '). Paste the premium sheet for this page.' };
    return ({ long: importLong, ci: importCI, vhis: importVHIS, osi: importOSI })[f](rows, products, opts);
  }

  var api = { roundEven: roundEven, num: num, parseTSV: parseTSV, detect: detect, matchName: matchName, importSheet: importSheet, norm: norm, dice: dice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);
