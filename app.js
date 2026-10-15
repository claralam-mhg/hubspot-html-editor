/* PCT Page Editor — screen logic. Every editor writes into one output per module;
   the same review + checks + copy flow runs for all of them. */
(function () {
  'use strict';
  var E = window.PCTEngine, M = window.PCTModules, R = window.PCTReview, PAGES = window.PCTPages.PAGES;
  var S = { page: PAGES[0], modIdx: null, mods: {}, live: {} };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function get(o, p) { return String(p).split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function cfg() { return S.page.data; }
  function mod() { return S.page.modules[S.modIdx]; }
  function st(i) { var k = S.page.key + ':' + (i == null ? S.modIdx : i); return S.mods[k] || (S.mods[k] = { original: '', loaded: false, mode: 'form' }); }

  /* ================= output + review (logic lives in review.js) ================= */
  function output(m, s) { return R.output(S.page, m, s); }
  function review(m, s) { return R.review(S.page, m, s); }
  function hasChanges(i) { var s = st(i), m = S.page.modules[i]; if (!s.loaded) return false; try { return output(m, s) !== s.original; } catch (e) { return true; } }

  /* ================= tabs + left column ================= */
  function renderTabs() {
    $('tabs').innerHTML = PAGES.map(function (p) {
      return '<button class="tab" role="tab" data-key="' + p.key + '" aria-selected="' + (p === S.page) + '"' + (p.status !== 'live' ? ' disabled title="' + esc(p.reason || 'Coming next') + '"' : '') + '>' + esc(p.label) + (p.status !== 'live' ? '<small>(soon)</small>' : '') + '</button>';
    }).join('');
  }
  function renderLeft() {
    var p = S.page, h = '';
    h += '<div class="card"><h2>' + esc(p.label) + '</h2><div class="muted"><a href="' + esc(p.liveUrl) + '" target="_blank" rel="noopener">' + esc(p.liveUrl.replace('https://www.', '')) + '</a></div>';
    if (p.shortcuts) h += '<h3>Common changes</h3><div class="shortcuts">' + p.shortcuts.map(function (sc, k) { return '<button class="btn sm" data-jump="' + k + '">' + esc(sc.label) + '</button>'; }).join('') + '</div>';
    h += '<h3>Modules (in page order)</h3><ul class="modlist">';
    p.modules.forEach(function (m, i) {
      var pending = hasChanges(i);
      h += '<li class="mod editable' + (S.modIdx === i ? ' active' : '') + '" data-mod="' + i + '" tabindex="0"><span class="num">' + (i + 1) + '</span><span class="nm">' + esc(m.file) + '</span>' + (pending ? '<span class="badge pending">Not pasted yet</span>' : '') + '</li>';
    });
    h += '</ul></div>';
    $('left').innerHTML = h;
  }

  /* ================= right column ================= */
  function renderRight() {
    if (S.modIdx == null) {
      $('right').innerHTML = '<div class="card empty"><h2>What do you want to change?</h2><p>Pick the module on the left that holds it. Not sure? Read the descriptions after you click.</p><ol><li>Paste the module\'s current code from HubSpot</li><li>Make the change in the form</li><li>Check the summary, copy the new code, paste it back into the same module</li></ol></div>';
      return;
    }
    var m = mod(), s = st(), h = '';
    h += '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>' + esc(m.file) + '</h2><div class="muted">' + esc(m.what || '') + '</div></div>';
    if (s.loaded && m.editor !== 'code') h += '<div class="seg"><button class="' + (s.mode === 'form' ? 'on' : '') + '" data-mode="form">Form</button><button class="' + (s.mode === 'code' ? 'on' : '') + '" data-mode="code">Edit code directly</button></div>';
    h += '</div></div>';
    if (!s.loaded) { if (S.jump && S.jump.idx === S.modIdx) h += '<div class="msg ok" style="margin:-8px 0 16px">Load this module and you will land on <b>' + esc(S.jump.label) + '</b>.</div>'; h += renderLive(m) + renderPaste(m, s); $('right').innerHTML = h; return; }
    if (s.source) h += '<div class="msg ' + (s.source.kind === 'live' ? 'ok' : 'ok') + '" style="margin:-8px 0 16px">' + (s.source.kind === 'live' ? 'Editing the live page version from ' + hhmm(s.source.at) + '. Its code has no indentation. That is how HubSpot serves it, and it works the same.' : 'Editing the code you pasted from HubSpot.') + ' <button class="btn sm" id="reload">Start again</button></div>';
    if (s.mode === 'code') h += renderCode(m, s);
    else if (m.editor === 'products') h += renderProductsModule(m, s);
    else if (m.editor === 'content' || m.editor === 'banner') h += renderContent(m, s);
    else if (m.editor === 'scripts') h += renderScripts(m, s);
    h += renderReview(m, s);
    $('right').innerHTML = h;
    if (m.editor === 'products' && s.mode === 'form' && s.vtab === 'products') bindRank();
  }

  /* ---------- live-page copy (written every ~15 min by the GitHub job into live/<page>.json) ---------- */
  function fetchLive(page) {
    if (S.live[page.key]) return;
    S.live[page.key] = { status: 'loading' };
    fetch('live/' + page.key + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { S.live[page.key] = { status: 'ok', data: d }; if (S.page === page) renderRight(); })
      .catch(function () { S.live[page.key] = { status: 'none' }; if (S.page === page) renderRight(); });
  }
  function liveEntry(m) { var L = S.live[S.page.key]; return L && L.status === 'ok' && !L.data.error && L.data.modules[m.file] && L.data.modules[m.file].code ? L.data.modules[m.file] : null; }
  function ago(iso) {
    var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.round(min / 60) + ' h ago';
  }
  function hhmm(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function renderLive(m) {
    var L = S.live[S.page.key];
    if (!L || L.status === 'none') return '';
    if (L.status === 'loading') return '<div class="card"><p class="muted">Checking for a copy of the live page…</p></div>';
    var d = L.data, e = liveEntry(m), h = '<div class="card">';
    if (!e) {
      var why = d.error ? 'The live page could not be read at ' + hhmm(d.fetchedAt) + ' (' + d.error + ').' : 'This module was not found on the live page' + (d.modules[m.file] && d.modules[m.file].error ? ' (' + d.modules[m.file].error + ')' : '') + '.';
      return h + '<h2>Load from the live page</h2><div class="msg warn">' + esc(why) + ' Paste it from HubSpot below.</div></div>';
    }
    var old = Date.now() - new Date(d.fetchedAt).getTime() > 45 * 60000;
    h += '<h2>Load from the live page</h2><p>Copy of the live page taken at <b>' + hhmm(d.fetchedAt) + '</b> (' + ago(d.fetchedAt) + '). It refreshes about every 15 minutes.</p>';
    if (old) h += '<div class="msg warn">This copy is more than 45 minutes old. If the page was published since, paste the module from HubSpot instead.</div>';
    h += '<p class="muted">If you or anyone published this module in HubSpot after ' + hhmm(d.fetchedAt) + ', paste it from HubSpot instead, or you would undo that change.</p>';
    return h + '<div class="row"><button class="btn primary" id="loadLive">Load live version</button></div></div>';
  }

  function renderPaste(m, s) {
    var liveAvailable = !!liveEntry(m);
    var h = '<div class="card"><h2>' + (liveAvailable ? 'Or paste it from HubSpot' : 'Paste the module from HubSpot') + '</h2>';
    h += '<ol class="steps muted"><li>In HubSpot, open <b>' + esc(S.page.hubspotPage) + '</b> in the page editor.</li><li>Find the module whose code starts with <code>' + esc(m.find) + '</code> and open its HTML.</li><li>Select all (Cmd+A), copy (Cmd+C), paste below.</li></ol>';
    h += '<p class="muted">Always copy fresh from HubSpot. Then you never undo someone else\'s change.</p>';
    h += '<textarea class="code" id="paste" spellcheck="false" placeholder="Paste the whole module here…">' + esc(s.draft || '') + '</textarea>';
    h += '<div class="row" style="margin-top:8px"><button class="' + (liveAvailable ? 'btn' : 'btn primary') + '" id="loadBtn">Read this module</button>' + (s.fpMismatch ? '<button class="btn" id="loadAnyway">It is the ' + esc(m.file) + ' module — continue</button>' : '') + '</div>';
    if (s.err) h += '<div class="msg err">' + esc(s.err) + '</div>';
    return h + '</div>';
  }
  function load(s, m, text, skipFp) {
    s.err = ''; s.fpMismatch = false; s.draft = text;
    if (!text.trim()) { s.err = 'The box is empty. Paste the module code from HubSpot first.'; return; }
    if (!skipFp && m.fingerprint && text.indexOf(m.fingerprint) < 0) { s.err = 'This does not look like the ' + m.file + ' module. Its code should start with ' + m.find + '. Check you opened the right module in HubSpot.'; s.fpMismatch = true; return; }
    var self = M.safety(text, text);
    if (!self.ok) { s.err = 'The code you pasted already has a problem: ' + self.errors.join(' ') + ' Fix it with "Edit code directly" after loading, or restore the last working version in HubSpot.'; }
    s.original = text; s.loaded = true; s.copied = false; s.allowHookRemoval = false; s.structural = false; s.fromCode = false;
    s.mode = m.editor === 'code' ? 'code' : 'form';
    s.code = text;
    try { initForm(m, s, text); } catch (e) { s.mode = 'code'; s.err = 'The form could not read this module (' + e.message + '). You can still edit the code directly.'; }
    if (S.jump && S.jump.idx === S.modIdx) { if (S.jump.tab && s.mode === 'form') s.vtab = S.jump.tab; S.jump = null; }
  }
  function initForm(m, s, text) {
    if (m.editor === 'products') {
      s.doc = E.load(text, cfg()); s.order = baseOrder(s.doc); s.fields = {}; s.sel = null;
      s.base = text; s.vedits = {}; s.vtab = 'products'; s.q = '';
      (m.vars || []).forEach(function (v) { if (v.v[0] !== '@' && !M.readVar(text, v.v)) throw new Error(v.v + ' not found'); });
    }
    if (m.editor === 'content' || m.editor === 'banner') { s.base = text; s.fields = M.htmlFields(text, { overriddenIds: S.page.overriddenIds }); s.edits = {}; s.q = ''; }
    if (m.editor === 'scripts') {
      s.base = text; s.vedits = {}; s.vtab = s.vtab || m.vars[0].v; s.q = '';
      m.vars.forEach(function (v) { if (!M.readVar(text, v.v)) throw new Error(v.v + ' not found'); });
    }
  }

  /* ---------- direct code ---------- */
  function renderCode(m, s) {
    var h = '<div class="card"><h2>Edit code directly</h2><p class="muted">For anything the form cannot do. The checks below still run. Anything that would break the page blocks the copy.</p>';
    h += '<textarea class="code tall" id="codeBox" spellcheck="false">' + esc(s.code) + '</textarea>';
    h += '<label class="check"><input type="checkbox" id="allowHooks"' + (s.allowHookRemoval ? ' checked' : '') + '> I am removing an element, class or id on purpose (turns that check into a warning)</label></div>';
    return h;
  }

  /* ---------- products ---------- */
  function rec(s, id) { return s.doc.records.filter(function (r) { return r.id === id; })[0]; }
  function prodLabel(s, id) { return cfg().productLabel(rec(s, id).data); }
  function cur(s, id, path) {
    var e = s.fields[id]; if (e && e.hasOwnProperty(path)) return e[path];
    var v = get(rec(s, id).data, path); return v === undefined && cfg().defaults && path in cfg().defaults ? cfg().defaults[path] : v;
  }
  function orig(s, id, path) { var v = get(rec(s, id).data, path); return v === undefined && cfg().defaults && path in cfg().defaults ? cfg().defaults[path] : v; }
  function isEdited(s, id) { var e = s.fields[id] || {}; return Object.keys(e).some(function (p) { return JSON.stringify(e[p]) !== JSON.stringify(orig(s, id, p)); }); }
  function setPath(o, p, v) { var k = p.split('.'), x = o; for (var i = 0; i < k.length - 1; i++) { if (x[k[i]] == null || typeof x[k[i]] !== 'object') x[k[i]] = {}; x = x[k[i]]; } x[k[k.length - 1]] = v; }
  // the product as it will be after this session's edits — what display rules (badge first, hidden) look at
  function curData(s, id) { var d = JSON.parse(JSON.stringify(rec(s, id).data)); var e = s.fields[id] || {}; Object.keys(e).forEach(function (p) { setPath(d, p, e[p]); }); return d; }
  // rankOnly pages (VHIS): the list you arrange IS the order; rank numbers are written from it
  function baseOrder(doc) { var c = cfg(), ids = doc.records.map(function (r) { return r.id; }); return c.rankOnly ? c.displayOrder(doc.records.map(function (r) { return r.data; })).map(function (d) { return d.id; }) : ids; }
  function shownIds(s, ids) {
    var c = cfg(); if (c.rankOnly) return ids.slice();
    var list = ids.map(function (id) { return curData(s, id); });
    return (c.displayOrder ? c.displayOrder(list) : list).map(function (d) { return d.id; });
  }
  function renderProductsModule(m, s) {
    if (!m.vars) return renderProducts(m, s);
    var h = '<div class="card" style="padding-bottom:4px"><div class="seg wide"><button class="' + (s.vtab === 'products' ? 'on' : '') + '" data-vtab="products">Products &amp; ranking</button>' +
      m.vars.map(function (v) { return '<button class="' + (s.vtab === v.v ? 'on' : '') + '" data-vtab="' + v.v + '">' + esc(v.title) + '</button>'; }).join('') + '</div></div>';
    if (s.vtab === 'products') return h + renderProducts(m, s);
    var vv = m.vars.filter(function (x) { return x.v === s.vtab; })[0];
    if (vv.kind === 'productColumns') return h + renderProductColumns(s, vv);
    if (vv.kind === 'productTags') return h + renderProductTags(s, vv);
    if (vv.kind === 'productRates') return h + renderProductRates(s, vv);
    return h + renderVar(m, s, vv);
  }
  function renderProducts(m, s) {
    var c = cfg(), h = '', origIds = baseOrder(s.doc);
    var shown = shownIds(s, s.order), origShown = shownIds({ doc: s.doc, fields: {} }, origIds);
    var hidden = s.order.filter(function (id) { return shown.indexOf(id) < 0; });
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><h2>Ranking</h2><div class="muted">Drag a product, or use the arrows. #1 shows first on the page.' + (c.displayOrder && /badge/.test(String(c.displayOrder)) ? ' Products with a badge always show above products without one.' : '') + '</div></div>' + (shown.join() !== origShown.join() ? '<button class="btn sm" id="resetOrder">Undo ranking changes</button>' : '') + '</div>';
    h += '<ol class="rank-list" id="rankList">';
    shown.forEach(function (id, n) { h += rankRow(s, id, n, shown.length, origShown); });
    h += '</ol>';
    if (hidden.length) {
      h += '<h3>Hidden from the page</h3><ol class="rank-list">';
      hidden.forEach(function (id) { h += rankRow(s, id, -1, 0, origShown); });
      h += '</ol>';
    }
    return h + (m.note ? '<p class="muted" style="margin-top:8px">' + esc(m.note) + '</p>' : '') + '</div>';
  }
  function rankRow(s, id, n, total, origShown) {
    var c = cfg(), d = curData(s, id), op = origShown.indexOf(id), code = cur(s, id, 'exclusive.code') || d.promo, logo = c.logo(d);
    var moved = n < 0 ? '' : op < 0 ? '<span class="moved">was hidden</span>' : op !== n ? '<span class="moved">was #' + (op + 1) + '</span>' : '';
    var h = '<li class="rank-item' + (s.sel === id ? ' selected' : '') + (n < 0 ? ' off' : '') + '"' + (n >= 0 ? ' draggable="true"' : '') + ' data-id="' + esc(id) + '">' +
      '<div class="rank-pos">' + (n < 0 ? '–' : n + 1) + '</div>' + (logo ? '<img class="rank-logo" src="' + esc(logo) + '" alt="">' : '<div></div>') +
      '<div><div class="rank-name">' + esc(c.productLabel(d)) + moved + (isEdited(s, id) ? '<span class="edited">edited</span>' : '') + '</div>' +
      '<div class="rank-meta">' + esc(c.productSub(d)) + (code ? ' · code ' + esc(code) : '') + '</div></div><div class="row">' +
      (n >= 0 ? '<button class="btn sm" data-up="' + n + '" ' + (n === 0 ? 'disabled' : '') + ' aria-label="Move up">↑</button><button class="btn sm" data-down="' + n + '" ' + (n === total - 1 ? 'disabled' : '') + ' aria-label="Move down">↓</button>' : '') +
      '<button class="btn sm" data-edit="' + esc(id) + '">' + (s.sel === id ? 'Close' : 'Edit') + '</button></div></li>';
    if (s.sel === id) h += '<li>' + renderProductForm(s, id) + '</li>';
    return h;
  }
  // One row per product, one column per field (OSI price / discount)
  function renderProductColumns(s, v) {
    var c = cfg(), ids = shownIds(s, s.order).concat(s.order.filter(function (x) { return shownIds(s, s.order).indexOf(x) < 0; }));
    var h = '<div class="card"><p class="hint">Annual premium in HK$.' + (v.cols.some(function (x) { return x.nullable; }) ? ' Leave the discounted price empty if there is no discount.' : '') + '</p><div class="tablewrap"><table class="rates"><thead><tr><th>Product</th>' + v.cols.map(function (x) { return '<th>' + esc(x.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    ids.forEach(function (id) {
      var d = curData(s, id);
      h += '<tr><th style="white-space:normal;min-width:220px">' + esc(c.productLabel(d)) + '<div class="hint">' + esc(c.productSub(d)) + '</div></th>';
      v.cols.forEach(function (x) {
        var val = cur(s, id, x.p), o = orig(s, id, x.p);
        h += '<td class="' + (JSON.stringify(val) !== JSON.stringify(o) ? 'changed' : '') + '"><input type="number" min="0" step="any" data-pid="' + esc(id) + '" data-ppath="' + x.p + '" data-type="' + (x.nullable ? 'number-null' : 'number') + '" value="' + (typeof val === 'number' && isFinite(val) ? val : '') + '"></td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>' + pasteBox() + '</div>';
  }
  // Every product's tags in one place. Tag shape comes from the page's own tags field
  // (Life: zh/en/colour · CI: zh · VHIS: plain words) — or a single badge (OSI).
  function renderProductTags(s, v) {
    var c = cfg(), f = c.fields.filter(function (x) { return x.path === v.field; })[0];
    var sh = shownIds(s, s.order), ids = sh.concat(s.order.filter(function (x) { return sh.indexOf(x) < 0; }));
    var h = '<div class="card"><p class="hint">' + (f.type === 'text-null' ? 'Leave a badge empty for no badge. Products with a badge always show above products without one.' : 'Tags appear as chips at the top of each product card.') + '</p>';
    ids.forEach(function (id) {
      var d = curData(s, id), val = cur(s, id, v.field), changed = JSON.stringify(val) !== JSON.stringify(orig(s, id, v.field));
      h += '<div class="field' + (changed ? ' changed' : '') + '" style="border-bottom:1px solid var(--border-default);padding-bottom:10px"><label>' + esc(c.productLabel(d)) + ' <span class="where">' + esc(c.productSub(d)) + '</span></label>';
      if (f.type === 'text-null') h += '<input type="text" data-pid="' + esc(id) + '" data-ppath="' + v.field + '" data-type="text-null" value="' + esc(val == null ? '' : val) + '" placeholder="No badge">';
      else if (f.type === 'strtags') {
        (val || []).forEach(function (t, k) { h += '<div class="tagrow" style="grid-template-columns:minmax(0,1fr) auto"><input type="text" data-pid="' + esc(id) + '" data-pstag="' + k + '" value="' + esc(t) + '"><button class="btn sm" data-pid="' + esc(id) + '" data-ptagdel="' + k + '">Remove</button></div>'; });
        h += '<button class="btn sm" data-pid="' + esc(id) + '" data-ptagadd="1">Add tag</button>';
      } else {
        var langs = f.langs || ['zh', 'en'];
        (val || []).forEach(function (t, k) {
          h += '<div class="tagrow" style="grid-template-columns:' + langs.map(function () { return 'minmax(0,1fr)'; }).join(' ') + (f.colours ? ' 110px' : '') + ' auto">' +
            langs.map(function (L) { return '<input type="text" data-pid="' + esc(id) + '" data-ptag="' + k + '" data-k="' + L + '" value="' + esc(t[L]) + '" placeholder="' + (L === 'zh' ? '中文' : 'English') + '">'; }).join('') +
            (f.colours ? '<select data-pid="' + esc(id) + '" data-ptag="' + k + '" data-k="c">' + f.colours.map(function (op) { return '<option value="' + op.value + '"' + (op.value === t.c ? ' selected' : '') + '>' + op.label + '</option>'; }).join('') + '</select>' : '') +
            '<button class="btn sm" data-pid="' + esc(id) + '" data-ptagdel="' + k + '">Remove</button></div>';
        });
        h += '<button class="btn sm" data-pid="' + esc(id) + '" data-ptagadd="1">Add tag</button>';
      }
      if (changed && f.type === 'text-null') h += '<div class="was">Was: ' + esc(orig(s, id, v.field) || '(no badge)') + '</div>';
      h += '</div>';
    });
    return h + '</div>';
  }
  function newTag(f) { if (f.type === 'strtags') return ''; var nt = {}; (f.langs || ['zh', 'en']).forEach(function (L) { nt[L] = ''; }); if (f.langs && f.langs.indexOf('en') < 0) nt.en = ''; if (f.colours) nt.c = f.colours[0].value; return nt; }
  function tagsField() { return cfg().fields.filter(function (x) { return x.path === 'tags'; })[0]; }
  // VHIS: premiums[age][group] = one price per deductible level, plus the first-year discounted table
  function renderProductRates(s, v) {
    var c = cfg(), ids = s.order; s.vp = s.vp && ids.indexOf(s.vp) >= 0 ? s.vp : ids[0];
    var d = curData(s, s.vp), table = get(d, v.path) || {}, ages = Object.keys(table), groups = ages.length ? Object.keys(table[ages[0]]) : [];
    s.vg = groups.indexOf(s.vg) >= 0 ? s.vg : groups[0];
    var tiers = (get(d, v.tiersPath) || []).map(function (t) { return t.label || ('HK$' + t.amount); }), hasDisc = !!get(d, v.discPath);
    var h = '<div class="card"><div class="row" style="align-items:flex-end">' +
      '<div class="field" style="flex:2;min-width:220px"><label>Plan</label><select id="vp">' + ids.map(function (id) { return '<option value="' + esc(id) + '"' + (id === s.vp ? ' selected' : '') + '>' + esc(c.productLabel(curData(s, id))) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:160px"><label>Group</label><select id="vg">' + groups.map(function (g) { return '<option' + (g === s.vg ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></div></div>';
    h += '<p class="hint">Annual premium in HK$ by age, one column per deductible level.' + (hasDisc ? ' "First year" is the discounted first-year premium shown on the card.' : '') + '</p>';
    h += '<div class="tablewrap" style="max-height:560px;overflow:auto"><table class="rates"><thead><tr><th>Age</th>' + tiers.map(function (t) { return '<th>' + esc(t) + '</th>' + (hasDisc ? '<th>' + esc(t) + ' · first year</th>' : ''); }).join('') + '</tr></thead><tbody>';
    ages.forEach(function (a) {
      var p1 = v.path + '.' + a + '.' + s.vg, p2 = v.discPath + '.' + a + '.' + s.vg;
      var std = cur(s, s.vp, p1) || [], dis = hasDisc ? (cur(s, s.vp, p2) || []) : [], so = orig(s, s.vp, p1) || [], dor = hasDisc ? (orig(s, s.vp, p2) || []) : [];
      h += '<tr><th>' + esc(a) + '</th>';
      tiers.forEach(function (t, i) {
        h += cellIn(p1, i, std[i], so[i]);
        if (hasDisc) h += cellIn(p2, i, dis[i], dor[i]);
      });
      h += '</tr>';
    });
    function cellIn(p, i, val, o) { return '<td class="' + (JSON.stringify(val) !== JSON.stringify(o) ? 'changed' : '') + '"><input type="number" min="0" step="any" data-pid="' + esc(s.vp) + '" data-tpath="' + p + '" data-ti="' + i + '" value="' + (typeof val === 'number' && isFinite(val) ? val : '') + '"></td>'; }
    return h + '</tbody></table></div>' + pasteBox() + '</div>';
  }
  // Paste a block copied from Excel into the table above, left to right, top to bottom
  function pasteBox() {
    return '<details class="paste"><summary>Paste from Excel</summary><p class="hint">Copy the numbers in Excel (rows and columns in the same order as this table) and paste them here. Commas and $ are ignored.</p>' +
      '<textarea class="code" id="pasteGrid" style="min-height:100px" placeholder="Paste here…"></textarea>' +
      '<label class="check"><input type="checkbox" id="pasteSkip"> The first column is the age or product name (skip it)</label>' +
      '<div class="row" style="margin-top:6px"><button class="btn" id="pasteFill">Fill the table</button></div></details>';
  }
  function fillFromPaste() {
    var rows = $('pasteGrid').value.replace(/\r/g, '').split('\n').filter(function (r) { return r.trim(); }).map(function (r) { return r.split('\t'); });
    if ($('pasteSkip').checked) rows = rows.map(function (r) { return r.slice(1); });
    var trs = $('pasteGrid').closest('.card').querySelectorAll('table.rates tbody tr'), n = 0;
    S.batch = true;
    rows.forEach(function (cells, i) {
      if (!trs[i]) return;
      var ins = trs[i].querySelectorAll('input[type=number]:not(:disabled)');
      cells.forEach(function (c, j) {
        var v = c.replace(/[,$\sHK]/g, ''); if (!ins[j] || v === '') return;
        if (!isFinite(+v)) return; ins[j].value = v; ins[j].dispatchEvent(new Event('input', { bubbles: true })); n++;
      });
    });
    S.batch = false; all();
    alert(n + ' cells filled. Check the table and the change summary before copying.');
  }
  function renderProductForm(s, id) {
    var c = cfg(), h = '<div class="card" style="margin:0 0 10px">', lastGroup = '';
    c.fields.forEach(function (f) {
      if (f.hidden) return;
      var o = orig(s, id, f.path);
      if (o === undefined && f.path.indexOf('.') > 0 && get(rec(s, id).data, f.path.split('.')[0]) == null) return; // e.g. no offer on this product
      if (f.group !== lastGroup) { h += '<h3>' + esc(f.group) + '</h3>'; lastGroup = f.group; }
      var val = cur(s, id, f.path), changed = JSON.stringify(val) !== JSON.stringify(o);
      h += '<div class="field' + (changed ? ' changed' : '') + '"><label>' + esc(f.label) + '</label>';
      if (f.type === 'tags') {
        var langs = f.langs || ['zh', 'en'];
        (val || []).forEach(function (t, k) {
          h += '<div class="tagrow" style="grid-template-columns:' + langs.map(function () { return 'minmax(0,1fr)'; }).join(' ') + (f.colours ? ' 110px' : '') + ' auto">' +
            langs.map(function (L) { return '<input type="text" data-tag="' + k + '" data-k="' + L + '" value="' + esc(t[L]) + '" placeholder="' + (L === 'zh' ? '中文' : 'English') + '">'; }).join('') +
            (f.colours ? '<select data-tag="' + k + '" data-k="c">' + f.colours.map(function (op) { return '<option value="' + op.value + '"' + (op.value === t.c ? ' selected' : '') + '>' + op.label + '</option>'; }).join('') + '</select>' : '') +
            '<button class="btn sm" data-tagdel="' + k + '">Remove</button></div>';
        });
        h += '<button class="btn sm" id="tagAdd">Add tag</button>';
      } else if (f.type === 'strtags') {
        (val || []).forEach(function (t, k) { h += '<div class="tagrow" style="grid-template-columns:minmax(0,1fr) auto"><input type="text" data-stag="' + k + '" value="' + esc(t) + '"><button class="btn sm" data-stagdel="' + k + '">Remove</button></div>'; });
        h += '<button class="btn sm" id="stagAdd">Add tag</button>';
      } else if (f.type === 'toggle') {
        h += '<label class="check"><input type="checkbox" data-toggle="' + f.path + '"' + (val !== false ? ' checked' : '') + '> ' + (val !== false ? 'On — shown on the page' : 'Off — hidden from the page') + '</label>';
      } else if (f.type === 'textarea') h += '<textarea data-path="' + f.path + '">' + esc(val) + '</textarea>';
      else if (f.type === 'number' || f.type === 'number-null') h += '<input type="number" min="0" step="any" data-path="' + f.path + '" data-type="' + f.type + '" value="' + (typeof val === 'number' ? val : '') + '">';
      else h += '<input type="text" data-path="' + f.path + '" data-type="' + (f.type || 'text') + '" value="' + esc(val == null ? '' : val) + '">';
      if (f.pattern && typeof val === 'string' && !new RegExp(f.pattern).test(val)) h += '<div class="bad">' + esc(f.patternMsg) + '</div>';
      if ((f.type === 'number' || f.type === 'number-null') && val !== null && val !== undefined && !(typeof val === 'number' && isFinite(val) && val >= 0)) h += '<div class="bad">Enter a number' + (f.type === 'number-null' ? ', or leave it empty' : '') + '.</div>';
      if (f.hint) h += '<div class="hint">' + esc(f.hint) + '</div>';
      if (changed && f.type !== 'tags' && f.type !== 'toggle') h += '<div class="was">Was: ' + esc(o == null ? '(empty)' : o) + '</div>';
      h += '</div>';
    });
    return h + '<div class="row"><button class="btn sm" data-undo="' + esc(id) + '">Undo changes to this product</button></div></div>';
  }

  /* ---------- content (HTML modules) ---------- */
  function meaningful(f) { return f.kind === 'attr' || /[\p{L}\p{N}]/u.test(f.value); }
  function contentField(s, f) {
    var val = s.edits.hasOwnProperty(f.idx) ? s.edits[f.idx] : f.value, changed = val !== f.value;
    var h = '<div class="field' + (changed ? ' changed' : '') + '"><label>' + esc(f.label) + ' <span class="where">' + esc(f.where) + '</span></label>';
    if (f.lockedBy) return h + '<div class="locked">' + esc(f.value) + '</div><div class="hint">The page replaces this with <b>scripts › Page text › ' + esc(f.lockedBy) + '</b> when it loads. Change it there.</div></div>';
    if (f.kind === 'text' && f.value.length > 70) h += '<textarea data-f="' + f.idx + '">' + esc(val) + '</textarea>';
    else h += '<input type="text" data-f="' + f.idx + '" value="' + esc(val) + '">';
    if (f.attr === 'src' || f.attr === 'srcset') h += '<img class="thumb" src="' + esc(val.split(/\s/)[0]) + '" alt="">';
    if (changed) h += '<div class="was">Was: ' + esc(f.value) + '</div>';
    return h + '</div>';
  }
  function renderContent(m, s) {
    var list = s.fields.filter(meaningful), h = '<div class="card">';
    if (!list.length) return h + '<h2>Nothing to edit in the form</h2><p class="muted">This module has no visible text, links or images. Use "Edit code directly" if you need to change it.</p></div>';
    var q = (s.q || '').toLowerCase();
    if (list.length > 12) h += '<input type="search" class="search" id="q" placeholder="Search the text in this module…" value="' + esc(s.q) + '">';
    if (m.editor === 'banner') {
      var sl = M.slides(s.base);
      sl.forEach(function (b, k) {
        h += '<div class="slide"><div class="row" style="justify-content:space-between"><h3>Banner ' + (k + 1) + '</h3><div class="row"><button class="btn sm" data-addslide="' + k + '">Add a copy</button><button class="btn sm" data-delslide="' + k + '"' + (sl.length < 2 ? ' disabled' : '') + '>Remove</button></div></div>';
        list.filter(function (f) { return f.start >= b.start && f.end <= b.end; }).forEach(function (f) { h += contentField(s, f); });
        h += '</div>';
      });
      h += '<p class="hint">"Add a copy" duplicates that banner at the end. Then change its link, images and description.</p>';
      list = list.filter(function (f) { return !sl.some(function (b) { return f.start >= b.start && f.end <= b.end; }); });
      if (list.length) h += '<h3>Other text in this module</h3>';
    }
    list.forEach(function (f) {
      if (q && (f.value + ' ' + f.where + ' ' + (s.edits[f.idx] || '')).toLowerCase().indexOf(q) < 0) return;
      h += contentField(s, f);
    });
    return h + '</div>';
  }

  /* ---------- data tables: page text, premium tables, FAQ lists ---------- */
  function vcur(s, v, path, data) { var k = v + '|' + path; return s.vedits.hasOwnProperty(k) ? s.vedits[k].value : get(data, path); }
  function renderScripts(m, s) {
    var h = '<div class="card" style="padding-bottom:4px"><div class="seg wide">' + m.vars.map(function (v) { return '<button class="' + (s.vtab === v.v ? 'on' : '') + '" data-vtab="' + v.v + '">' + esc(v.title) + '</button>'; }).join('') + '</div></div>';
    return h + renderVar(m, s, m.vars.filter(function (x) { return x.v === s.vtab; })[0]);
  }
  function renderVar(m, s, v) {
    var h = '<div class="card">', data = M.readVar(s.base, v.v).data;
    if (v.kind === 'text') {
      var root = data[v.root] || {}, q = (s.q || '').toLowerCase();
      h += '<input type="search" class="search" id="q" placeholder="Search page text (e.g. FAQ, hero, 免費)…" value="' + esc(s.q) + '">';
      h += '<p class="hint">You can use &lt;br&gt; for a line break and &lt;b&gt;…&lt;/b&gt; for bold.</p>';
      Object.keys(root).forEach(function (key) {
        var path = v.root + '.' + key, val = vcur(s, v.v, path, data), o = root[key];
        if (typeof o !== 'string') return;
        if (q && (key + ' ' + val).toLowerCase().indexOf(q) < 0) return;
        h += textField(key, v.v, path, val, o, o.length > 60);
      });
    } else if (v.kind === 'list') {
      data.forEach(function (item, n) {
        h += '<div class="slide"><h3>' + (n + 1) + '</h3>';
        v.fields.forEach(function (f) { var path = n + '.' + f.p, o = get(data, path); if (typeof o !== 'string') return; h += textField(f.label, v.v, path, vcur(s, v.v, path, data), o, f.long || o.length > 60); });
        h += '</div>';
      });
      h += '<p class="hint">To add or remove a question, use "Edit code directly".</p>';
    } else if (v.kind === 'rates') {
      var pids = Object.keys(data); s.rp = s.rp && data[s.rp] ? s.rp : pids[0];
      h += '<div class="field"><label>Product</label><select id="rp">' + pids.map(function (p) { return '<option' + (p === s.rp ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></div>';
      var ages = Object.keys(data[s.rp]), cols = [];
      // columns in the data's own order (as in the Excel premium sheet), so a pasted block lines up
      ages.forEach(function (a) { Object.keys(data[s.rp][a]).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
      h += '<p class="hint">Annual premium in HK$. Left = original, right = after discount' + (v.discountOptional ? ' (leave empty for no discount)' : '') + '.' + (v.na ? ' Tick N/A if the plan is not offered.' : '') + ' A dash means this combination is not offered.</p><div class="tablewrap"><table class="rates"><thead><tr><th>Age</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      ages.forEach(function (a) {
        h += '<tr><th>' + esc(a) + '</th>';
        cols.forEach(function (c) {
          var path = s.rp + '.' + a + '.' + c, o = get(data, path);
          if (o === undefined) { h += '<td class="muted">—</td>'; return; }
          var val = vcur(s, v.v, path, data), ch = JSON.stringify(val) !== JSON.stringify(o);
          if (val && typeof val === 'object' && !Array.isArray(val)) { h += '<td class="' + (ch ? 'changed' : '') + '"><input type="text" class="note" data-ratenote="' + esc(path) + '" value="' + esc(val.n) + '" title="Shown instead of a price"><div class="hint">note instead of price</div></td>'; return; }
          var na = val === 'NA', arr = Array.isArray(val) ? val : [];
          h += '<td class="' + (ch ? 'changed' : '') + '"><div class="pair"><input type="number" min="0" data-rate="' + esc(path) + '" data-i="0" value="' + (na || arr[0] == null ? '' : esc(arr[0])) + '"' + (na ? ' disabled' : '') + '><input type="number" min="0" data-rate="' + esc(path) + '" data-i="1" value="' + (na || arr[1] == null ? '' : esc(arr[1])) + '"' + (na ? ' disabled' : '') + '></div>' +
            (v.na ? '<label class="na"><input type="checkbox" data-na="' + esc(path) + '"' + (na ? ' checked' : '') + '> N/A</label>' : '') + '</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>' + pasteBox();
    } else if (v.kind === 'grid') {
      var rows = Object.keys(data), gcols = Object.keys(data[rows[0]]);
      h += '<div class="tablewrap"><table class="rates"><thead><tr><th>Age</th>' + gcols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r) { h += '<tr><th>' + esc(r) + '</th>' + gcols.map(function (c) { var path = r + '.' + c, val = vcur(s, v.v, path, data); return '<td class="' + (val !== data[r][c] ? 'changed' : '') + '"><input type="number" step="any" data-grid="' + esc(path) + '" value="' + esc(val) + '"></td>'; }).join('') + '</tr>'; });
      h += '</tbody></table></div>' + pasteBox();
    }
    return h + '</div>';
  }
  function textField(label, v, path, val, o, long) {
    var changed = val !== o;
    return '<div class="field' + (changed ? ' changed' : '') + '"><label>' + esc(label) + '</label>' + (long ? '<textarea data-v="' + v + '" data-p="' + esc(path) + '">' + esc(val) + '</textarea>' : '<input type="text" data-v="' + v + '" data-p="' + esc(path) + '" value="' + esc(val) + '">') + (changed ? '<div class="was">Was: ' + esc(o) + '</div>' : '') + '</div>';
  }

  /* ---------- review + copy ---------- */
  function renderReview(m, s) {
    var R = review(m, s), h = '<div class="card" id="review"><h2>Check before you copy</h2>';
    if (!R.changes.length && R.res.ok) { renderCopybar(m, s, R); return h + '<p class="muted">No changes yet.</p></div>'; }
    R.res.errors.forEach(function (e) { h += '<div class="msg err">' + esc(e) + '</div>'; });
    R.res.warnings.forEach(function (w) { h += '<div class="msg warn">' + esc(w) + '</div>'; });
    if (R.res.ok) h += '<div class="msg ok">All checks passed. The code runs and nothing the page relies on was removed.</div>';
    h += '<h3>What will change</h3><div class="tablewrap"><table class="changes"><thead><tr><th>Where</th><th>What</th><th>Before</th><th>After</th></tr></thead><tbody>';
    R.changes.slice(0, 200).forEach(function (c) { h += '<tr><td>' + esc(c.product) + '</td><td>' + esc(c.field) + '</td><td>' + esc(c.before) + '</td><td>' + esc(c.after) + '</td></tr>'; });
    h += '</tbody></table></div>';
    if (R.out) { var d = E.lineDiff(s.original, R.out); h += '<details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Show code changes (' + d.length + ' lines)</summary><div class="diff">' + d.slice(0, 600).map(function (o) { return '<div class="' + (o.t === '+' ? 'add' : 'del') + '">' + o.t + ' ' + esc(o.s.length > 600 ? o.s.slice(0, 600) + ' … (' + o.s.length.toLocaleString() + ' characters on this line)' : o.s) + '</div>'; }).join('') + '</div></details>'; }
    var others = S.page.modules.map(function (x, i) { return i; }).filter(function (i) { return i !== S.modIdx && hasChanges(i); });
    h += '<h3>Paste it back into HubSpot</h3><ol class="steps"><li>Press <b>Copy new code</b> below.</li><li>In HubSpot, open the module whose code starts with <code>' + esc(m.find) + '</code>, select all of its code and paste over it. Paste only into this module.</li><li>Press <b>Preview</b>. Check every row in the table above, on desktop and on phone.</li><li>If it all looks right, <b>Publish</b>. If not, close without publishing. Nothing changes live until you publish.</li><li>Post the change summary in the request thread.</li></ol>';
    if (others.length) h += '<div class="msg warn">You also changed module' + (others.length > 1 ? 's ' : ' ') + others.map(function (i) { return (i + 1) + ' (' + S.page.modules[i].file + ')'; }).join(', ') + '. Paste those too before you publish.</div>';
    renderCopybar(m, s, R);
    return h + '</div>';
  }
  function renderCopybar(m, s, R) {
    var bar = $('copybar'); bar.hidden = false;
    var n = R.changes.length, ok = n && R.res.ok;
    var status = !R.res.ok ? 'Fix ' + R.res.errors.length + ' problem' + (R.res.errors.length > 1 ? 's' : '') + ' before copying' : !n ? 'No changes yet' : R.res.ok ? n + ' change' + (n > 1 ? 's' : '') + ' ready' + (R.res.warnings.length ? ' — read the ' + R.res.warnings.length + ' warning' + (R.res.warnings.length > 1 ? 's' : '') + ' first' : '') : 'Fix ' + R.res.errors.length + ' problem' + (R.res.errors.length > 1 ? 's' : '') + ' before copying';
    var html = '<span class="status">' + esc(status) + '</span><button class="btn" id="copySummary"' + (ok ? '' : ' disabled') + '>Copy change summary</button><button class="btn primary" id="copyCode"' + (ok ? '' : ' disabled') + '>' + (s.copied ? 'Copied — now paste into HubSpot' : 'Copy new code') + '</button>';
    // Only rebuild when something visible changed. Leaving a field re-renders the page; if the buttons were
    // rebuilt every time, a click on Copy made straight after typing would land on a removed button and be lost.
    if (bar.dataset.h !== html) { bar.innerHTML = html; bar.dataset.h = html; }
    $('copyCode').onclick = function () { copy(R.out, function () { s.copied = true; renderCopybar(m, s, R); }); };
    $('copySummary').onclick = function () {
      var txt = S.page.label + ' — ' + m.file + ' module updated\n' + R.changes.map(function (c) { return '• ' + c.product + ' — ' + c.field + ':\n  ' + String(c.before).replace(/\n/g, '\n  ') + '\n  → ' + String(c.after).replace(/\n/g, '\n  '); }).join('\n');
      copy(txt, function () { $('copySummary').textContent = 'Summary copied'; });
    };
  }
  function copy(text, done) {
    function fallback() { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  /* ================= events ================= */
  function soft() {
    if (S.batch) return; // refresh review + module badges without rebuilding the form (keeps typing focus)
    var old = $('review'); if (!old) return renderRight();
    var tmp = document.createElement('div'); tmp.innerHTML = renderReview(mod(), st()); old.replaceWith(tmp.firstChild); renderLeft();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, .mod.editable'); if (!t) return;
    var s = S.modIdx != null ? st() : null, m = S.modIdx != null ? mod() : null;
    if (t.classList.contains('tab')) { S.page = PAGES.filter(function (p) { return p.key === t.dataset.key; })[0]; S.modIdx = null; return all(); }
    if (t.dataset.mod != null) { S.modIdx = +t.dataset.mod; return all(); }
    if (t.dataset.jump != null) {
      var sc = S.page.shortcuts[+t.dataset.jump], idx = S.page.modules.map(function (x) { return x.file; }).indexOf(sc.file);
      S.modIdx = idx; var js = st(idx);
      if (js.loaded) { if (sc.tab) { js.vtab = sc.tab; js.mode = 'form'; } } else S.jump = { idx: idx, tab: sc.tab, label: sc.label };
      return all();
    }
    if (t.id === 'loadBtn' || t.id === 'loadAnyway') { load(s, m, $('paste').value, t.id === 'loadAnyway'); if (s.loaded) s.source = { kind: 'paste' }; return all(); }
    if (t.id === 'loadLive') { var le = liveEntry(m); load(s, m, le.code, false); if (s.loaded) s.source = { kind: 'live', at: S.live[S.page.key].data.fetchedAt }; return all(); }
    if (t.id === 'reload') { if (hasChanges(S.modIdx) && !confirm('Discard your changes to this module?')) return; S.mods[S.page.key + ':' + S.modIdx] = null; delete S.mods[S.page.key + ':' + S.modIdx]; return all(); }
    if (t.dataset.mode) {
      if (t.dataset.mode === s.mode) return;
      if (t.dataset.mode === 'code') { try { s.code = output(m, s); } catch (err) {} s.mode = 'code'; }
      else { try { initForm(m, s, s.code); s.fromCode = s.code !== s.original; if (m.editor !== 'products') { /* forms start from the code */ } s.mode = 'form'; } catch (err) { alert('The form cannot read the code as it is now: ' + err.message); } }
      s.copied = false; return all();
    }
    if (t.dataset.vtab) { s.vtab = t.dataset.vtab; s.q = ''; return renderRight(); }
    if (t.dataset.addslide != null) { s.base = M.addSlide(M.applyHtml(s.base, s.fields, s.edits), +t.dataset.addslide); s.fields = M.htmlFields(s.base, { overriddenIds: S.page.overriddenIds }); s.edits = {}; s.structural = true; s.copied = false; return all(); }
    if (t.dataset.delslide != null) { if (!confirm('Remove banner ' + (+t.dataset.delslide + 1) + '?')) return; s.base = M.removeSlide(M.applyHtml(s.base, s.fields, s.edits), +t.dataset.delslide); s.fields = M.htmlFields(s.base, { overriddenIds: S.page.overriddenIds }); s.edits = {}; s.structural = true; s.copied = false; return all(); }
    if (t.id === 'resetOrder') { s.order = baseOrder(s.doc); s.copied = false; return all(); }
    if (t.dataset.up != null) return move(s, +t.dataset.up, +t.dataset.up - 1);
    if (t.dataset.down != null) return move(s, +t.dataset.down, +t.dataset.down + 1);
    if (t.dataset.edit) { s.sel = s.sel === t.dataset.edit ? null : t.dataset.edit; return renderRight(); }
    if (t.dataset.undo) { delete s.fields[t.dataset.undo]; s.copied = false; return all(); }
    if (t.id === 'pasteFill') return fillFromPaste();
    if (t.dataset.ptagadd) { var pa = (cur(s, t.dataset.pid, 'tags') || []).slice(); pa.push(newTag(tagsField())); setP(s, t.dataset.pid, 'tags', pa); return all(); }
    if (t.dataset.ptagdel != null) { var pd = cur(s, t.dataset.pid, 'tags').slice(); pd.splice(+t.dataset.ptagdel, 1); setP(s, t.dataset.pid, 'tags', pd); return all(); }
    if (t.id === 'tagAdd') {
      var tf = cfg().fields.filter(function (f) { return f.type === 'tags'; })[0], nt = {};
      (tf.langs || ['zh', 'en']).forEach(function (L) { nt[L] = ''; }); if (tf.langs && tf.langs.indexOf('en') < 0) nt.en = ''; if (tf.colours) nt.c = tf.colours[0].value;
      var tg = (cur(s, s.sel, 'tags') || []).slice(); tg.push(nt); setP(s, s.sel, 'tags', tg); return all();
    }
    if (t.id === 'stagAdd') { var sa = (cur(s, s.sel, 'tags') || []).slice(); sa.push(''); setP(s, s.sel, 'tags', sa); return all(); }
    if (t.dataset.stagdel != null) { var sd = cur(s, s.sel, 'tags').slice(); sd.splice(+t.dataset.stagdel, 1); setP(s, s.sel, 'tags', sd); return all(); }
    if (t.dataset.tagdel != null) { var tg2 = cur(s, s.sel, 'tags').slice(); tg2.splice(+t.dataset.tagdel, 1); setP(s, s.sel, 'tags', tg2); return all(); }
  });
  function setP(s, id, path, v) { s.fields[id] = s.fields[id] || {}; s.fields[id][path] = v; s.copied = false; }
  function setV(s, v, path, value) { s.vedits[v + '|' + path] = { v: v, path: path, value: value }; s.copied = false; }
  document.addEventListener('input', function (e) {
    var t = e.target; if (S.modIdx == null) return; var s = st(), m = mod();
    if (t.id === 'q') { s.q = t.value; var pos = t.selectionStart; renderRight(); var q = $('q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (t.id === 'codeBox') { s.code = t.value; s.copied = false; return soft(); }
    if (t.dataset.f != null) { s.edits[t.dataset.f] = t.value; s.copied = false; t.closest('.field').classList.toggle('changed', t.value !== s.fields[+t.dataset.f].value); return soft(); }
    if (t.dataset.ppath) {
      var pv = t.dataset.type === 'text-null' ? (t.value === '' ? null : t.value) : t.value === '' ? (t.dataset.type === 'number-null' ? null : NaN) : Number(t.value);
      setP(s, t.dataset.pid, t.dataset.ppath, pv); return soft();
    }
    if (t.dataset.pstag != null) { var ps = cur(s, t.dataset.pid, 'tags').slice(); ps[+t.dataset.pstag] = t.value; setP(s, t.dataset.pid, 'tags', ps); return soft(); }
    if (t.dataset.ptag != null) { var pt = cur(s, t.dataset.pid, 'tags').map(function (x) { return Object.assign({}, x); }); pt[+t.dataset.ptag][t.dataset.k] = t.value; setP(s, t.dataset.pid, 'tags', pt); return soft(); }
    if (t.dataset.tpath) { var ta = (cur(s, t.dataset.pid, t.dataset.tpath) || []).slice(); ta[+t.dataset.ti] = t.value === '' ? NaN : Number(t.value); setP(s, t.dataset.pid, t.dataset.tpath, ta); return soft(); }
    if (t.dataset.path) {
      var ty = t.dataset.type, val = t.value;
      if (ty === 'number') val = val === '' ? NaN : Number(val);
      else if (ty === 'number-null') val = val === '' ? null : Number(val);
      else if (ty === 'text-null') val = val === '' ? null : val;
      setP(s, s.sel, t.dataset.path, val); return soft();
    }
    if (t.dataset.stag != null) { var si = cur(s, s.sel, 'tags').slice(); si[+t.dataset.stag] = t.value; setP(s, s.sel, 'tags', si); return soft(); }
    if (t.dataset.tag != null) { var tg = cur(s, s.sel, 'tags').map(function (x) { return Object.assign({}, x); }); tg[+t.dataset.tag][t.dataset.k] = t.value; setP(s, s.sel, 'tags', tg); return soft(); }
    if (t.dataset.v) { setV(s, t.dataset.v, t.dataset.p, t.value); return soft(); }
    if (t.dataset.rate) {
      var data = M.readVar(s.base, s.vtab).data, val = vcur(s, s.vtab, t.dataset.rate, data); val = Array.isArray(val) ? val.slice() : [0, 0];
      var vdef = (mod().vars || []).filter(function (x) { return x.v === s.vtab; })[0] || {};
      val[+t.dataset.i] = t.value === '' ? (+t.dataset.i === 1 && vdef.discountOptional ? null : NaN) : Number(t.value); setV(s, s.vtab, t.dataset.rate, val);
      return soft();
    }
    if (t.dataset.ratenote) { setV(s, s.vtab, t.dataset.ratenote, { n: t.value }); return soft(); }
    if (t.dataset.grid) { setV(s, s.vtab, t.dataset.grid, t.value === '' ? NaN : Number(t.value)); return soft(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (S.modIdx == null) return; var s = st();
    if (t.id === 'rp') { s.rp = t.value; return renderRight(); }
    if (t.id === 'vp') { s.vp = t.value; return renderRight(); }
    if (t.id === 'vg') { s.vg = t.value; return renderRight(); }
    if (t.dataset.toggle) { setP(s, s.sel, t.dataset.toggle, t.checked); return all(); }
    // fields that decide where a product shows (e.g. OSI badge) re-sort the ranking once you leave the field
    if (t.dataset.path && cfg().displayOrder) return all();
    if (t.dataset.ptag != null && t.tagName === 'SELECT') { var pc = cur(s, t.dataset.pid, 'tags').map(function (x) { return Object.assign({}, x); }); pc[+t.dataset.ptag].c = t.value; setP(s, t.dataset.pid, 'tags', pc); return soft(); }
    if (t.dataset.ppath === 'badge') return all();
    if (t.id === 'allowHooks') { s.allowHookRemoval = t.checked; return soft(); }
    if (t.dataset.na) {
      var data = M.readVar(s.base, s.vtab).data, o = get(data, t.dataset.na);
      setV(s, s.vtab, t.dataset.na, t.checked ? 'NA' : (Array.isArray(o) ? o : [0, 0])); return renderRight();
    }
  });
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('editable')) { e.preventDefault(); e.target.click(); } });
  // from/to are positions in the list as shown on the page; hidden products keep their place after it
  function move(s, from, to) {
    var shown = shownIds(s, s.order); if (to < 0 || to >= shown.length) return;
    var id = shown.splice(from, 1)[0]; shown.splice(to, 0, id);
    s.order = shown.concat(s.order.filter(function (x) { return shown.indexOf(x) < 0; })); s.copied = false; all();
  }
  function bindRank() {
    var s = st(), dragId = null;
    document.querySelectorAll('.rank-item[draggable]').forEach(function (li) {
      li.addEventListener('dragstart', function (e) { dragId = li.dataset.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      li.addEventListener('dragend', function () { li.classList.remove('dragging'); });
      li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('drop-above'); });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-above'); });
      li.addEventListener('drop', function (e) { e.preventDefault(); li.classList.remove('drop-above'); var sh = shownIds(s, s.order), from = sh.indexOf(dragId), to = sh.indexOf(li.dataset.id); if (from >= 0 && to >= 0 && from !== to) move(s, from, to); });
    });
  }
  function all() { fetchLive(S.page); renderTabs(); renderLeft(); renderRight(); if (S.modIdx == null || !st().loaded) $('copybar').hidden = true; }
  all();
})();
