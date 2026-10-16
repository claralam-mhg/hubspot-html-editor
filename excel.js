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
  function parseTSV(text, keepEmpty) {
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
    // keepEmpty: the VHIS Product Details reader counts rows by position, like the build script
    return keepEmpty ? rows : rows.filter(function (r) { return r.some(function (x) { return x !== ''; }); });
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

  /* ===== VHIS: build a new plan from the Product Details sheet (+ Premium / Discounted Premium) =====
     A line-by-line port of mh_vhis/docs/source/extract-excel.py, so a plan added here is the same
     record the build script would have produced. */
  var PICTO = '\u{1F000}-\u{1FAFF}☀-✒✔✖-➿⬀-⯿';
  var EMOJI = new RegExp('[' + PICTO + ']️?(?:‍[' + PICTO + ']️?)*', 'gu');
  var FAMILY = /[\u{1F468}\u{1F469}\u{1F466}\u{1F467}][\u{1F3FB}-\u{1F3FF}]?(?:‍[\u{1F468}\u{1F469}\u{1F466}\u{1F467}][\u{1F3FB}-\u{1F3FF}]?)+/gu;
  function clean(v) { if (v == null) return null; var t = String(v).replace(EMOJI, '').trim(); return t || null; }
  function keepEmoji(v) { if (v == null) return null; var t = String(v).trim(); return t || null; }
  function endDate(v) {
    if (!v) return null; var t = String(v), m = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(t);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/.exec(t); // 31/10/2026 — Hong Kong Excel shows day first
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    m = /(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})/.exec(t); // 31 Mar 2027
    var mon = m && ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    return m && mon >= 0 ? m[3] + '-' + ('0' + (mon + 1)).slice(-2) + '-' + ('0' + m[1]).slice(-2) : null;
  }
  var TIER_RE = /^(.*?)\s*HK\$([\d,]+)\s*墊底費$/;
  function parseTier(label) { var m = TIER_RE.exec(label || ''); return m ? { variant: m[1] || null, amount: parseInt(m[2].replace(/,/g, ''), 10) } : { variant: null, amount: null }; }

  // Layout of Phillip's Product Details sheet (12/10 file, columns A–B, rows 1 to Referral Link), so one plan's
  // column pasted on its own can be lined up with its row labels. Banner rows = the section headings.
  var VHIS_TEMPLATE = {"rows": [["", ""], ["", ""], ["Product Card Status", ""], ["自願醫保 (VHIS)", "COMPARE FUNCTION to compare"], ["", ""], ["(not mandatory, both selected by default) Product Filter - 🏛️政府標準計劃", ""], ["(not mandatory, both selected by default) Product Filter - 💡靈活計劃", ""], ["TAG 1", ""], ["TAG 2", ""], ["TAG 3", ""], ["TAG 4", ""], ["Is there discount?", ""], ["優惠碼", ""], ["Description", ""], ["End Date", ""], ["關於計劃", ""], ["保單類型", "Y"], ["🪙保費可扣減薪俸稅", ""], ["投保年齡", ""], ["續保年期", ""], ["可續保年齡", ""], ["繳費模式", ""], ["免驗身", ""], ["墊底費", "N"], ["指定房間類別", "Y"], ["保障地域範圍", "Y"], ["每保單年度保障限額", "Y"], ["終身保障限額", "Y"], ["保障範圍 - 基本保障       ℹ️賠償實報實銷，除另有標明，金額、日數或次數為每保單年度上限。個別服務或治療另須符合特定要求，詳細請參閱保險公司產品單張。", ""], ["病房及膳食", "Y"], ["雜項開支", "Y"], ["主診醫生巡房費", "Y"], ["專科醫生費", "Y"], ["深切治療", "Y"], ["外科醫生費", "Y"], ["麻醉科醫生費", "Y"], ["手術室費", "Y"], ["訂明診斷成像檢測\nℹ️檢測只包括電腦斷層掃描(\"CT\"掃描)、磁力共振掃描(\"MRI\"掃描)、正電子放射斷層掃描(\"PET\"掃描)、PET-CT組合及PET-MRI組合。", "Y"], ["訂明非手術癌症治療\nℹ️治療只包括放射性治療、化療、標靶治療、免疫治療及荷爾蒙治療。", "Y"], ["入院前或出院後 / 日間手術前後的門診護理\n\nℹ️有關次數及其他限制請參閱保險公司產品單張。", "Y"], ["精神科治療\nℹ️除保險公司另有標明，只適用於香港，詳細請參閱保險公司產品單張。", "Y"], ["保障範圍 - 額外保障       ℹ️賠償實報實銷，除另有標明，金額、日數或次數為每保單年度上限 。個別服務或治療事前必須先獲保險公司批准，詳細請參閱保險公司產品單張。", ""], ["住院陪床費", ""], ["出院後或日間手術後每日家中看護費", ""], ["意外急症門診治療", ""], ["門診腎臟透析", "Y"], ["康復治療 ", "Y"], ["善終及紓緩治療", "Y"], ["懷孕併發症 ℹ️除保險公司另有標明，一般等候期為12個月", "Y"], ["住院或治療後註冊中醫師提供之診症或針灸 ", ""], ["人工裝置", ""], ["因中風而提升家居設備", ""], ["額外醫療保障", ""], ["保障範圍 - 其他保障", ""], ["日間手術現金保障", ""], ["第二索償津貼\nℹ️若受保人曾經住院或接受日間手術，並且從其他保險公司就合資格費用獲得部分或全數賠償，受保人便可獲得額外現金津貼。", ""], ["完全及永久失去自理能力入息保障", ""], ["身故保障", "Y"], ["醫療疏忽保障", "Y"], ["意外身故保障", ""], ["", ""], ["MORE INFO 1", ""], ["MORE INFO 2", ""], ["MORE INFO 3", ""], ["MORE INFO 4", ""], ["MORE INFO 5", ""], ["MORE INFO 6", ""], ["", ""], ["產品小冊子", ""], ["保單條款及細則", ""], ["保障表 (包括手術表)", ""], ["保障表 (包括手術表) - HK$0墊底費", ""], ["保障表 (包括手術表) - HK$20,000墊底費", ""], ["保障表 (包括手術表) - HK$50,000墊底費", ""], ["保障表 (包括手術表) - HK$80,000墊底費", ""], ["保單條款及細則 (全球 HK$0墊底費)", ""], ["保單條款及細則 (全球 HK$20,000墊底費)", ""], ["保單條款及細則 (全球 HK$40,000墊底費)", ""], ["保單條款及細則 (全球 HK$80,000墊底費)", ""], ["保單條款及細則 (亞洲及澳紐 HK$0墊底費)", ""], ["保單條款及細則 (亞洲及澳紐 HK$20,000墊底費)", ""], ["保單條款及細則 (亞洲及澳紐 HK$40,000墊底費)", ""], ["保單條款及細則 (亞洲及澳紐 HK$80,000墊底費)", ""], ["產品風險及主要不保事項", ""], ["優惠受條款及細則", ""], ["", ""], ["Referral Link", ""]], "banners": [16, 29, 42, 54], "notesRow": null};
  function vhisSingleColumn(text) {
    var vals = parseTSV(text, true).map(function (r) { return r.length > 1 ? r[r.length - 1] : (r[0] || ''); });
    while (vals.length && vals[vals.length - 1] === '') vals.pop();
    var T = VHIS_TEMPLATE.rows, rowOf = function (l) { for (var i = 0; i < T.length; i++) if (clean(T[i][0]) === clean(l)) return i; return -1; };
    var iType = rowOf('保單類型'), iDed = rowOf('墊底費'), iLink = rowOf('Referral Link'), iPlan = rowOf('自願醫保 (VHIS)') + 1;
    // The copy must start at "Product Card Status" (Enabled / Disabled …). The start is fixed by that, never
    // searched for: sliding the column to find a fit could hide a dropped row and shift every value below it.
    var iStatus = rowOf('Product Card Status');
    if (!/^(enabled|disabled)/i.test(clean(vals[0]) || '')) return null;
    for (var start = iStatus; start <= iStatus; start++) {
      var v = function (i) { return clean(vals[i - start]) || ''; };
      // exact length when the column ends at a filled-in Referral Link; a dropped row would shift everything below it
      // The column must end on the Referral Link with exactly the right number of rows: that pins the bottom as
      // firmly as "Product Card Status" pins the top. (A plan without a link cannot be added anyway.)
      if (vals.length !== T.length - start || !/^https?:\/\//.test(v(iLink))) continue;
      if (!v(iPlan) || !/^自願醫保/.test(v(iType)) || !/HK\$/.test(v(iDed))) continue;
      // every link in the column must sit on a document row (after the MORE INFO rows) or the Referral Link row
      var iInfo = rowOf('MORE INFO 6'), linksOk = true;
      for (var k = 0; k < vals.length; k++) if (/^https?:\/\//.test(clean(vals[k]) || '') && k + start <= iInfo) linksOk = false;
      if (!linksOk) continue;
      var rows = T.map(function (t, i) { return [t[0], t[1], i >= start ? (vals[i - start] || '') : '']; });
      return { rows: rows, start: start };
    }
    return null;
  }
  function vhisDetails(text) {
    var rows = parseTSV(text, true), single = null;
    // a whole sheet has the row labels in column A (保單類型 as a label, with values beside it)
    var looksLikeSheet = rows.some(function (r) { return clean(r[0]) === '保單類型' && r.length > 2; });
    if (!looksLikeSheet) { single = vhisSingleColumn(text); if (single) rows = single.rows; }
    var cell = function (r, c) { return r >= 0 && rows[r] ? rows[r][c] || '' : ''; };
    var rowOf = function (label) { var want = clean(label); for (var r = 0; r < Math.min(rows.length, 120); r++) if (clean(cell(r, 0)) === want) return r; return -1; };
    var rName = rowOf('自願醫保 (VHIS)'); if (rName < 0) rName = rowOf('自願醫保');
    if (rName < 0 || rowOf('保單類型') < 0) return { error: 'The tool could not line this up with the Product Details sheet. Either copy the whole sheet (click the corner above row 1), or copy one plan\'s column starting exactly at "Product Card Status" (the Enabled / Disabled cell) down to the "Referral Link" cell, which must have the apply link. If Phillip has added or moved rows, or the link is still empty, copy the whole sheet.' };
    var R = {
      name: rName, plan: rName + 1, status: rowOf('Product Card Status'), disc: rowOf('Is there discount?'), code: rowOf('優惠碼'), descr: rowOf('Description'),
      end: rowOf('End Date'), link: rowOf('Referral Link'), notes: rowOf("PHIILIP'S NOTES"), ded: rowOf('墊底費'), first: rowOf('保單類型'),
      std: rowOf('(not mandatory, both selected by default) Product Filter - 🏛️政府標準計劃'),
      tags: [1, 2, 3, 4].map(function (i) { return rowOf('TAG ' + i); }), info: [1, 2, 3, 4, 5, 6].map(function (i) { return rowOf('MORE INFO ' + i); })
    };
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var plans = [];
    for (var c = 2; c < width; c++) { var n = clean(cell(R.plan, c)); if (n) plans.push({ col: c, letter: colLetter(c), insurer: clean(cell(R.name, c)), name: n, status: clean(cell(R.status, c)) || 'Enabled' }); }
    if (single) plans.forEach(function (p) { p.letter = 'your column'; }); // not the sheet's letter — only the column itself was pasted
    return { rows: rows, R: R, plans: plans, cell: cell, banners: single ? VHIS_TEMPLATE.banners : null, single: !!single };
  }
  function colLetter(c) { var s = ''; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

  // Premium-sheet columns for one plan: [{label, variant, amount, col}] — name carried forward across its columns
  function vhisPremiumCols(rows, plan) {
    var h = headerRow(rows, ['age', 'gender', 'smoking']); if (h < 0) return null;
    var N = rows[h - 1] || [], H = rows[h], out = {}, cur = null;
    for (var c = 3; c < H.length; c++) {
      var nm = clean(N[c]); if (nm) cur = nm; if (!cur) continue;
      if (rows.slice(h + 1).every(function (r) { return !r[c]; })) continue;
      var raw = clean(H[c]), t = parseTier(raw);
      (out[cur] = out[cur] || []).push({ label: raw, variant: t.variant, amount: t.amount, col: c });
    }
    var key = out[plan] ? plan : Object.keys(out).filter(function (k) { return plan.slice(-k.length) === k || k.slice(-plan.length) === plan; })[0];
    return { h: h, tiers: key ? out[key] : [] };
  }
  function gsKey(g, s) { return gs(g, s); }

  // Build script's split_by_area (Philip's Modification #6, Clara 2026-10-09): a plan priced for two
  // coverage areas becomes one plan per area, named with the coverage row's own wording for that area.
  function areaName(variant, covText) {
    var parts = String(covText || '').split(/\s*(?:或|；|;)\s*/).map(function (x) { return x.trim(); }).filter(Boolean), best = variant, top = 0;
    parts.forEach(function (part) { var n = 0; for (var i = 0; i < variant.length; i++) if (part.indexOf(variant[i]) >= 0) n++; if (n > top) { best = part; top = n; } });
    return best;
  }
  function splitByArea(p) {
    var areas = []; p.deductibleTiers.forEach(function (t) { if (t.variant && areas.indexOf(t.variant) < 0) areas.push(t.variant); });
    if (areas.length < 2) return [p];
    var cov = (p.coverage.filter(function (c) { return c.label === '保障地域範圍'; })[0] || {}).val || '';
    return areas.map(function (area, k) {
      var idx = []; p.deductibleTiers.forEach(function (t, i) { if (t.variant === area) idx.push(i); });
      var name = areaName(area, cov), pick = function (tab) { var o = {}; Object.keys(tab).forEach(function (a) { o[a] = {}; Object.keys(tab[a]).forEach(function (g) { o[a][g] = idx.map(function (i) { return tab[a][g][i]; }); }); }); return o; };
      var q = {}; Object.keys(p).forEach(function (key) { q[key] = p[key]; });
      q.id = p.id + '-' + (/全球|環球/.test(name) ? 'global' : /亞洲/.test(name) ? 'asia' : k);
      q.name = p.name + ' - ' + name;
      q.deductibleTiers = idx.map(function (i) { var t = {}; Object.keys(p.deductibleTiers[i]).forEach(function (kk) { t[kk] = p.deductibleTiers[i][kk]; }); t.variant = null; return t; });
      q.premiums = pick(p.premiums);
      if (p.discount) q.discount = { label: p.discount.label, prices: pick(p.discount.prices) };
      q.coverage = p.coverage.map(function (c) { if (c.label !== '保障地域範圍') return c; var o = {}; Object.keys(c).forEach(function (kk) { o[kk] = c[kk]; }); o.val = name; return o; });
      return q;
    });
  }
  // Build one plan's record. opts: { col, id, providerId, premium: text, discount: text }
  function vhisBuildPlan(det, opts) {
    var R = det.R, c = opts.col, cell = det.cell, problems = [], warnings = [];
    var plan = clean(cell(R.plan, c)), status = clean(cell(R.status, c)) || 'Enabled';
    if (status !== 'Enabled') warnings.push('The sheet says "' + status + '" for this plan.');
    var tags = R.tags.filter(function (r) { return r >= 0; }).map(function (r) { return keepEmoji(cell(r, c)); }).filter(Boolean).map(function (t) { return t.replace(FAMILY, '🏠'); });
    var infoRows = R.info.filter(function (r) { return r >= 0; }), lastCov = Math.min.apply(null, infoRows) - 2;
    var width = Math.max.apply(null, det.rows.map(function (r) { return r.length; }));
    var section = null, coverage = [];
    for (var r = R.first; r <= lastCov; r++) {
      var lab = clean(cell(r, 0)); if (!lab) continue;
      var any = false; for (var k = 2; k < width; k++) if (clean(cell(r, k))) { any = true; break; }
      if (det.banners ? det.banners.indexOf(r + 1) >= 0 : !any) { section = lab.split('ℹ️')[0].trim(); continue; }
      var val = clean(cell(r, c)); if (!val) continue;
      var parts = lab.split('ℹ️'), note = parts.slice(1).join('ℹ️').split(/\s+/).filter(Boolean).join(' ');
      coverage.push({ label: parts[0].trim(), note: note || null, val: val.replace(/\n/g, '<br>'), section: section, cmp: clean(cell(r, 1)) === 'Y' });
    }
    var moreInfo = infoRows.map(function (r) { return clean(cell(r, c)); }).filter(Boolean);
    var notes = [], tax = false;
    if (R.notes >= 0) for (var n = R.notes; n < R.notes + 8; n++) { var nv = clean(cell(n, c)); if (!nv) continue; if (/cannot claim tax/i.test(nv)) tax = true; else notes.push(nv); }
    var docs = [], lastInfo = Math.max.apply(null, infoRows);
    for (var d = lastInfo + 1; d < (R.notes >= 0 ? R.notes : 100); d++) { var dl = clean(cell(d, 0)); if (!dl || dl === 'Referral Link') continue; var du = clean(cell(d, c)); if (du && /^http/.test(du)) docs.push({ label: dl, url: du }); }

    // premiums
    var prem = opts.premium ? parseTSV(opts.premium) : null, disc = opts.discount ? parseTSV(opts.discount) : null;
    var tiers = [], premiums = {}, dprices = {};
    if (!prem) problems.push('Paste the "Premium" sheet so the tool has this plan\'s prices.');
    else {
      var pc = vhisPremiumCols(prem, plan);
      if (!pc) problems.push('The "Premium" paste does not look like the VHIS Premium sheet.');
      else if (!pc.tiers.length) problems.push('"' + plan + '" is not in the pasted Premium sheet.');
      else {
        tiers = pc.tiers.map(function (t) { return { label: t.label, variant: t.variant, amount: t.amount }; });
        tiers.forEach(function (t) { if (t.amount == null) problems.push('Deductible header "' + t.label + '" does not read as "HK$<amount> 墊底費".'); });
        var areas = []; tiers.forEach(function (t) { if (t.variant && areas.indexOf(t.variant) < 0) areas.push(t.variant); });

        var dpc = disc ? vhisPremiumCols(disc, plan) : null;
        var byKey = function (rowsX, h) { var o = {}; rowsX.slice(h + 1).forEach(function (r) { var a = intAge(r[0]), g = gs(r[1], r[2]); if (a != null && g) (o[a] = o[a] || {})[g] = r; }); return o; };
        var P = byKey(prem, pc.h), D = dpc && dpc.tiers.length ? byKey(disc, dpc.h) : null;
        for (var age = 0; age <= 80; age++) {
          var a = String(age), per = {}, dper = {};
          ['male-smoker', 'male-non-smoker', 'female-smoker', 'female-non-smoker'].forEach(function (g) {
            var row = P[a] && P[a][g]; if (!row) return;
            var vals = pc.tiers.map(function (t) { var v = num(row[t.col]); return v == null || isNaN(v) ? null : roundEven(v, 0); });
            if (!vals.some(function (v) { return v != null; })) return;
            per[g] = vals;
            if (D) { var drow = D[a] && D[a][g]; dper[g] = dpc.tiers.map(function (t, i) { var dv = drow ? num(drow[t.col]) : null; return dv != null && !isNaN(dv) && vals[i] != null && roundEven(dv, 0) < vals[i] ? roundEven(dv, 0) : null; }); }
          });
          if (Object.keys(per).length) premiums[a] = per;
          if (Object.keys(dper).some(function (g) { return dper[g].some(function (x) { return x != null; }); })) dprices[a] = dper;
        }
        var missing = 0; for (var aa = 0; aa <= 80; aa++) ['male-smoker', 'male-non-smoker', 'female-smoker', 'female-non-smoker'].forEach(function (g) { if (!premiums[aa] || !premiums[aa][g]) missing++; });
        if (missing) warnings.push(missing + ' of 324 age/group rows have no premium in the sheet.');
        // Product Details 墊底費 row relabels the tiers when the Premium headers were copied wrong (build script, Clara 2026-10-09)
        var declared = clean(cell(R.ded, c));
        if (declared && !areas.length) {
          var decl = declared.split('/').map(function (x) { return parseInt(x.replace(/[^0-9]/g, '') || '0', 10); });
          var have = tiers.map(function (t) { return t.amount; });
          if (decl.join() !== have.join() && decl.length === have.length) {
            tiers.forEach(function (t, i) { t.amount = decl[i]; t.label = 'HK$' + decl[i].toLocaleString('en-US') + ' 墊底費'; });
            warnings.push('Deductible labels taken from Product Details "' + declared + '" (the Premium sheet headers said ' + have.map(function (x) { return 'HK$' + Number(x).toLocaleString('en-US'); }).join(' / ') + ').');
          } else if (decl.join() !== have.join()) warnings.push('Deductibles disagree: Product Details "' + declared + '" vs Premium sheet ' + have.join(' / ') + '.');
        }
        if (disc && !D) warnings.push('"' + plan + '" is not in the pasted Discounted Premium sheet, so no first-year price.');
      }
    }
    var url = clean(cell(R.link, c));
    if (!url) problems.push('No Referral Link in the sheet. A plan without an apply link cannot be added.');
    else if (!/^https:\/\//.test(url)) problems.push('The Referral Link is not a full https:// link.');
    var hasDisc = clean(cell(R.disc, c)) === 'Y', code = clean(cell(R.code, c)), descr = clean(cell(R.descr, c));
    if (hasDisc && !code && !descr) warnings.push('"Is there discount?" is Y but there is no promo code or description — the offer would be empty.');
    var dkeys = Object.keys(dprices);
    if (dkeys.length && !hasDisc) warnings.push('The Discounted Premium sheet has prices for this plan, but "Is there discount?" is not Y — they are not shown.');
    var record = {
      id: opts.id, providerId: opts.providerId, insurer: clean(cell(R.name, c)), name: plan,
      planType: clean(cell(R.std, c)) === 'Y' ? '政府標準計劃' : '靈活計劃',
      tags: tags, coverage: coverage, moreInfo: moreInfo, docs: docs, deductibleTiers: tiers, premiums: premiums,
      internalNotes: notes, taxCaveat: tax,
      offer: hasDisc ? { code: code, text: descr, end: R.end >= 0 ? endDate(cell(R.end, c)) : null } : null,
      url: url, rank: null, discount: dkeys.length && hasDisc ? { label: '首年優惠價', prices: dprices } : null
    };
    var records = splitByArea(record);
    if (records.length > 1) warnings.push('Priced for ' + records.length + ' areas, so it becomes ' + records.length + ' plans on the page: ' + records.map(function (r) { return r.name; }).join(' / ') + '.');
    return { record: record, records: records, problems: problems, warnings: warnings };
  }

  var api = { vhisDetails: vhisDetails, vhisBuildPlan: vhisBuildPlan, cleanText: clean, roundEven: roundEven, num: num, parseTSV: parseTSV, detect: detect, matchName: matchName, importSheet: importSheet, norm: norm, dice: dice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);
