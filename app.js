/* PCT Page Editor — screen logic. Every editor writes into one output per module;
   the same review + checks + copy flow runs for all of them. */
(function () {
  'use strict';
  var E = window.PCTEngine, M = window.PCTModules, R = window.PCTReview, X = window.PCTExcel, PAGES = window.PCTPages.PAGES;
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
    if (s.source) h += '<div class="msg ' + (s.source.kind === 'live' ? 'ok' : 'ok') + '" style="margin:-8px 0 16px">' + (m.hosted ? (s.source.kind === 'live' ? 'Editing the live file, read at ' + hhmm(s.source.at) + '.' : 'Editing the file you chose.') : s.source.kind === 'live' ? 'Editing the live page version from ' + hhmm(s.source.at) + '. Its code has no indentation. That is how HubSpot serves it, and it works the same.' : 'Editing the code you pasted from HubSpot.') + ' <button class="btn sm" id="reload">Start again</button></div>';
    if (s.flash) { h += '<div class="msg ok" style="margin:-8px 0 16px">' + esc(s.flash) + '</div>'; s.flash = null; }
    if (m.linksHosted != null) h += renderLinkCard(m, s);
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
    if (page.hosted) { S.live[page.key] = { status: 'none' }; return; } // hosted file: loaded straight from the site (renderHosted)
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
  /* ---------- hosted .js file (D11): read straight from moneyhero.com.hk (the file allows any origin) ---------- */
  function hostedName(m) { return m.hosted.url.split('/').pop(); }
  function renderHosted(m) {
    var s = st(), h = '<div class="card"><h2>Load the live file</h2><p>Reads <b>' + esc(hostedName(m)) + '</b> as it is on moneyhero.com.hk right now.</p>';
    h += '<p class="muted">If someone replaced the file in HubSpot in the last few minutes, the site may still serve the old copy for a short while. Then use the file from HubSpot Files below.</p>';
    if (s.hostedErr) h += '<div class="msg warn">' + esc(s.hostedErr) + '</div>';
    return h + '<div class="row"><button class="btn primary" id="loadHosted">Load live version</button></div></div>';
  }
  function loadHosted(m, s) {
    s.hostedErr = '';
    fetch(m.hosted.url + '?nc=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) { load(s, m, text, false); if (s.loaded) s.source = { kind: 'live', at: new Date().toISOString() }; all(); })
      .catch(function (e) { s.hostedErr = 'Could not read the live file (' + e.message + '). Download it from HubSpot Files and choose it below.'; all(); });
  }
  // the page's custom-HTML module, with the script link pointed at the new file (?v= = first 8 of its SHA-256)
  function moduleOut(url, html, v) {
    var re = new RegExp('(' + url.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + ')(\\?v=[^"\']*)?(["\'])', 'g'), name = url.split('/').pop();
    var n = (html.match(re) || []).length;
    if (n !== 1) throw new Error(n ? 'The module links ' + name + ' ' + n + ' times. It should be once.' : 'This module has no <script src="…' + name + '"> line.');
    return html.replace(re, '$1?v=' + v + '$3');
  }
  // module that links a hosted file (D11 custom HTML module): offer to point it at the file edited in this session
  function renderLinkCard(m, s) {
    var hi = m.linksHosted, hm = S.page.modules[hi], h = '<div class="card"><h2>Point it to the new ' + esc(hostedName(hm)) + '</h2>';
    if (!hasChanges(hi)) return h + '<p class="muted">No card changes yet in this session. Edit the cards in module ' + (hi + 1) + ' (' + esc(hm.file) + ') first and replace the file in HubSpot Files. Other changes to this module (e.g. the T&amp;C link) can be made in the code below.</p></div>';
    var err = ''; try { moduleOut(hm.hosted.url, s.code, '00000000'); } catch (e) { err = e.message; }
    if (err) return h + '<div class="msg err">' + esc(err) + ' Check you pasted the D11 custom HTML module.</div></div>';
    if (s.linked) return h + '<div class="msg ok">Done: the module now links ?v=' + esc(s.linked) + ', your new file. Check below, then copy.</div></div>';
    return h + '<p>You changed the cards in module ' + (hi + 1) + '. Press the button so this module loads your new file instead of a cached old one. Do this only after the file is replaced in HubSpot Files.</p><div class="row"><button class="btn primary" id="applyV">Point to the new file</button></div></div>';
  }
  function sha8(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) { return [].slice.call(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 8); });
  }
  function renderLive(m) {
    if (m.hosted) return renderHosted(m);
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
    if (m.hosted) {
      var hp = '<div class="card"><h2>Or use the file from HubSpot</h2><ol class="steps muted"><li>In HubSpot, go to <b>Files</b> › <b>' + esc(m.hosted.folder) + '</b> and download <b>' + esc(hostedName(m)) + '</b>.</li><li>Choose it here, or open it in a text editor, select all, copy and paste its code in the box.</li></ol>';
      hp += '<div class="row"><input type="file" id="pickFile" accept=".js,text/javascript"></div>';
      hp += '<textarea class="code" id="paste" spellcheck="false" placeholder="…or paste the whole file here" style="margin-top:8px">' + esc(s.draft || '') + '</textarea>';
      hp += '<div class="row" style="margin-top:8px"><button class="btn" id="loadBtn">Read this code</button></div>';
      if (s.err) hp += '<div class="msg err">' + esc(s.err) + '</div>';
      return hp + '</div>';
    }
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
    if (m.hosted && text.indexOf(m.fingerprint) < 0) { s.err = 'This file has no card data block (' + m.fingerprint + '). It is either not ' + hostedName(m) + ', or an older version made before the editor could change it. Ask Clara for the current build.'; return; }
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
    if (vv.kind === 'productColumns') return h + excelPanel(s, vv) + renderProductColumns(s, vv);
    if (vv.kind === 'productTags') return h + renderProductTags(s, vv);
    if (vv.kind === 'addPlan') return h + renderAddPlan(m, s, vv);
    if (vv.kind === 'productRates') return h + excelPanel(s, vv) + renderProductRates(s, vv);
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
    return h + '</tbody></table></div></div>';
  }
  /* ---------- VHIS: add a plan from Phillip's Product Details sheet ---------- */
  function slug(t) { return String(t || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function renderAddPlan(m, s, v) {
    var a = s.add || (s.add = { step: 1 }), c = cfg(), onPage = s.doc.records.map(function (r) { return r.data.name; });
    var h = '<div class="card xl"><h2>Add a plan 新增計劃</h2><p class="hint">Everything a VHIS plan needs is built from Phillip\'s "VHIS RP Product Details" Excel, with the same rules as the page\'s build script. Nothing is added until every check below is green and you press <b>Add to the page</b>.</p>';
    h += '<h3>1. Paste the plan from the "Product Details" sheet</h3><p class="hint">Either copy <b>just the plan\'s column</b>, from "Product Card Status" down to "Referral Link", or copy the whole sheet (click the corner above row 1). Paste below.</p><textarea class="code" style="min-height:70px" id="addDetails" placeholder="Paste the whole sheet here…">' + esc(a.detText || '') + '</textarea><div class="row" style="margin-top:6px"><button class="btn primary" id="addRead">Read the sheet</button></div>';
    if (a.err) h += '<div class="msg err">' + esc(a.err) + '</div>';
    if (a.det) {
      if (a.det.single) h += '<div class="msg ok">Read one plan\'s column and lined it up with the Product Details rows.</div>';
      h += '<h3>2. Pick the plan</h3><div class="tablewrap"><table class="changes"><thead><tr><th></th><th>Column</th><th>Provider</th><th>Plan</th><th>Status in the sheet</th></tr></thead><tbody>';
      a.det.plans.forEach(function (p) {
        var there = onPage.some(function (n) { return n === p.name || n.indexOf(p.name + ' - ') === 0; });
        h += '<tr' + (there ? ' class="muted"' : '') + '><td>' + (there ? 'on the page' : '<input type="radio" name="addPick" data-addpick="' + p.col + '"' + (a.col === p.col ? ' checked' : '') + '>') + '</td><td>' + p.letter + '</td><td>' + esc(p.insurer) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.status) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    if (a.det && a.col != null) {
      var providers = {}; s.doc.records.forEach(function (r) { providers[r.data.providerId] = r.data.insurer; });
      h += '<h3>3. Plan details</h3><div class="row" style="align-items:flex-start;gap:16px">' +
        '<div class="field" style="flex:1;min-width:200px"><label>Plan id (used in tracking — tell the data team)</label><input type="text" id="addId" value="' + esc(a.id) + '"><div class="hint">Lower case letters, numbers and - only. Must be new.</div></div>' +
        '<div class="field" style="flex:1;min-width:200px"><label>Provider</label><select id="addProv">' + Object.keys(providers).map(function (k) { return '<option value="' + esc(k) + '"' + (a.providerId === k ? ' selected' : '') + '>' + esc(providers[k]) + ' (' + esc(k) + ')</option>'; }).join('') + '<option value="__new"' + (a.newProvider ? ' selected' : '') + '>New provider…</option></select></div></div>';
      if (a.newProvider) h += '<div class="row" style="align-items:flex-start;gap:16px"><div class="field" style="flex:1;min-width:200px"><label>New provider id</label><input type="text" id="addProvId" value="' + esc(a.providerId) + '"></div><div class="field" style="flex:2;min-width:260px"><label>Logo image link</label><input type="text" id="addLogo" value="' + esc(a.logo) + '"><div class="hint">Suggested from the apply link\'s website, like the other logos. Replace it with a better image if you have one.</div>' + (a.logo ? '<img class="thumb" src="' + esc(a.logo) + '" alt="">' : '') + '</div></div>';
      h += '<div class="row" style="align-items:flex-start;gap:16px"><div class="field" style="flex:1"><label>Ranking position (1 = first)</label><input type="number" min="1" id="addRank" value="' + esc(a.rank) + '"></div><div class="field" style="flex:1"><label>"Viewed" count on the card</label><input type="number" min="0" id="addSocial" value="' + esc(a.social) + '"></div></div>';
      h += '<h3>4. Paste the premium sheets</h3><p class="hint">Same as above: select the whole sheet, copy, paste.</p><label class="hint">"Premium" sheet</label><textarea class="code" style="min-height:60px" id="addPrem" placeholder="Paste the Premium sheet…">' + esc(a.prem || '') + '</textarea><label class="hint">"Discounted Premium" sheet (for the first-year price)</label><textarea class="code" style="min-height:60px" id="addDisc" placeholder="Paste the Discounted Premium sheet…">' + esc(a.disc || '') + '</textarea>';
      h += '<div class="row" style="margin-top:8px"><button class="btn primary" id="addBuild">Build the plan and check it</button></div>';
    }
    if (a.built) h += addChecklist(s, a);
    return h + '</div>';
  }
  function addChecklist(s, a) {
    var b = a.built, h = '<h3>5. Check everything is in place</h3>', ok = function (good, text) { return '<li class="' + (good ? 'okk' : 'bad') + '">' + (good ? '✓ ' : '✗ ') + text + '</li>'; };
    var rows = 0, tiers = b.records[0].deductibleTiers;
    b.records.forEach(function (r) { Object.keys(r.premiums).forEach(function (age) { rows += Object.keys(r.premiums[age]).length; }); });
    var first = b.records[0], ids = b.records.map(function (r) { return r.id; });
    var m09 = a.m09;
    h += '<ul class="checklist">';
    h += ok(!b.problems.length, b.problems.length ? 'Problems: ' + esc(b.problems.join(' · ')) : 'Sheet read without problems');
    h += ok(a.idOk, a.idOk ? 'Plan id' + (ids.length > 1 ? 's' : '') + ': ' + esc(ids.join(', ')) + ' (new, valid)' : esc(a.idMsg));
    h += ok(!!first.url, 'Apply link: ' + esc(first.url || 'missing'));
    h += ok(tiers.length > 0 && rows >= 324 * b.records.length, 'Premiums: ' + rows + ' of ' + 324 * b.records.length + ' age/group rows, ' + tiers.length + ' deductible level' + (tiers.length > 1 ? 's' : '') + ' (' + esc(tiers.map(function (t) { return t.label; }).join(' / ')) + ')');
    h += ok(true, first.discount ? 'First-year price: from the Discounted Premium sheet (' + Object.keys(first.discount.prices).length + ' ages)' : 'First-year price: none' + (first.offer ? '' : ' (no offer)'));
    h += ok(true, 'Offer: ' + (first.offer ? esc([first.offer.text, first.offer.code && 'code ' + first.offer.code, first.offer.end && 'ends ' + first.offer.end].filter(Boolean).join(' · ')) : 'none'));
    h += ok(first.coverage.length > 10, 'Coverage table: ' + first.coverage.length + ' rows (' + first.coverage.filter(function (c) { return c.cmp; }).length + ' in the compare view)');
    h += ok(true, 'Tags: ' + (first.tags.length ? esc(first.tags.join(' · ')) : 'none') + ' · More info: ' + first.moreInfo.length + ' · Documents: ' + first.docs.length + (first.taxCaveat ? ' · tax caveat shown' : ''));
    h += ok(!!a.planTypeOk, 'Plan type: ' + esc(first.planType) + (a.planTypeOk ? ' (the page has an icon and filter for it)' : ' — the page has no icon/filter for this plan type; ask Clara'));
    h += ok(a.m09ready, a.m09ready ? 'Module 09 banner: "viewed" count' + (a.newProvider ? ' and the new provider logo' : '') + ' will be added there too' : 'Module 09 banner is not loaded and there is no live copy — open "09 banner" and load or paste it first');
    h += ok(!a.newProvider || /^https:\/\//.test(a.logo || ''), a.newProvider ? 'Provider logo: ' + esc(a.logo || 'missing') : 'Provider logo: already on the page (' + esc(a.providerId) + ')');
    h += ok(a.rank >= 1, 'Ranking: position ' + a.rank + (ids.length > 1 ? ' and ' + (Number(a.rank) + 1) : ''));
    h += '</ul>';
    b.warnings.forEach(function (w) { h += '<div class="msg warn">' + esc(w) + '</div>'; });
    var ready = addReady(a);
    h += '<div class="row" style="margin-top:8px"><button class="btn primary" id="addGo"' + (ready ? '' : ' disabled') + '>Add to the page</button>' + (ready ? '<span class="hint">Then paste <b>08 product data</b> and <b>09 banner</b> into HubSpot. Both are needed.</span>' : '') + '</div>';
    return h;
  }
  function addBuild(m, s, v) {
    var a = s.add, c = cfg(), det = a.det, p = det.plans.filter(function (x) { return x.col === a.col; })[0];
    var b = X.vhisBuildPlan(det, { col: a.col, id: a.id, providerId: a.providerId, premium: a.prem, discount: a.disc });
    b.records.forEach(function (r) { r.providerId = a.providerId; });
    var ids = b.records.map(function (r) { return r.id; }), have = s.doc.records.map(function (r) { return r.id; });
    a.idOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id || '') && ids.every(function (id) { return have.indexOf(id) < 0; });
    a.idMsg = !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id || '') ? 'Plan id: use lower case letters, numbers and - only' : 'Plan id already on the page: ' + ids.filter(function (id) { return have.indexOf(id) >= 0; }).join(', ');
    // module 09: loaded, or load it from the live copy now
    var i9 = S.page.modules.map(function (x) { return x.file; }).indexOf(v.banner), m9 = S.page.modules[i9], s9 = st(i9);
    if (!s9.loaded) { var le = liveEntry(m9); if (le) { load(s9, m9, le.code, false); if (s9.loaded) s9.source = { kind: 'live', at: S.live[S.page.key].data.fetchedAt }; } }
    a.m09ready = !!s9.loaded;
    var icons = s9.loaded ? (M.readVar(s9.base, 'PLAN_ICON') || {}).data || {} : {};
    a.planTypeOk = !!icons[b.records[0].planType];
    a.built = b;
  }
  function addReady(a) { var b = a.built; if (!b) return false; var first = b.records[0], rows = 0; b.records.forEach(function (r) { Object.keys(r.premiums).forEach(function (age) { rows += Object.keys(r.premiums[age]).length; }); });
    return !b.problems.length && a.idOk && first.url && rows >= 324 * b.records.length && a.planTypeOk && a.m09ready && (!a.newProvider || /^https:\/\//.test(a.logo || '')) && a.rank >= 1; }
  function addGo(m, s, v) {
    // rebuild from what is in the boxes right now, so an edit made after "Build" can never slip through unchecked
    addBuild(m, s, v); if (!addReady(s.add)) return renderRight();
    var a = s.add, c = cfg(), recs = a.built.records.map(function (r) { return JSON.parse(JSON.stringify(r)); });
    var next = E.appendRecords(output(m, s), c, recs);
    s.base = next; s.doc = E.load(next, c); s.fields = {}; s.vedits = {};
    s.added = (s.added || []).concat(recs.map(function (r) { return r.id; }));
    var order = baseOrder(s.doc).filter(function (id) { return !recs.some(function (r) { return r.id === id; }); });
    var pos = Math.max(0, Math.min(order.length, Number(a.rank) - 1));
    order.splice.apply(order, [pos, 0].concat(recs.map(function (r) { return r.id; })));
    s.order = order;
    var i9 = S.page.modules.map(function (x) { return x.file; }).indexOf(v.banner), s9 = st(i9);
    recs.forEach(function (r) { setV(s9, 'SOCIAL_PROOF', r.id, Number(a.social) || 0); });
    if (a.newProvider) setV(s9, 'LOGOS', a.providerId, a.logo);
    s9.copied = false;
    s.flash = 'Added ' + recs.map(function (r) { return r.name; }).join(' and ') + '. Now copy and paste BOTH modules: 08 product data and 09 banner.';
    s.add = null; s.vtab = 'products'; s.copied = false; all();
    var r = $('review'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return h + '</tbody></table></div></div>';
  }
  /* ---------- paste a whole sheet from the RP Product Details Excel ---------- */
  // products the sheet's plan names are matched against: this module's products, or (Life premiums,
  // which live in scripts) the product-data module — loaded, or read from the live copy
  function excelProducts(s, v) {
    var c = cfg(), doc = s.doc, al = (v.excel && v.excel.aliases) || {};
    if (!doc && v.excel && v.excel.products) {
      var i = S.page.modules.map(function (x) { return x.file; }).indexOf(v.excel.products), ps = i >= 0 ? S.mods[S.page.key + ':' + i] : null;
      if (ps && ps.doc) doc = ps.doc;
      else { var le = liveEntry(S.page.modules[i]); if (le) try { doc = E.load(le.code, c); } catch (e) {} }
    }
    if (!doc) return Object.keys(al).map(function (id) { return { id: id, names: [id], aliases: al[id], provider: [] }; });
    return doc.records.map(function (r) {
      var d = r.data, names = [c.productLabel(d)]; if (d.name && typeof d.name === 'object') ['zh', 'en'].forEach(function (L) { if (d.name[L]) names.push(d.name[L]); });
      return { id: r.id, names: names, aliases: al[r.id] || [], provider: [d.insurer || d.iss || '', d.providerId || ''], tiers: d.deductibleTiers ? d.deductibleTiers.length : null };
    });
  }
  function excelPanel(s, v) {
    if (!v.excel) return '';
    var x = s.xl && s.xl.v === v.v ? s.xl : null, h = '<div class="card xl"><h2>Paste the Excel sheet</h2><p class="hint">' + esc(v.excel.how) + '</p>' +
      (v.kind === 'productRates' ? '<p class="hint"><b>Copied just the numbers?</b> Click the cell in the table below where the first number goes and paste there (Cmd+V). A whole column from the sheet fills all four groups.</p>' : '');
    var boxes = v.excel.two ? [{ which: 'premium', label: '1. "Premium" sheet' }, { which: 'discount', label: '2. "Discounted Premium" sheet' }] : [{ which: 'premium', label: '' }];
    boxes.forEach(function (b) {
      h += (b.label ? '<h3>' + esc(b.label) + '</h3>' : '') + '<textarea class="code" style="min-height:70px" data-xltext="' + b.which + '" placeholder="Paste the whole sheet here…"></textarea>' +
        '<div class="row" style="margin-top:6px"><button class="btn primary" data-xlread="' + b.which + '">Read the sheet</button></div>';
    });
    if (x && x.error) h += '<div class="msg err">' + esc(x.error) + '</div>';
    if (x && x.res) h += excelPreview(x);
    return h + '</div>';
  }
  function excelPreview(x) {
    var r = x.res, h = '<div class="xlprev"><h3>What the sheet will change</h3>';
    h += '<table class="changes"><thead><tr><th>In the Excel</th><th>Matched to</th><th></th></tr></thead><tbody>' + r.matches.map(function (m) {
      return '<tr><td>' + esc(m.excel) + '</td><td>' + esc(m.label) + '</td><td>' + (/close/.test(m.how) ? '<span class="moved">check: ' + esc(m.how) + '</span>' : '<span class="muted">' + esc(m.how) + '</span>') + '</td></tr>';
    }).join('') + '</tbody></table>';
    if (r.unmatched.length) h += '<div class="msg warn">Not on this page, so skipped: ' + esc(r.unmatched.join(' · ')) + '</div>';
    r.notes.concat(x.notes).forEach(function (n) { h += '<div class="msg warn">' + esc(n) + '</div>'; });
    if (!x.changes.length) h += '<div class="msg ok">Everything in this sheet already matches the page (' + x.same + ' values checked). Nothing to change.</div>';
    else {
      h += '<p><b>' + x.changes.length + '</b> value' + (x.changes.length > 1 ? 's' : '') + ' will change, ' + x.same + ' already match.</p>';
      h += '<div class="tablewrap" style="max-height:260px;overflow:auto"><table class="changes"><thead><tr><th>Product</th><th>What</th><th>Now</th><th>From the sheet</th></tr></thead><tbody>' +
        x.changes.slice(0, 300).map(function (c) { return '<tr><td>' + esc(c.product) + '</td><td>' + esc(c.what) + '</td><td>' + esc(c.now) + '</td><td>' + esc(c.next) + '</td></tr>'; }).join('') +
        (x.changes.length > 300 ? '<tr><td colspan="4" class="muted">…and ' + (x.changes.length - 300) + ' more</td></tr>' : '') + '</tbody></table></div>';
      h += '<div class="row" style="margin-top:8px"><button class="btn primary" id="xlApply">Apply ' + x.changes.length + ' change' + (x.changes.length > 1 ? 's' : '') + '</button><button class="btn" id="xlCancel">Cancel</button></div>';
    }
    return h + '</div>';
  }
  function excelRead(s, v, which) {
    var text = (document.querySelector('[data-xltext="' + which + '"]') || {}).value || '';
    var prods = excelProducts(s, v), byId = {}; prods.forEach(function (p) { byId[p.id] = p; });
    var current = function (e) {
      if (e.kind === 'var') { var k = e.v + '|' + e.path; if (s.vedits[k]) return s.vedits[k].value; return get(M.readVar(s.base, e.v).data, e.path); }
      return cur(s, e.id, e.path);
    };
    var res = X.importSheet(text, prods, { v: v.v, sumInsured: v.excel.sumInsured, expect: v.excel.expect, which: which, numbersIntoTable: v.kind === 'productRates',
      premiumOf: function (id, a, k) { return cur(s, id, v.path + '.' + a + '.' + k); } });
    if (res.error) { s.xl = { v: v.v, error: res.error }; return; }
    var empty = function (x) { return x === null || x === '' || x === undefined; };
    var changes = [], same = 0, notOnPage = 0, cantHide = 0;
    res.edits.forEach(function (e) {
      var now = current(e);
      if (e.hide) { if (now !== undefined) cantHide++; return; }
      if (now === undefined) { notOnPage++; return; }
      if (JSON.stringify(now) === JSON.stringify(e.value) || (empty(now) && empty(e.value))) { same++; return; }
      var pid = e.kind === 'var' ? e.path.split('.')[0] : e.id, rest = e.kind === 'var' ? e.path.split('.').slice(1).join(' · ') : e.path.replace(/^premiums\./, 'premium · ').replace(/^discount\.prices\./, 'first year · ').replace(/\./g, ' · ');
      changes.push({ e: e, product: (byId[pid] && byId[pid].names[0]) || pid, what: rest, now: shortVal(now), next: shortVal(e.value) });
    });
    var notes = [];
    if (notOnPage) notes.push(notOnPage + ' value' + (notOnPage > 1 ? 's are' : ' is') + ' for an age or group this page does not show — skipped.');
    if (cantHide) notes.push(cantHide + ' cell' + (cantHide > 1 ? 's say' : ' says') + ' "DO NOT SHOW PRODUCT" but the page shows a price there now. Not changed — remove those in "Edit code directly" if needed.');
    s.xl = { v: v.v, res: res, changes: changes, same: same, notes: notes };
  }
  function shortVal(v) { if (v == null || v === '') return '(empty)'; if (Array.isArray(v)) return v.map(function (x) { return x == null ? '–' : x; }).join(' / '); if (typeof v === 'object') return v.n || JSON.stringify(v); return String(v); }
  function excelApply(s) {
    s.xl.changes.forEach(function (c) { var e = c.e; if (e.kind === 'var') setV(s, e.v, e.path, e.value); else setP(s, e.id, e.path, e.value); });
    var n = s.xl.changes.length; s.xl = null; s.copied = false; all();
    var r = $('review'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return n;
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
    var h = (v.excel ? excelPanel(s, v) : '') + '<div class="card">', data = M.readVar(s.base, v.v).data;
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
    } else if (v.kind === 'map') {
      if (v.hint) h += '<p class="hint">' + esc(v.hint) + '</p>';
      Object.keys(data).forEach(function (key) {
        var val = vcur(s, v.v, key, data), o = data[key], ch = JSON.stringify(val) !== JSON.stringify(o);
        h += '<div class="field' + (ch ? ' changed' : '') + '"><label>' + esc(key) + '</label><input type="' + (v.number ? 'number' : 'text') + '" data-v="' + v.v + '" data-p="' + esc(key) + '"' + (v.number ? ' data-num="1" min="0"' : '') + ' value="' + esc(val) + '">' + (ch ? '<div class="was">Was: ' + esc(o) + '</div>' : '') + '</div>';
      });
      Object.keys(s.vedits).forEach(function (k) { var e = s.vedits[k]; if (e.v === v.v && !(e.path in data)) h += '<div class="field changed"><label>' + esc(e.path) + ' <span class="edited">new</span></label><div class="locked">' + esc(e.value) + '</div></div>'; });
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
      h += '</tbody></table></div>';
    } else if (v.kind === 'grid') {
      var rows = Object.keys(data), gcols = Object.keys(data[rows[0]]);
      h += '<div class="tablewrap"><table class="rates"><thead><tr><th>Age</th>' + gcols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r) { h += '<tr><th>' + esc(r) + '</th>' + gcols.map(function (c) { var path = r + '.' + c, val = vcur(s, v.v, path, data); return '<td class="' + (val !== data[r][c] ? 'changed' : '') + '"><input type="number" step="any" data-grid="' + esc(path) + '" value="' + esc(val) + '"></td>'; }).join('') + '</tr>'; });
      h += '</tbody></table></div>';
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
    if (m.hosted) h += '<h3>Put it live</h3><ol class="steps"><li>Press <b>Download ' + esc(hostedName(m)) + '</b> below. (Or press <b>Copy new code</b> and paste it over the whole file in a text editor, saved as ' + esc(hostedName(m)) + '.)</li><li>In HubSpot, go to <b>Files</b> › <b>' + esc(m.hosted.folder) + '</b>, open <b>' + esc(hostedName(m)) + '</b> and use <b>Replace</b> with the new file. Keep the same file name.</li><li>Open module <b>' + (S.page.modules.map(function (x) { return x.linksHosted; }).indexOf(S.modIdx) + 1) + ' (custom HTML module)</b> on the left. Paste the module from HubSpot, press <b>Point to the new file</b>, copy the new code and paste it over the module in HubSpot. Without this, visitors may keep the old cached file.</li><li>Press <b>Preview</b>. Check every row in the table above, on desktop and on phone, and open a 獎賞詳情 pop-up.</li><li>If it all looks right, <b>Publish</b>. Post the change summary in the request thread.</li></ol>';
    else h += '<h3>Paste it back into HubSpot</h3><ol class="steps"><li>Press <b>Copy new code</b> below.</li><li>In HubSpot, open the module whose code starts with <code>' + esc(m.find) + '</code>, select all of its code and paste over it. Paste only into this module.</li><li>Press <b>Preview</b>. Check every row in the table above, on desktop and on phone.</li><li>If it all looks right, <b>Publish</b>. If not, close without publishing. Nothing changes live until you publish.</li><li>Post the change summary in the request thread.</li></ol>';
    if (others.length) h += '<div class="msg warn">You also changed module' + (others.length > 1 ? 's ' : ' ') + others.map(function (i) { return (i + 1) + ' (' + S.page.modules[i].file + ')'; }).join(', ') + '. Paste those too before you publish.</div>';
    renderCopybar(m, s, R);
    return h + '</div>';
  }
  function renderCopybar(m, s, R) {
    var bar = $('copybar'); bar.hidden = false;
    var n = R.changes.length, ok = n && R.res.ok;
    var status = !R.res.ok ? 'Fix ' + R.res.errors.length + ' problem' + (R.res.errors.length > 1 ? 's' : '') + ' before copying' : !n ? 'No changes yet' : R.res.ok ? n + ' change' + (n > 1 ? 's' : '') + ' ready' + (R.res.warnings.length ? ' — read the ' + R.res.warnings.length + ' warning' + (R.res.warnings.length > 1 ? 's' : '') + ' first' : '') : 'Fix ' + R.res.errors.length + ' problem' + (R.res.errors.length > 1 ? 's' : '') + ' before copying';
    var html = '<span class="status">' + esc(status) + '</span><button class="btn" id="copySummary"' + (ok ? '' : ' disabled') + '>Copy change summary</button>' + (m.hosted
      ? '<button class="btn" id="copyCode"' + (ok ? '' : ' disabled') + '>Copy new code</button><button class="btn primary" id="downloadFile"' + (ok ? '' : ' disabled') + '>' + (s.copied ? 'Downloaded' : 'Download ' + esc(hostedName(m))) + '</button>'
      : '<button class="btn primary" id="copyCode"' + (ok ? '' : ' disabled') + '>' + (s.copied ? 'Copied — now paste into HubSpot' : 'Copy new code') + '</button>');
    // Only rebuild when something visible changed. Leaving a field re-renders the page; if the buttons were
    // rebuilt every time, a click on Copy made straight after typing would land on a removed button and be lost.
    if (bar.dataset.h !== html) { bar.innerHTML = html; bar.dataset.h = html; }
    if (m.hosted) {
      $('downloadFile').onclick = function () {
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([R.out], { type: 'text/javascript' })); a.download = hostedName(m);
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        s.copied = true; renderCopybar(m, s, R);
      };
      $('copyCode').onclick = function () { copy(R.out, function () { $('copyCode').textContent = 'Code copied'; }); };
    } else $('copyCode').onclick = function () { copy(R.out, function () { s.copied = true; renderCopybar(m, s, R); }); };
    $('copySummary').onclick = function () {
      var txt = S.page.label + ' — ' + m.file + ' module updated\n' + R.changes.map(function (c) { return '• ' + c.product + ' — ' + c.field + ':\n  ' + String(c.before).replace(/\n/g, '\n  ') + '\n  → ' + String(c.after).replace(/\n/g, '\n  '); }).join('\n');
      copy(txt, function () { $('copySummary').textContent = 'Summary copied'; });
    };
  }
  function copy(text, done) {
    function fallback() { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  /* ---------- paste numbers straight into a table, like a spreadsheet ---------- */
  // Click the cell where the first number goes and paste: values fill down (and right, for several columns).
  // VHIS: a column from Phillip's sheet runs through all four groups; values past age 80 continue into the
  // next group in the sheet's order.
  function pasteBlock(start, text) {
    var s = st(), m = mod(), v = (m.vars || []).filter(function (x) { return x.v === s.vtab; })[0] || {};
    var rows = X.parseTSV(text).map(function (r) { return r; });
    while (rows.length && rows[0].every(function (c) { return c === '' || isNaN(X.num(c)); })) rows.shift(); // copied a header too
    var tr = start.closest('tr'), trs = [].slice.call(tr.parentNode.children), r0 = trs.indexOf(tr);
    // VHIS tables alternate standard / first-year columns, but Phillip keeps them on separate sheets:
    // several copied columns follow the kind of column you started in (all standard, or all first-year)
    var kind = start.dataset.tpath ? start.dataset.tpath.split('.')[0] : null;
    var inputsOf = function (row) { return [].slice.call(row.querySelectorAll('input[type=number]:not(:disabled)')).filter(function (x) { return !kind || (x.dataset.tpath || '').split('.')[0] === kind; }); };
    var c0 = inputsOf(tr).indexOf(start), filled = 0, skipped = 0, over = [];
    var val = function (c) { var n = X.num(c); if (n === null || isNaN(n)) return n; return v.round != null ? X.roundEven(n, v.round) : n; };
    S.batch = true;
    rows.forEach(function (cells, i) {
      var row = trs[r0 + i]; if (!row) { over.push({ i: i, cells: cells }); return; }
      var ins = inputsOf(row);
      cells.forEach(function (c, j) { var inp = ins[c0 + j], n = val(c); if (!inp) { skipped++; return; } if (n === null) return; if (isNaN(n)) { skipped++; return; } inp.value = n; inp.dispatchEvent(new Event('input', { bubbles: true })); filled++; });
    });
    var groupsDone = [s.vg];
    if (over.length && v.kind === 'productRates' && v.groupOrder) {
      var d = curData(s, s.vp), ages = Object.keys(get(d, v.path) || {}), g0 = v.groupOrder.indexOf(s.vg), hasDisc = !!get(d, v.discPath), slots = [];
      (get(d, v.tiersPath) || []).forEach(function (t, k) { slots.push({ p: kind === v.discPath.split('.')[0] ? v.discPath : v.path, k: k }); });
      over.forEach(function (o) {
        var abs = r0 + o.i, g = v.groupOrder[g0 + Math.floor(abs / ages.length)], age = ages[abs % ages.length];
        if (!g) { skipped += o.cells.length; return; }
        if (groupsDone.indexOf(g) < 0) groupsDone.push(g);
        o.cells.forEach(function (c, j) {
          var sl = slots[c0 + j], n = val(c); if (!sl) { skipped++; return; } if (n === null) return; if (isNaN(n)) { skipped++; return; }
          var path = sl.p + '.' + age + '.' + g, arr = (cur(s, s.vp, path) || []).slice(); arr[sl.k] = n; setP(s, s.vp, path, arr); filled++;
        });
      });
    } else skipped += over.reduce(function (a, o) { return a + o.cells.length; }, 0);
    S.batch = false;
    s.flash = 'Filled ' + filled + ' cell' + (filled === 1 ? '' : 's') + (groupsDone.length > 1 ? ' across ' + groupsDone.join(', ') : '') + '.' +
      (skipped ? ' ' + skipped + ' value' + (skipped === 1 ? ' was' : 's were') + ' left out (past the end of the table, or not a number).' : '') + ' Check the change list before copying.';
    all();
  }
  document.addEventListener('paste', function (e) {
    var t = e.target; if (!t.matches || !t.matches('table.rates input[type=number]')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(String(text).trim())) return; // one value: normal paste
    e.preventDefault();
    if (t.dataset.ppath) { st().flash = 'Pasting several values here is turned off: this table lists products in the page order, which is different from the Excel. Paste the whole sheet in the box above instead.'; return all(); }
    // Life / CI: Phillip's rows run age → gender → smoker, but this table has one row per age and one
    // column per gender/smoker, so a copied column would put e.g. female prices into male columns.
    if (t.dataset.rate) { st().flash = 'Pasting a column here is turned off: in Phillip\'s sheet each row is one age + gender + smoker, which does not line up with this table. Paste the whole sheet in the box above instead. The tool reads Product, Age, Gender and Smoking from every row.'; return all(); }
    pasteBlock(t, text);
  });

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
    if (t.id === 'applyV') { var hm = S.page.modules[m.linksHosted]; sha8(output(hm, st(m.linksHosted))).then(function (v) { s.code = moduleOut(hm.hosted.url, s.code, v); s.linked = v; s.copied = false; all(); }); return; }
    if (t.id === 'loadHosted') { t.disabled = true; t.textContent = 'Loading…'; loadHosted(m, s); return; }
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
    if (t.dataset.xlread) { var xv = (m.vars || []).filter(function (x) { return x.v === s.vtab; })[0]; excelRead(s, xv, t.dataset.xlread); var keep = {}; document.querySelectorAll('[data-xltext]').forEach(function (ta) { keep[ta.dataset.xltext] = ta.value; }); renderRight(); document.querySelectorAll('[data-xltext]').forEach(function (ta) { ta.value = keep[ta.dataset.xltext] || ''; }); var pv = document.querySelector('.xlprev'); if (pv) pv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (t.id === 'xlApply') { excelApply(s); return; }
    if (t.id === 'addRead') {
      var A = s.add || (s.add = {}); A.detText = $('addDetails').value; A.err = null; A.det = null; A.col = null; A.built = null;
      var det = X.vhisDetails(A.detText); if (det.error) A.err = det.error; else A.det = det; return renderRight();
    }
    if (t.id === 'addBuild') { addBuild(m, s, (m.vars || []).filter(function (x) { return x.v === '@add'; })[0]); return renderRight(); }
    if (t.id === 'addGo') { addGo(m, s, (m.vars || []).filter(function (x) { return x.v === '@add'; })[0]); return; }
    if (t.id === 'xlCancel') { s.xl = null; return renderRight(); }
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
    if (t.id === 'codeBox') { s.code = t.value; s.linked = null; s.copied = false; return soft(); }
    if (s.add && ({ addId: 'id', addProvId: 'providerId', addLogo: 'logo', addRank: 'rank', addSocial: 'social', addPrem: 'prem', addDisc: 'disc', addDetails: 'detText' })[t.id]) { s.add[({ addId: 'id', addProvId: 'providerId', addLogo: 'logo', addRank: 'rank', addSocial: 'social', addPrem: 'prem', addDisc: 'disc', addDetails: 'detText' })[t.id]] = t.value; return; }
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
    if (t.dataset.v) { setV(s, t.dataset.v, t.dataset.p, t.dataset.num ? (t.value === '' ? NaN : Number(t.value)) : t.value); return soft(); }
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
    if (t.dataset.addpick != null) {
      var A = s.add, p = A.det.plans.filter(function (x) { return x.col === +t.dataset.addpick; })[0];
      A.col = p.col; A.built = null;
      var known = s.doc.records.filter(function (r) { return r.data.insurer === p.insurer || slug(r.data.insurer).split('-')[0] === slug(p.insurer).split('-')[0]; })[0];
      A.newProvider = !known; A.providerId = known ? known.data.providerId : slug(p.insurer).split('-')[0] || 'provider';
      var latin = slug(p.name.replace(new RegExp('^' + (p.insurer || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ''));
      A.id = A.providerId + '-' + (latin || 'plan-' + p.letter.toLowerCase());
      var url = X.cleanText(A.det.cell(A.det.R.link, p.col)) || '', host = (/^https?:\/\/([^\/]+)/.exec(url) || [])[1] || '';
      A.logo = host ? 'https://www.google.com/s2/favicons?domain=' + host.replace(/^www\./, '') + '&sz=128' : '';
      A.rank = s.doc.records.length + 1; A.social = 5;
      return renderRight();
    }
    if (t.id === 'addProv') { var A2 = s.add; A2.newProvider = t.value === '__new'; if (!A2.newProvider) A2.providerId = t.value; A2.built = null; return renderRight(); }
    if (t.id === 'rp') { s.rp = t.value; return renderRight(); }
    if (t.id === 'vp') { s.vp = t.value; return renderRight(); }
    if (t.id === 'vg') { s.vg = t.value; return renderRight(); }
    if (t.dataset.toggle) { setP(s, s.sel, t.dataset.toggle, t.checked); return all(); }
    // fields that decide where a product shows (e.g. OSI badge) re-sort the ranking once you leave the field
    if (t.dataset.path && cfg().displayOrder) return all();
    if (t.dataset.ptag != null && t.tagName === 'SELECT') { var pc = cur(s, t.dataset.pid, 'tags').map(function (x) { return Object.assign({}, x); }); pc[+t.dataset.ptag].c = t.value; setP(s, t.dataset.pid, 'tags', pc); return soft(); }
    if (t.dataset.ppath === 'badge') return all();
    if (t.id === 'allowHooks') { s.allowHookRemoval = t.checked; return soft(); }
    if (t.id === 'pickFile' && t.files[0]) { var fm = mod(); t.files[0].text().then(function (text) { load(s, fm, text, false); if (s.loaded) s.source = { kind: 'paste' }; all(); }); return; }
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
