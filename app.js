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
    if (!s.loaded) { h += renderLive(m) + renderPaste(m, s); $('right').innerHTML = h; return; }
    if (s.source) h += '<div class="msg ' + (s.source.kind === 'live' ? 'ok' : 'ok') + '" style="margin:-8px 0 16px">' + (s.source.kind === 'live' ? 'Editing the live page version from ' + hhmm(s.source.at) + '. Its code has no indentation. That is how HubSpot serves it, and it works the same.' : 'Editing the code you pasted from HubSpot.') + ' <button class="btn sm" id="reload">Start again</button></div>';
    if (s.mode === 'code') h += renderCode(m, s);
    else if (m.editor === 'products') h += renderProducts(s);
    else if (m.editor === 'content' || m.editor === 'banner') h += renderContent(m, s);
    else if (m.editor === 'scripts') h += renderScripts(m, s);
    h += renderReview(m, s);
    $('right').innerHTML = h;
    if (m.editor === 'products' && s.mode === 'form') bindRank();
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
  }
  function initForm(m, s, text) {
    if (m.editor === 'products') { s.doc = E.load(text, cfg()); s.order = s.doc.records.map(function (r) { return r.id; }); s.fields = {}; s.sel = null; }
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
  function cur(s, id, path) { var e = s.fields[id]; return e && e.hasOwnProperty(path) ? e[path] : get(rec(s, id).data, path); }
  function isEdited(s, id) { var e = s.fields[id] || {}; return Object.keys(e).some(function (p) { return JSON.stringify(e[p]) !== JSON.stringify(get(rec(s, id).data, p)); }); }
  function renderProducts(s) {
    var c = cfg(), h = '', orig = s.doc.records.map(function (r) { return r.id; });
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><h2>Ranking</h2><div class="muted">Drag a product, or use the arrows. #1 shows first on the page.</div></div>' + (s.order.join() !== orig.join() ? '<button class="btn sm" id="resetOrder">Undo ranking changes</button>' : '') + '</div>';
    h += '<ol class="rank-list" id="rankList">';
    s.order.forEach(function (id, n) {
      var d = rec(s, id).data, op = orig.indexOf(id), code = cur(s, id, 'exclusive.code');
      h += '<li class="rank-item' + (s.sel === id ? ' selected' : '') + '" draggable="true" data-id="' + esc(id) + '">' +
        '<div class="rank-pos">' + (n + 1) + '</div><img class="rank-logo" src="' + esc(c.logo(d)) + '" alt="">' +
        '<div><div class="rank-name">' + esc(cur(s, id, 'name.zh') || id) + (op !== n ? '<span class="moved">was #' + (op + 1) + '</span>' : '') + (isEdited(s, id) ? '<span class="edited">edited</span>' : '') + '</div>' +
        '<div class="rank-meta">' + esc(c.productSub(d)) + (code ? ' · code ' + esc(code) : '') + '</div></div>' +
        '<div class="row"><button class="btn sm" data-up="' + n + '" ' + (n === 0 ? 'disabled' : '') + ' aria-label="Move up">↑</button><button class="btn sm" data-down="' + n + '" ' + (n === s.order.length - 1 ? 'disabled' : '') + ' aria-label="Move down">↓</button><button class="btn sm" data-edit="' + esc(id) + '">' + (s.sel === id ? 'Close' : 'Edit') + '</button></div></li>';
      if (s.sel === id) h += '<li>' + renderProductForm(s, id) + '</li>';
    });
    return h + '</ol><p class="muted" style="margin-top:8px">Premiums are in the scripts module › Premium table. Other product details (coverage, pros/cons, documents) → "Edit code directly".</p></div>';
  }
  function renderProductForm(s, id) {
    var c = cfg(), h = '<div class="card" style="margin:0 0 10px">', lastGroup = '';
    c.fields.forEach(function (f) {
      var orig = get(rec(s, id).data, f.path); if (orig === undefined && f.path.indexOf('exclusive') === 0 && !rec(s, id).data.exclusive) return;
      if (f.group !== lastGroup) { h += '<h3>' + esc(f.group) + '</h3>'; lastGroup = f.group; }
      var val = cur(s, id, f.path), changed = JSON.stringify(val) !== JSON.stringify(orig);
      h += '<div class="field' + (changed ? ' changed' : '') + '"><label>' + esc(f.label) + '</label>';
      if (f.type === 'tags') {
        (val || []).forEach(function (t, k) {
          h += '<div class="tagrow"><input type="text" data-tag="' + k + '" data-k="zh" value="' + esc(t.zh) + '" placeholder="中文"><input type="text" data-tag="' + k + '" data-k="en" value="' + esc(t.en) + '" placeholder="English"><select data-tag="' + k + '" data-k="c">' + f.colours.map(function (o) { return '<option value="' + o.value + '"' + (o.value === t.c ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') + '</select><button class="btn sm" data-tagdel="' + k + '">Remove</button></div>';
        });
        h += '<button class="btn sm" id="tagAdd">Add tag</button>';
      } else if (f.type === 'textarea') h += '<textarea data-path="' + f.path + '">' + esc(val) + '</textarea>';
      else h += '<input type="text" data-path="' + f.path + '" value="' + esc(val) + '">';
      if (f.pattern && typeof val === 'string' && !new RegExp(f.pattern).test(val)) h += '<div class="bad">' + esc(f.patternMsg) + '</div>';
      if (f.hint) h += '<div class="hint">' + esc(f.hint) + '</div>';
      if (changed && f.type !== 'tags') h += '<div class="was">Was: ' + esc(orig) + '</div>';
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

  /* ---------- scripts (page text + premium tables) ---------- */
  function vcur(s, v, path, data) { var k = v + '|' + path; return s.vedits.hasOwnProperty(k) ? s.vedits[k].value : get(data, path); }
  function renderScripts(m, s) {
    var h = '<div class="card"><div class="seg wide">' + m.vars.map(function (v) { return '<button class="' + (s.vtab === v.v ? 'on' : '') + '" data-vtab="' + v.v + '">' + esc(v.title) + '</button>'; }).join('') + '</div>';
    var v = m.vars.filter(function (x) { return x.v === s.vtab; })[0], data = M.readVar(s.base, v.v).data;
    if (v.kind === 'text') {
      var root = data[v.root] || {}, q = (s.q || '').toLowerCase();
      h += '<input type="search" class="search" id="q" placeholder="Search page text (e.g. FAQ, hero, 免費)…" value="' + esc(s.q) + '">';
      h += '<p class="hint">You can use &lt;br&gt; for a line break and &lt;b&gt;…&lt;/b&gt; for bold.</p>';
      Object.keys(root).forEach(function (key) {
        var path = v.root + '.' + key, val = vcur(s, v.v, path, data), o = root[key];
        if (typeof o !== 'string') return;
        if (q && (key + ' ' + val).toLowerCase().indexOf(q) < 0) return;
        var changed = val !== o;
        h += '<div class="field' + (changed ? ' changed' : '') + '"><label>' + esc(key) + '</label>' + (o.length > 60 ? '<textarea data-v="' + v.v + '" data-p="' + esc(path) + '">' + esc(val) + '</textarea>' : '<input type="text" data-v="' + v.v + '" data-p="' + esc(path) + '" value="' + esc(val) + '">') + (changed ? '<div class="was">Was: ' + esc(o) + '</div>' : '') + '</div>';
      });
    } else if (v.kind === 'rates') {
      var pids = Object.keys(data); s.rp = s.rp && data[s.rp] ? s.rp : pids[0];
      h += '<div class="field"><label>Product</label><select id="rp">' + pids.map(function (p) { return '<option' + (p === s.rp ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></div>';
      var ages = Object.keys(data[s.rp]), cols = Object.keys(data[s.rp][ages[0]]);
      h += '<p class="hint">Annual premium in HK$. Left = original, right = after discount. Tick N/A if the plan is not offered.</p><div class="tablewrap"><table class="rates"><thead><tr><th>Age</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      ages.forEach(function (a) {
        h += '<tr><th>' + esc(a) + '</th>';
        cols.forEach(function (c) {
          var path = s.rp + '.' + a + '.' + c, val = vcur(s, v.v, path, data), o = get(data, path), na = val === 'NA', ch = JSON.stringify(val) !== JSON.stringify(o);
          h += '<td class="' + (ch ? 'changed' : '') + '"><div class="pair"><input type="number" min="0" data-rate="' + esc(path) + '" data-i="0" value="' + (na ? '' : esc(val[0])) + '"' + (na ? ' disabled' : '') + '><input type="number" min="0" data-rate="' + esc(path) + '" data-i="1" value="' + (na ? '' : esc(val[1])) + '"' + (na ? ' disabled' : '') + '></div><label class="na"><input type="checkbox" data-na="' + esc(path) + '"' + (na ? ' checked' : '') + '> N/A</label></td>';
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
    if (R.out) { var d = E.lineDiff(s.original, R.out); h += '<details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Show code changes (' + d.length + ' lines)</summary><div class="diff">' + d.slice(0, 600).map(function (o) { return '<div class="' + (o.t === '+' ? 'add' : 'del') + '">' + o.t + ' ' + esc(o.s) + '</div>'; }).join('') + '</div></details>'; }
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
    bar.innerHTML = '<span class="status">' + esc(status) + '</span><button class="btn" id="copySummary"' + (ok ? '' : ' disabled') + '>Copy change summary</button><button class="btn primary" id="copyCode"' + (ok ? '' : ' disabled') + '>' + (s.copied ? 'Copied — now paste into HubSpot' : 'Copy new code') + '</button>';
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
  function soft() { // refresh review + module badges without rebuilding the form (keeps typing focus)
    var old = $('review'); if (!old) return renderRight();
    var tmp = document.createElement('div'); tmp.innerHTML = renderReview(mod(), st()); old.replaceWith(tmp.firstChild); renderLeft();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, .mod.editable'); if (!t) return;
    var s = S.modIdx != null ? st() : null, m = S.modIdx != null ? mod() : null;
    if (t.classList.contains('tab')) { S.page = PAGES.filter(function (p) { return p.key === t.dataset.key; })[0]; S.modIdx = null; return all(); }
    if (t.dataset.mod != null) { S.modIdx = +t.dataset.mod; return all(); }
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
    if (t.id === 'resetOrder') { s.order = s.doc.records.map(function (r) { return r.id; }); s.copied = false; return all(); }
    if (t.dataset.up != null) return move(s, +t.dataset.up, +t.dataset.up - 1);
    if (t.dataset.down != null) return move(s, +t.dataset.down, +t.dataset.down + 1);
    if (t.dataset.edit) { s.sel = s.sel === t.dataset.edit ? null : t.dataset.edit; return renderRight(); }
    if (t.dataset.undo) { delete s.fields[t.dataset.undo]; s.copied = false; return all(); }
    if (t.id === 'tagAdd') { var tg = (cur(s, s.sel, 'tags') || []).slice(); tg.push({ zh: '', en: '', c: 't-blue' }); setP(s, s.sel, 'tags', tg); return all(); }
    if (t.dataset.tagdel != null) { var tg2 = cur(s, s.sel, 'tags').slice(); tg2.splice(+t.dataset.tagdel, 1); setP(s, s.sel, 'tags', tg2); return all(); }
  });
  function setP(s, id, path, v) { s.fields[id] = s.fields[id] || {}; s.fields[id][path] = v; s.copied = false; }
  function setV(s, v, path, value) { s.vedits[v + '|' + path] = { v: v, path: path, value: value }; s.copied = false; }
  document.addEventListener('input', function (e) {
    var t = e.target; if (S.modIdx == null) return; var s = st(), m = mod();
    if (t.id === 'q') { s.q = t.value; var pos = t.selectionStart; renderRight(); var q = $('q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (t.id === 'codeBox') { s.code = t.value; s.copied = false; return soft(); }
    if (t.dataset.f != null) { s.edits[t.dataset.f] = t.value; s.copied = false; t.closest('.field').classList.toggle('changed', t.value !== s.fields[+t.dataset.f].value); return soft(); }
    if (t.dataset.path) { setP(s, s.sel, t.dataset.path, t.value); return soft(); }
    if (t.dataset.tag != null) { var tg = cur(s, s.sel, 'tags').map(function (x) { return Object.assign({}, x); }); tg[+t.dataset.tag][t.dataset.k] = t.value; setP(s, s.sel, 'tags', tg); return soft(); }
    if (t.dataset.v) { setV(s, t.dataset.v, t.dataset.p, t.value); return soft(); }
    if (t.dataset.rate) {
      var data = M.readVar(s.base, s.vtab).data, val = vcur(s, s.vtab, t.dataset.rate, data); val = Array.isArray(val) ? val.slice() : [0, 0];
      val[+t.dataset.i] = t.value === '' ? NaN : Number(t.value); setV(s, s.vtab, t.dataset.rate, val);
      return soft();
    }
    if (t.dataset.grid) { setV(s, s.vtab, t.dataset.grid, t.value === '' ? NaN : Number(t.value)); return soft(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (S.modIdx == null) return; var s = st();
    if (t.id === 'rp') { s.rp = t.value; return renderRight(); }
    if (t.id === 'allowHooks') { s.allowHookRemoval = t.checked; return soft(); }
    if (t.dataset.na) {
      var data = M.readVar(s.base, s.vtab).data, o = get(data, t.dataset.na);
      setV(s, s.vtab, t.dataset.na, t.checked ? 'NA' : (Array.isArray(o) ? o : [0, 0])); return renderRight();
    }
  });
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('editable')) { e.preventDefault(); e.target.click(); } });
  function move(s, from, to) { if (to < 0 || to >= s.order.length) return; var id = s.order.splice(from, 1)[0]; s.order.splice(to, 0, id); s.copied = false; all(); }
  function bindRank() {
    var s = st(), dragId = null;
    document.querySelectorAll('.rank-item').forEach(function (li) {
      li.addEventListener('dragstart', function (e) { dragId = li.dataset.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      li.addEventListener('dragend', function () { li.classList.remove('dragging'); });
      li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('drop-above'); });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-above'); });
      li.addEventListener('drop', function (e) { e.preventDefault(); li.classList.remove('drop-above'); var from = s.order.indexOf(dragId), to = s.order.indexOf(li.dataset.id); if (from >= 0 && from !== to) move(s, from, to); });
    });
  }
  function all() { fetchLive(S.page); renderTabs(); renderLeft(); renderRight(); if (S.modIdx == null || !st().loaded) $('copybar').hidden = true; }
  all();
})();
