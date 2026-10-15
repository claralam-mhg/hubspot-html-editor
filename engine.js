/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — engine
   Reads a HubSpot custom-HTML module, lets the UI change specific values,
   and writes the module back with every other byte untouched.

   How edits work: the module's data block (e.g. `var P=[ ... ]`) is parsed
   into a tree that remembers where each value sits in the source text.
   An edit replaces only that span. Reordering moves whole product blocks,
   including their START/END comments. Nothing is re-serialised wholesale,
   so comments, spacing and untouched values survive byte-for-byte.

   Runs in the browser (window.PCTEngine) and in Node (module.exports),
   so the same code the PCT team uses is the code the tests run.
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* ===== 1. Literal parser with source ranges =====
     Supports the subset these data modules use: objects, arrays, strings
     ('…' and "…"), numbers, true/false/null, bare identifiers, comments. */
  function parseValueAt(src, pos) {
    var i = pos;
    function err(msg) { throw new Error(msg + ' (at character ' + i + ')'); }
    function skip() {
      for (;;) {
        var c = src[i];
        if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '﻿' || c === ' ') { i++; continue; }
        if (c === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); if (e < 0) err('Unclosed comment'); i = e + 2; continue; }
        if (c === '/' && src[i + 1] === '/') { var n = src.indexOf('\n', i); i = n < 0 ? src.length : n + 1; continue; }
        return;
      }
    }
    function str() {
      var q = src[i], start = i, out = ''; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          var n = src[i + 1];
          var map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
          if (n === 'u') { out += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
          if (n === 'x') { out += String.fromCharCode(parseInt(src.substr(i + 2, 2), 16)); i += 4; continue; }
          if (n === '\n') { i += 2; continue; }
          out += map.hasOwnProperty(n) ? map[n] : n; i += 2; continue;
        }
        if (src[i] === '\n') err('Line break inside a text value — a quote is probably missing');
        out += src[i]; i++;
      }
      if (i >= src.length) err('Text value never closed — a quote is missing');
      i++;
      return { type: 'string', value: out, start: start, end: i, quote: q };
    }
    function ident() {
      var m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
      if (!m) err('Unexpected character "' + src[i] + '"');
      var start = i; i += m[0].length; return { name: m[0], start: start, end: i };
    }
    function value() {
      skip();
      var c = src[i], start = i;
      if (c === '{') {
        i++; var props = [], map = {};
        for (;;) {
          skip();
          if (src[i] === '}') { i++; break; }
          var key, keyStart = i;
          if (src[i] === "'" || src[i] === '"') key = str().value; else if (/[0-9]/.test(src[i])) { key = /^[0-9]+/.exec(src.slice(i))[0]; i += key.length; } else key = ident().name;
          skip(); if (src[i] !== ':') err('Expected ":" after "' + key + '"'); i++;
          var v = value();
          var p = { key: key, keyStart: keyStart, node: v };
          props.push(p); map[key] = v;
          skip();
          if (src[i] === ',') { i++; continue; }
          if (src[i] === '}') { i++; break; }
          err('Expected "," or "}" after "' + key + '" — a comma is probably missing');
        }
        return { type: 'object', props: props, map: map, start: start, end: i };
      }
      if (c === '[') {
        i++; var items = [];
        for (;;) {
          skip();
          if (src[i] === ']') { i++; break; }
          items.push(value());
          skip();
          if (src[i] === ',') { i++; continue; }
          if (src[i] === ']') { i++; break; }
          err('Expected "," or "]" in a list — a comma is probably missing');
        }
        return { type: 'array', items: items, start: start, end: i };
      }
      if (c === "'" || c === '"') return str();
      var num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
      if (num) { i += num[0].length; return { type: 'number', value: Number(num[0]), start: start, end: i }; }
      var id = ident();
      var lit = { 'true': true, 'false': false, 'null': null, 'undefined': undefined };
      if (lit.hasOwnProperty(id.name)) return { type: 'literal', value: lit[id.name], start: start, end: i };
      err('Unexpected word "' + id.name + '"');
    }
    var node = value();
    return node;
  }

  function toJS(node) {
    if (!node) return undefined;
    if (node.type === 'object') { var o = {}; node.props.forEach(function (p) { o[p.key] = toJS(p.node); }); return o; }
    if (node.type === 'array') return node.items.map(toJS);
    return node.value;
  }

  /* Walk a dotted path ("exclusive.expiry.zh", "tags.0.zh") to a node. */
  function nodeAt(node, path) {
    var parts = String(path).split('.');
    for (var k = 0; k < parts.length; k++) {
      if (!node) return null;
      if (node.type === 'object') node = node.map[parts[k]];
      else if (node.type === 'array') node = node.items[Number(parts[k])];
      else return null;
    }
    return node || null;
  }

  /* Serialise a new value in the module's house style (single quotes). */
  function lit(v, quote) {
    if (v === null) return 'null';
    if (typeof v === 'number') { if (!isFinite(v)) throw new Error('A number box is empty or not a number. Fill it in or tick N/A.'); return String(v); }
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') {
      var q = quote || "'";
      return q + v.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n').replace(/\r/g, '') + q;
    }
    if (Array.isArray(v)) return '[' + v.map(function (x) { return lit(x, quote); }).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).map(function (k) { return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k)) + ':' + lit(v[k], quote); }).join(',') + '}';
    throw new Error('Cannot write value of type ' + typeof v);
  }

  /* ===== 2. Load a module ===== */
  function load(html, cfg) {
    var re = new RegExp('\\bvar\\s+' + cfg.arrayVar + '\\s*=\\s*\\[');
    var m = re.exec(html);
    if (!m) throw new Error('This does not look like the ' + cfg.moduleLabel + ' module: no "var ' + cfg.arrayVar + '=[" found. Check you copied the right module from HubSpot.');
    var arrStart = m.index + m[0].length - 1;
    var arr = parseValueAt(html, arrStart);
    var records = arr.items.map(function (node, idx) {
      if (node.type !== 'object') throw new Error('Product #' + (idx + 1) + ' is not a product block');
      return { node: node, data: toJS(node), id: toJS(node.map.id) };
    });
    // Each record's "block" = from just after the previous item's comma (or "[") to just before the next item.
    // That keeps its START/END comments attached when it moves.
    var blocks = [];
    for (var k = 0; k < records.length; k++) {
      // the first block starts on the line after "[" so the newline after "[" stays put when blocks move
      var from = k === 0 ? arrStart + 1 + (/^[ \t]*\r?\n/.exec(html.slice(arrStart + 1)) || [''])[0].length : records[k - 1].sepEnd;
      var node = records[k].node;
      var j = node.end, sepEnd;
      // find the comma that separates this item from the next (skipping comments/space)
      var t = j, comma = -1;
      for (;;) {
        while (/\s/.test(html[t])) t++;
        if (html.substr(t, 2) === '/*') { t = html.indexOf('*/', t) + 2; continue; }
        if (html.substr(t, 2) === '//') { t = html.indexOf('\n', t) + 1; continue; }
        break;
      }
      if (html[t] === ',') comma = t;
      // block ends at end of the trailing END comment line, if any; separator is the comma
      records[k].comma = comma;
      // trailing comments that belong to this item: everything up to the next item's START comment.
      // We cut at the first "START" marker after this item, or at the next item's opening brace.
      var nextStart = k + 1 < records.length ? records[k + 1].node.start : arr.end - 1;
      var seg = html.slice(node.end, nextStart);
      // match within ONE comment — a lazy [^]*? would start at the previous END comment and swallow it
      var startMarker = seg.search(new RegExp('\\/\\*(?:(?!\\*\\/)[^])*' + (cfg.blockStart || 'PRODUCT CARD START')));
      sepEnd = startMarker >= 0 ? node.end + startMarker : nextStart;
      // move sepEnd back to the beginning of its line so indentation travels with the block
      while (sepEnd > node.end && html[sepEnd - 1] !== '\n') sepEnd--;
      records[k].sepEnd = sepEnd;
      blocks.push({ from: from, to: sepEnd });
    }
    var ids = records.map(function (r) { return r.id; });
    var dup = ids.filter(function (x, n) { return ids.indexOf(x) !== n; });
    if (dup.length) throw new Error('Two products share the id "' + dup[0] + '"');
    return { html: html, cfg: cfg, arr: arr, arrStart: arrStart, records: records, blocks: blocks };
  }

  /* ===== 3. Build the new module =====
     changes = { order: [ids…] | null, fields: { id: { path: newValue } } } */
  function build(doc, changes) {
    var html = doc.html, cfg = doc.cfg;
    var fieldEdits = (changes && changes.fields) || {};
    var order = (changes && changes.order) || doc.records.map(function (r) { return r.id; });

    // Validate the order is a permutation — a reorder must never drop or duplicate a product.
    var current = doc.records.map(function (r) { return r.id; });
    if (order.length !== current.length || current.some(function (id) { return order.indexOf(id) < 0; }))
      throw new Error('New ranking must contain exactly the same products');

    // Rank fields follow the order, if this page has them.
    var effective = {};
    order.forEach(function (id, n) {
      effective[id] = Object.assign({}, fieldEdits[id] || {});
      if (cfg.rank) {
        if (cfg.rank.field) effective[id][cfg.rank.field] = n + 1;
        if (cfg.rank.classField) effective[id][cfg.rank.classField] = cfg.rank.classFor(n + 1);
      }
    });

    // 3a. Render each record's block text with its field edits applied.
    function blockText(rec, k, isLastInNewOrder) {
      var b = doc.blocks[k];
      var text = html.slice(b.from, b.to);
      var edits = [];
      var ed = effective[rec.id] || {};
      Object.keys(ed).forEach(function (path) {
        var n = nodeAt(rec.node, path);
        if (!n) {
          var dflt = (cfg.defaults || {})[path];
          if (path.indexOf('.') < 0 && dflt !== undefined) {
            if (JSON.stringify(ed[path]) === JSON.stringify(dflt)) return; // absent already means this value
            // add the field as the record's first property, on its own line
            edits.push({ start: rec.node.start + 1 - b.from, end: rec.node.start + 1 - b.from, text: '\n' + path + ':' + lit(ed[path]) + ',' });
            return;
          }
          throw new Error(rec.id + ': field "' + path + '" not found in this module');
        }
        var before = toJS(n);
        if (JSON.stringify(before) === JSON.stringify(ed[path])) return; // unchanged → leave bytes alone
        edits.push({ start: n.start - b.from, end: n.end - b.from, text: lit(ed[path], n.quote) });
      });
      edits.sort(function (a, c) { return c.start - a.start; });
      edits.forEach(function (e) { text = text.slice(0, e.start) + e.text + text.slice(e.end); });
      // Normalise the separator comma: present on all but the last item.
      var objEndRel = rec.node.end - b.from + edits.reduce(function (s, e) { return e.start < rec.node.end - b.from ? s + e.text.length - (e.end - e.start) : s; }, 0);
      var head = text.slice(0, objEndRel), tail = text.slice(objEndRel);
      var hasComma = /^\s*(?:\/\*[^]*?\*\/\s*|\/\/[^\n]*\n\s*)*,/.test(tail);
      if (hasComma && isLastInNewOrder) tail = tail.replace(/,/, '');
      if (!hasComma && !isLastInNewOrder) tail = ',' + tail;
      return head + tail;
    }
    var byId = {}; doc.records.forEach(function (r, k) { byId[r.id] = k; });
    // The last block runs to the array's closing "]" but may lack a trailing newline; make sure
    // every block ends with a newline before the next one starts, so a moved last block cannot glue
    // onto the following START comment.
    var body = order.map(function (id, n) {
      var t = blockText(doc.records[byId[id]], byId[id], n === order.length - 1);
      if (n < order.length - 1 && !/\n$/.test(t)) t += '\n';
      return t;
    }).join('');
    var lastBlockEnd = doc.blocks[doc.blocks.length - 1].to;
    var out = html.slice(0, doc.blocks[0].from) + body + html.slice(lastBlockEnd);
    // If nothing at all changed, return the input exactly (guards against whitespace normalisation).
    var noOrderChange = order.join() === current.join();
    var noField = order.every(function (id) {
      var r = doc.records[byId[id]], ed = effective[id];
      return Object.keys(ed).every(function (p) { var n = nodeAt(r.node, p); var v = n ? toJS(n) : (cfg.defaults || {})[p]; return (n || v !== undefined) && JSON.stringify(v) === JSON.stringify(ed[p]); });
    });
    if (noOrderChange && noField) return html;
    return out;
  }

  /* ===== 4. Checks — the copy button stays off until all errors clear ===== */
  function check(beforeHtml, afterHtml, cfg) {
    var errors = [], warnings = [];
    // 4a. Every <script> must parse. This is the white-screen guard.
    var scripts = []; var re = /<script[^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(afterHtml))) scripts.push(m[1]);
    if (!scripts.length) errors.push('No <script> block found in the new code.');
    scripts.forEach(function (s, n) {
      try { new Function(s); } catch (e) { errors.push('Script block ' + (n + 1) + ' would not run: ' + e.message + '. Pasting this would blank the product list.'); }
    });
    var before, after;
    try { before = load(beforeHtml, cfg); } catch (e) { errors.push('Original: ' + e.message); }
    try { after = load(afterHtml, cfg); } catch (e) { errors.push('New code: ' + e.message); }
    if (!before || !after) return { errors: errors, warnings: warnings, ok: false };

    // 4b. Same products in, same products out.
    var bIds = before.records.map(function (r) { return r.id; }), aIds = after.records.map(function (r) { return r.id; });
    bIds.forEach(function (id) { if (aIds.indexOf(id) < 0) errors.push('Product "' + id + '" has gone missing.'); });
    aIds.forEach(function (id) { if (bIds.indexOf(id) < 0) errors.push('Unexpected new product "' + id + '".'); });

    // 4c. Everything outside the data array must be byte-identical.
    var outsideBefore = beforeHtml.slice(0, before.arr.start) + beforeHtml.slice(before.arr.end);
    var outsideAfter = afterHtml.slice(0, after.arr.start) + afterHtml.slice(after.arr.end);
    if (outsideBefore !== outsideAfter && !cfg.allowOutside) errors.push('Code outside the product list changed. The tool only edits the product list, so this should never happen — stop and tell Clara.');

    // 4d. Per-product field rules from the page config.
    var today = cfg.today ? new Date(cfg.today) : new Date(); today.setHours(0, 0, 0, 0);
    after.records.forEach(function (r) {
      var d = r.data, label = cfg.productLabel(d);
      (cfg.required || []).forEach(function (p) {
        var v = getPath(d, p);
        if (v === undefined || v === null || v === '') errors.push(label + ': "' + p + '" is empty.');
      });
      (cfg.urlFields || []).forEach(function (p) {
        var v = getPath(d, p);
        if (typeof v === 'string' && v && !/^https:\/\/[^\s'"<>]+$/.test(v)) errors.push(label + ': ' + p + ' must be a full https:// link with no spaces.');
      });
      (cfg.bilingualPairs || []).forEach(function (p) {
        var v = getPath(d, p);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (!v.zh || !String(v.zh).trim()) errors.push(label + ': ' + p + ' — Chinese is empty.');
          if (cfg.requireEn && (!v.en || !String(v.en).trim())) warnings.push(label + ': ' + p + ' — English is empty (the EN page will show nothing).');
        }
      });
      (cfg.expiryFields || []).forEach(function (p) {
        var v = getPath(d, p); var s = v && typeof v === 'object' ? (v.zh || '') : (v || '');
        var dt = parseZhDate(s);
        if (dt && dt < today) warnings.push(label + ': offer expired on ' + dt.toISOString().slice(0, 10) + ' but is still on the page ("' + s + '").');
      });
      (cfg.numberFields || []).forEach(function (nf) {
        var v = getPath(d, nf.path);
        if (v === null && nf.nullable) return;
        if (typeof v !== 'number' || !isFinite(v) || v < 0) errors.push(label + ': ' + nf.path + ' must be a number' + (nf.nullable ? ' or empty' : '') + '.');
      });
      (cfg.pairs || []).forEach(function (pr) {
        var lo = getPath(d, pr.low), hi = getPath(d, pr.high);
        if (typeof lo === 'number' && typeof hi === 'number' && lo >= hi) warnings.push(label + ': ' + pr.low + ' (' + lo + ') is not lower than ' + pr.high + ' (' + hi + ').');
      });
      Object.keys(cfg.enums || {}).forEach(function (p) {
        var v = getPath(d, p);
        if (cfg.enums[p].indexOf(v) < 0) errors.push(label + ': ' + p + ' must be one of ' + cfg.enums[p].join(', ') + '.');
      });
      (cfg.htmlTextFields || []).forEach(function (p) {
        var v = getPath(d, p);
        [v && v.zh, v && v.en].forEach(function (s) {
          if (typeof s === 'string' && unbalancedTags(s)) warnings.push(label + ': ' + p + ' has an unclosed HTML tag — check any <b>, <br>, <a>.');
        });
      });
    });

    // 4d2. Values that must exist as a key in another table (e.g. OSI iss → ISSUERS).
    (cfg.lookups || []).forEach(function (lk) {
      lk.vars.forEach(function (name) {
        var mm = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*\\{').exec(afterHtml); if (!mm) return;
        var keys = Object.keys(toJS(parseValueAt(afterHtml, mm.index + mm[0].length - 1)));
        after.records.forEach(function (r) { var v = getPath(r.data, lk.field); if (keys.indexOf(v) < 0) errors.push(cfg.productLabel(r.data) + ': ' + lk.field + ' "' + v + '" is not in ' + name + '.'); });
      });
    });
    // 4e. Lookups keyed by product id (e.g. SOCIAL_PROOF) must still cover every product.
    (cfg.idMaps || []).forEach(function (name) {
      var mm = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*\\{').exec(afterHtml);
      if (!mm) return;
      try {
        var keys = Object.keys(toJS(parseValueAt(afterHtml, mm.index + mm[0].length - 1)));
        aIds.forEach(function (id) { if (keys.indexOf(id) < 0) warnings.push(name + ' has no entry for "' + id + '".'); });
      } catch (e) { errors.push(name + ': ' + e.message); }
    });
    return { errors: errors, warnings: warnings, ok: errors.length === 0 };
  }

  function getPath(o, p) { return String(p).split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function parseZhDate(s) {
    var m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s) || /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function unbalancedTags(s) {
    var stack = [], re = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*?>/g, m, voids = /^(br|img|hr|wbr|input)$/i;
    while ((m = re.exec(s))) {
      var tag = m[1].toLowerCase(); if (voids.test(tag) || /\/>$/.test(m[0])) continue;
      if (m[0][1] === '/') { if (stack.pop() !== tag) return true; } else stack.push(tag);
    }
    return stack.length > 0;
  }

  /* ===== 5. Human-readable change list ===== */
  function changeList(beforeHtml, afterHtml, cfg) {
    var a = load(beforeHtml, cfg), b = load(afterHtml, cfg), out = [];
    // Ranking = the order visitors see (cfg.displayOrder applies page rules such as badge-first or hidden products).
    var vis = function (doc) { var ds = doc.records.map(function (r) { return r.data; }); return cfg.displayOrder ? cfg.displayOrder(ds) : ds; };
    var va = vis(a), vb = vis(b), idsOf = function (l) { return l.map(function (d) { return d.id; }).join(); };
    if (idsOf(va) !== idsOf(vb)) {
      var lst = function (l) { return l.map(function (d, n) { return (n + 1) + '. ' + cfg.productLabel(d); }).join('\n'); };
      out.push({ product: 'Ranking', field: 'Order on the page', before: lst(va), after: lst(vb) });
    }
    b.records.forEach(function (r) {
      var old = a.records.filter(function (x) { return x.id === r.id; })[0]; if (!old) return;
      cfg.fields.forEach(function (f) {
        var x = getPath(old.data, f.path), y = getPath(r.data, f.path);
        if (f.path in (cfg.defaults || {})) { if (x === undefined) x = cfg.defaults[f.path]; if (y === undefined) y = cfg.defaults[f.path]; }
        if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ product: cfg.productLabel(r.data), field: f.label, before: show(x, f), after: show(y, f) });
      });
    });
    return out;
  }

  function show(v, f) {
    if (v == null) return '';
    if (f && f.type === 'toggle') return v ? 'On (shown)' : 'Off (hidden)';
    if (Array.isArray(v)) return v.map(function (i) { return i && typeof i === 'object' ? (i.zh || i.en || JSON.stringify(i)) : String(i); }).join(' · ');
    if (typeof v === 'object') return v.zh || v.en || JSON.stringify(v);
    return String(v);
  }

  /* Line diff (LCS) for the "what will change" view. Small modules, so O(n·m) is fine. */
  function lineDiff(a, b) {
    var A = a.split('\n'), B = b.split('\n');
    var pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    var suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    var a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
    var n = a2.length, m = b2.length, L = [];
    for (var i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push({ t: '=', s: a2[i], ln: pre + i + 1 }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ t: '-', s: a2[i], ln: pre + i + 1 }); i++; } else { ops.push({ t: '+', s: b2[j], ln: pre + j + 1 }); j++; } }
    while (i < n) { ops.push({ t: '-', s: a2[i], ln: pre + i + 1 }); i++; }
    while (j < m) { ops.push({ t: '+', s: b2[j], ln: pre + j + 1 }); j++; }
    return ops.filter(function (o) { return o.t !== '='; });
  }

  var api = { lit: lit, parseValueAt: parseValueAt, toJS: toJS, nodeAt: nodeAt, load: load, build: build, check: check, changeList: changeList, lineDiff: lineDiff, parseZhDate: parseZhDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
