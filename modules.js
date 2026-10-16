/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — editors for every other module
   - htmlFields / applyHtml : the visible text, links, images and alt text
     in an HTML module, each with its exact span in the source. Edits replace
     only that span, so tags, classes, ids and data-* attributes cannot move.
   - readVar / applyVars    : data tables inside a script (page text T,
     PREMIUM_RATES, BOWTIE_RATES), edited value by value like product-data.
   - safety                 : checks every module must pass before copy,
     including when someone edits the code directly.
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var E = root.PCTEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  /* ===== HTML content fields ===== */
  var EDIT_ATTRS = { href: 'Link', src: 'Image', srcset: 'Mobile image', alt: 'Image description (alt)', title: 'Tooltip', content: 'Meta content', placeholder: 'Placeholder', 'aria-label': 'Screen-reader label', 'data-title': 'Tracking title' };
  var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

  function htmlFields(html, opts) {
    opts = opts || {};
    var fields = [], stack = [], i = 0, n = html.length;
    function ctxLabel() {
      var parts = stack.slice(-2).map(function (el) {
        return el.tag + (el.id ? '#' + el.id : '') + (el.cls ? '.' + el.cls.split(/\s+/)[0] : '');
      });
      return parts.join(' › ');
    }
    function overriddenBy() {
      // Text inside an element that scripts overwrite on load: data-i18n(-html), or an id listed by the page.
      for (var k = stack.length - 1; k >= 0; k--) {
        var el = stack[k];
        if (el.i18nHtml) return el.i18nHtml;
        if (k === stack.length - 1 && el.i18n) return el.i18n;
        if (el.id && opts.overriddenIds && opts.overriddenIds[el.id]) return opts.overriddenIds[el.id];
      }
      return null;
    }
    while (i < n) {
      var lt = html.indexOf('<', i);
      var textEnd = lt < 0 ? n : lt;
      if (textEnd > i) {
        var seg = html.slice(i, textEnd), a = seg.search(/\S/);
        if (a >= 0) {
          var b = seg.length - (seg.length - seg.replace(/\s+$/, '').length);
          fields.push({ kind: 'text', start: i + a, end: i + b, value: seg.slice(a, b), label: 'Text', where: ctxLabel(), lockedBy: overriddenBy() });
        }
      }
      if (lt < 0) break;
      if (html.startsWith('<!--', lt)) { var ce = html.indexOf('-->', lt + 4); i = ce < 0 ? n : ce + 3; continue; }
      if (html.startsWith('</', lt)) {
        var cm = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(html.slice(lt, lt + 60));
        if (cm) { var t = cm[1].toLowerCase(); for (var k = stack.length - 1; k >= 0; k--) if (stack[k].tag === t) { stack.length = k; break; } i = lt + cm[0].length; continue; }
        i = lt + 2; continue;
      }
      var om = /^<([a-zA-Z][\w-]*)/.exec(html.slice(lt, lt + 60));
      if (!om) { i = lt + 1; continue; }
      var tag = om[1].toLowerCase();
      var end = findTagEnd(html, lt);
      var inner = html.slice(lt + om[0].length, end);
      var el = { tag: tag };
      var re = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, m;
      while ((m = re.exec(inner))) {
        var name = m[1].toLowerCase(), val = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
        if (name === 'id') el.id = val;
        if (name === 'class') el.cls = val;
        if (name === 'data-i18n') el.i18n = val;
        if (name === 'data-i18n-html') el.i18nHtml = val;
        if (EDIT_ATTRS[name] && val != null) {
          if (tag === 'meta' && name === 'content' && !/name="(description|keywords)"|property="og:(title|description|image|url)"/i.test(inner)) continue;
          var q = m[2] != null ? '"' : m[3] != null ? "'" : '';
          var vStart = lt + om[0].length + m.index + m[0].length - val.length - (q ? 1 : 0);
          fields.push({ kind: 'attr', attr: name, quote: q, start: vStart, end: vStart + val.length, value: val, label: EDIT_ATTRS[name], where: tag + (el.id ? '#' + el.id : '') + (el.cls ? '.' + el.cls.split(/\s+/)[0] : '') });
        }
      }
      var close = end + 1;
      if (tag === 'script' || tag === 'style') {
        var ci = html.toLowerCase().indexOf('</' + tag, close); i = ci < 0 ? n : html.indexOf('>', ci) + 1; continue;
      }
      if (!VOID.test(tag) && html[end - 1] !== '/') stack.push(el);
      i = close;
    }
    fields.forEach(function (f, k) { f.idx = k; });
    return fields;
  }
  function findTagEnd(html, lt) {
    var q = null;
    for (var j = lt + 1; j < html.length; j++) {
      var c = html[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '>') return j;
    }
    return html.length;
  }
  function applyHtml(html, fields, edits) {
    var list = Object.keys(edits).map(function (k) { return { f: fields[+k], v: edits[k] }; })
      .filter(function (x) { return x.f && x.v !== x.f.value; })
      .sort(function (a, b) { return b.f.start - a.f.start; });
    list.forEach(function (x) { html = html.slice(0, x.f.start) + x.v + html.slice(x.f.end); });
    return html;
  }
  function htmlFieldErrors(fields, edits) {
    var errs = [];
    Object.keys(edits).forEach(function (k) {
      var f = fields[+k], v = edits[k]; if (!f || v === f.value) return;
      var name = f.label + ' (' + f.where + ')';
      if (f.kind === 'text' && /[<>]/.test(v)) errs.push(name + ': text cannot contain < or >. To add formatting, use "Edit code directly".');
      if (f.kind === 'text' && !v.trim()) errs.push(name + ': text cannot be empty. To remove an element, use "Edit code directly".');
      if (f.kind === 'attr' && f.quote && v.indexOf(f.quote) >= 0) errs.push(name + ': cannot contain the character ' + f.quote + '.');
      if (f.kind === 'attr' && (f.attr === 'href') && !/^(https:\/\/\S+|#\S*|mailto:\S+|tel:\S+)$/.test(v)) errs.push(name + ': must be a full https:// link with no spaces.');
      if (f.kind === 'attr' && (f.attr === 'src' || f.attr === 'srcset') && !/^https:\/\/\S+/.test(v)) errs.push(name + ': must be a full https:// image link.');
      if (f.kind === 'attr' && f.attr === 'alt' && !v.trim()) errs.push(name + ': describe the image — tracking and accessibility need it.');
    });
    return errs;
  }

  /* ===== Script data tables ===== */
  function readVar(html, name) {
    var m = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*').exec(html);
    if (!m) return null;
    var node = E.parseValueAt(html, m.index + m[0].length);
    return { node: node, data: E.toJS(node) };
  }
  // edits: [{ v: 'PREMIUM_RATES', path: 'fwd-standard.30.male-smoker', value: [3480,348] }]
  function applyVars(html, edits) {
    var spans = [];
    edits.forEach(function (e) {
      var r = readVar(html, e.v); if (!r) throw new Error(e.v + ' not found in this module');
      var n = E.nodeAt(r.node, e.path);
      if (!n) { // a new key in an object table (e.g. SOCIAL_PROOF for a new plan): add it after the last entry
        var parts = e.path.split('.'), key = parts.pop(), parent = parts.length ? E.nodeAt(r.node, parts.join('.')) : r.node;
        if (!parent || parent.type !== 'object') throw new Error(e.v + ': "' + e.path + '" not found');
        var first = parent.props[0], q = first && (html[first.keyStart] === "'" || html[first.keyStart] === '"') ? html[first.keyStart] : '';
        var keyText = q ? q + key + q : (/^[A-Za-z_$][\w$]*$/.test(key) ? key : "'" + key + "'");
        var at = parent.props.length ? parent.props[parent.props.length - 1].node.end : parent.start + 1;
        spans.push({ start: at, end: at, text: (parent.props.length ? ',' : '') + keyText + ':' + E.lit(e.value, "'") });
        return;
      }
      if (JSON.stringify(E.toJS(n)) === JSON.stringify(e.value)) return;
      spans.push({ start: n.start, end: n.end, text: E.lit(e.value, n.quote) });
    });
    spans.sort(function (a, b) { return b.start - a.start; });
    spans.forEach(function (s) { html = html.slice(0, s.start) + s.text + html.slice(s.end); });
    return html;
  }

  /* ===== Safety checks for any module ===== */
  function hooks(html) {
    var out = {};
    function add(kind, v) { out[kind + ' ' + v] = { kind: kind, v: v }; }
    var markup = html.replace(/<script[\s\S]*?<\/script>/gi, function (s) { return /ld\+json/.test(s) ? '' : s.replace(/[^\n]/g, ' '); }).replace(/<style[\s\S]*?<\/style>/gi, '');
    var m, re;
    re = /\sid\s*=\s*["']([^"']+)["']/g; while ((m = re.exec(markup))) add('id', m[1]);
    re = /\sclass\s*=\s*["']([^"']+)["']/g; while ((m = re.exec(markup))) m[1].split(/\s+/).forEach(function (c) { if (c) add('class', c); });
    re = /\s(data-[\w-]+)\s*=/g; while ((m = re.exec(markup))) add('attribute', m[1]);
    re = /\son\w+\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/g; while ((m = re.exec(markup))) add('click handler', m[1]);
    var scripts = []; re = /<script(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/gi; while ((m = re.exec(html))) scripts.push(m[1]);
    scripts.forEach(function (s) {
      var r = /^\s*function\s+([A-Za-z_$][\w$]*)/gm, mm; while ((mm = r.exec(s))) add('function', mm[1]);
      r = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=/gm; while ((mm = r.exec(s))) add('variable', mm[1]);
    });
    return out;
  }
  function tagCounts(html) {
    var c = {}, m, re = /<(\/?)([a-zA-Z][\w-]*)/g;
    var body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2').replace(/(<style[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
    while ((m = re.exec(body))) { var k = (m[1] ? '/' : '') + m[2].toLowerCase(); c[k] = (c[k] || 0) + 1; }
    return c;
  }
  function safety(before, after, opts) {
    opts = opts || {};
    var errors = [], warnings = [], m, re, k = 0;
    re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    while ((m = re.exec(after))) {
      k++;
      if (/ld\+json/.test(m[1])) { try { JSON.parse(m[2]); } catch (e) { errors.push('Structured data (JSON-LD) block ' + k + ' is broken: ' + e.message + '. Google will ignore it.'); } }
      else if (!/src=/.test(m[1])) { try { new Function(m[2]); } catch (e) { errors.push('Script block ' + k + ' would not run: ' + e.message + '. Pasting this can blank the page.'); } }
    }
    re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    while ((m = re.exec(after))) {
      var css = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '');
      var depth = 0, bad = false; for (var j = 0; j < css.length; j++) { if (css[j] === '{') depth++; if (css[j] === '}') depth--; if (depth < 0) bad = true; }
      if (bad || depth !== 0) errors.push('Styles: a { or } is missing. This can break the layout of the whole page.');
      if (/\/\*(?![\s\S]*?\*\/)/.test(m[1])) errors.push('Styles: a /* comment is never closed. Everything after it is ignored.');
    }
    var cb = tagCounts(before), ca = tagCounts(after);
    if (!opts.expectStructure) Object.keys(Object.assign({}, cb, ca)).forEach(function (t) {
      if ((cb[t] || 0) !== (ca[t] || 0)) warnings.push('Structure changed: <' + t + '> appears ' + (cb[t] || 0) + ' → ' + (ca[t] || 0) + ' times. Check the preview carefully.');
    });
    var hb = hooks(before), ha = hooks(after), lost = Object.keys(hb).filter(function (x) { return !ha[x]; });
    if (lost.length) {
      var msg = 'Removed ' + lost.length + ' thing' + (lost.length > 1 ? 's' : '') + ' the page code relies on: ' + lost.slice(0, 8).map(function (x) { return hb[x].kind + ' "' + hb[x].v + '"'; }).join(', ') + (lost.length > 8 ? '…' : '') + '. Other modules may stop working.';
      (opts.allowHookRemoval ? warnings : errors).push(msg);
    }
    if (before.trim() && !after.trim()) errors.push('The new code is empty.');
    return { errors: errors, warnings: warnings, lostHooks: lost.length, ok: errors.length === 0 };
  }


  /* ===== Repeated blocks (banners) ===== */
  // Each slide = optional "<!-- BANNER n -->" comment line + <a class="promo-slide" …>…</a>, with its indentation.
  function slides(html) {
    var out = [], re = /<a\b[^>]*class="[^"]*\bpromo-slide\b[^"]*"[^>]*>/g, m;
    while ((m = re.exec(html))) {
      var close = html.indexOf('</a>', m.index); if (close < 0) break;
      var end = close + 4, start = m.index;
      var lineStart = html.lastIndexOf('\n', start - 1) + 1;
      var prev = html.slice(0, lineStart).match(/(?:^|\n)([ \t]*<!--[^\n]*BANNER[^\n]*-->[ \t]*\r?\n)$/);
      start = prev ? lineStart - prev[1].length : lineStart;
      var lineEnd = html.indexOf('\n', end); end = lineEnd < 0 ? end : lineEnd + 1;
      out.push({ start: start, end: end, tagStart: m.index });
      re.lastIndex = end;
    }
    return out;
  }
  function addSlide(html, copyIdx) {
    var sl = slides(html); if (!sl.length) throw new Error('No banner found to copy');
    var src = sl[copyIdx == null ? sl.length - 1 : copyIdx], last = sl[sl.length - 1];
    var block = html.slice(src.start, src.end).replace(/BANNER\s*\d+/, 'BANNER ' + (sl.length + 1));
    return html.slice(0, last.end) + '\n' + block + html.slice(last.end);
  }
  function removeSlide(html, k) {
    var sl = slides(html); if (sl.length <= 1) throw new Error('Keep at least one banner. To hide the carousel, ask for it to be removed from the page.');
    var b = sl[k]; var end = b.end; if (html[end] === '\n' || /^\s*\n/.test(html.slice(end, end + 2))) end = html.indexOf('\n', end) + 1;
    return html.slice(0, b.start) + html.slice(end);
  }

  /* ===== Leaf-by-leaf differences between two values ===== */
  function deepDiff(a, b, path, out) {
    out = out || []; path = path || '';
    var simple = function (x) { return x === null || typeof x !== 'object' || (Array.isArray(x) && x.every(function (y) { return y === null || typeof y !== 'object'; })); };
    if (simple(a) || simple(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path, before: a, after: b }); return out; }
    Object.keys(Object.assign({}, a, b)).forEach(function (k) { deepDiff(a ? a[k] : undefined, b ? b[k] : undefined, path ? path + '.' + k : k, out); });
    return out;
  }

  /* ===== Live-page check for saved copies =====
     HubSpot wraps every module on the published page in
       <div … data-hs-cos-type="module"> … </div><!--end widget-span -->
     and rewrites a little on the way out (& → &amp; in attributes, &#8249; → ‹, drops <!DOCTYPE>/<html>).
     normalise() removes exactly those differences; anything else that differs is a real change. */
  function liveModules(liveHtml) {
    var out = [], re = /<div[^>]*data-hs-cos-(?:general-)?type="(?:module|widget)"[^>]*data-hs-cos-type="(\w+)"[^>]*>|<div[^>]*data-hs-cos-type="(\w+)"[^>]*>/g, m, opens = [];
    while ((m = re.exec(liveHtml))) opens.push({ start: m.index + m[0].length, type: m[1] || m[2] });
    opens.forEach(function (o, k) {
      var endMark = liveHtml.indexOf('</div><!--end widget-span -->', o.start);
      var next = k + 1 < opens.length ? liveHtml.lastIndexOf('<div', opens[k + 1].start - 1) : liveHtml.length;
      var end = Math.min(endMark < 0 ? liveHtml.length : endMark, next);
      // HubSpot's inner wrapper adds one closing </div> after the module's own code
      out.push({ type: o.type, html: liveHtml.slice(o.start, end).replace(/<\/div>\s*$/, '') });
    });
    return out;
  }
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function normalise(html) {
    return html
      .replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?(html|head|body)\b[^>]*>/gi, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
        return ENT.hasOwnProperty(e.toLowerCase()) ? ENT[e.toLowerCase()] : all;
      })
      .replace(/\s*\/>/g, '/>') // HubSpot writes "/> as " />
      // HubSpot lowercases SVG attribute names (viewBox → viewbox); compare names case-insensitively
      .replace(/<[a-zA-Z][^>]*>/g, function (tag) { return tag.replace(/(\s)([A-Za-z][\w:-]*)=/g, function (m, sp, n) { return sp + n.toLowerCase() + '='; }); })
      .split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }
  // saved: the module code we hold. Returns { status: 'match' | 'changed' | 'missing', line, saved, live }.
  function liveCheck(saved, liveHtml, fingerprint) {
    var mods = liveModules(liveHtml), want = normalise(saved);
    if (!want.length) return { status: 'missing' };
    var cand = mods.filter(function (x) { return fingerprint ? x.html.indexOf(fingerprint) >= 0 || normalise(x.html).join('\n').indexOf(fingerprint) >= 0 : true; });
    if (!cand.length) return { status: 'missing' };
    var best = null;
    cand.forEach(function (x) {
      var got = normalise(x.html);
      // a module may sit at the end of a bigger wrapper (the page head does) — align on our first line
      var at = got.indexOf(want[0]); if (at > 0) got = got.slice(at);
      var i = 0; while (i < want.length && i < got.length && want[i] === got[i]) i++;
      var r = i === want.length && got.length === want.length ? { status: 'match' } : { status: 'changed', line: i + 1, saved: want[i] || '(end of module)', live: got[i] || '(end of module)' };
      if (!best || r.status === 'match' || (best.status !== 'match' && i >= (best.line || 0))) best = r;
    });
    return best;
  }

  // The live code of one module, found by its fingerprint. Exactly one live module must match.
  function liveModuleCode(liveHtml, fingerprint) {
    var hits = liveModules(liveHtml).filter(function (x) { return x.html.indexOf(fingerprint) >= 0; });
    if (hits.length !== 1) return { error: hits.length ? 'found ' + hits.length + ' modules containing "' + fingerprint + '"' : 'not on the live page' };
    return { code: hits[0].html.replace(/^\s+|\s+$/g, '') + '\n' };
  }

  var api = { liveModuleCode: liveModuleCode, liveModules: liveModules, liveCheck: liveCheck, normalise: normalise, slides: slides, addSlide: addSlide, removeSlide: removeSlide, deepDiff: deepDiff, htmlFields: htmlFields, applyHtml: applyHtml, htmlFieldErrors: htmlFieldErrors, readVar: readVar, applyVars: applyVars, safety: safety, hooks: hooks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTModules = api;
})(typeof window !== 'undefined' ? window : globalThis);
