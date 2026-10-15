/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — page registry
   One entry per HubSpot page: its modules in the order they appear on the
   LIVE page, the editor each one gets, field labels and check rules.
   Field paths match the module's data, e.g. "exclusive.expiry.zh" → P[n].exclusive.expiry.zh.

   Module keys:
     fingerprint  text that is in this module and no other — how pastes are checked and
                  how the live snapshot finds the module
     find         the module's first line of code, shown to PCT to locate it in HubSpot
                  (HubSpot's own module numbers are unknown, so the tool never uses numbers)
     editor       products = product forms + ranking · content = text/links/images
                  banner = content + add/remove banners · scripts = data tables only
                  code = direct code only. Every module also has "Edit code directly".
     vars         data tables in the module, edited value by value:
                  text (T page text) · rates ([product][age][column] = [original, discounted] | 'NA')
                  grid ([row][column] = number) · list (array of items, e.g. FAQS)
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var PROMO_CODE = { pattern: '^[A-Za-z0-9_-]*$', patternMsg: 'Letters, numbers, - and _ only' };

  /* ===== Life (ZH + EN share one data shape) ===== */
  var LIFE_FIELDS = [
    { path: 'name.zh', label: '產品名稱 (中)', group: 'Product', type: 'text' },
    { path: 'name.en', label: 'Product name (EN)', group: 'Product', type: 'text' },
    { path: 'tags', label: 'Tags 標籤', group: 'Product', type: 'tags', langs: ['zh', 'en'], colours: [
      { value: 't-blue', label: 'Blue' }, { value: 't-orange', label: 'Orange' }, { value: 't-green', label: 'Green' }] },
    { path: 'exclusive.text.zh', label: '優惠內容 (中)', group: 'Offer', type: 'textarea', hint: 'Line break: type <br>' },
    { path: 'exclusive.text.en', label: 'Offer text (EN)', group: 'Offer', type: 'textarea', hint: 'Line break: type <br>' },
    { path: 'exclusive.code', label: '優惠碼 Promo code', group: 'Offer', type: 'text', pattern: PROMO_CODE.pattern, patternMsg: PROMO_CODE.patternMsg },
    { path: 'exclusive.expiry.zh', label: '優惠期 (中)', group: 'Offer', type: 'text', hint: 'e.g. 限時至2026年11月30日 — the tool warns when this date has passed' },
    { path: 'exclusive.expiry.en', label: 'Offer period (EN)', group: 'Offer', type: 'text', hint: 'e.g. Valid until 30 Nov 2026' },
    { path: 'url', label: '投保連結 Apply link', group: 'Link', type: 'url', hint: 'Full https:// link from the provider, including UTM' }
  ];
  function lifeData(lang) {
    return {
      moduleLabel: 'Life product-data',
      arrayVar: 'P',
      productLabel: function (d) { return (d.name && (d.name[lang] || d.name.zh || d.name.en)) || d.id; },
      productSub: function (d) { return d.insurer; },
      logo: function (d) { return d.logo; },
      // Ranking = order of P (scripts never reads rank). rank / rankClass are kept in step for readers.
      rank: { field: 'rank', classField: 'rankClass', classFor: function (n) { return n <= 3 ? 'rank-' + n : 'rank-other'; } },
      fields: LIFE_FIELDS,
      required: ['id', 'insurer', 'providerId', 'name.zh', 'logo', 'url'],
      urlFields: ['url', 'logo'],
      bilingualPairs: ['name', 'exclusive.text', 'exclusive.expiry'],
      requireEn: true,
      expiryFields: ['exclusive.expiry'],
      htmlTextFields: ['exclusive.text'],
      idMaps: ['SOCIAL_PROOF']
    };
  }
  function lifeModules(lang) {
    var m = [
      { file: 'head', editor: 'content', fingerprint: 'Component: Head', find: '<!-- Component: Head', what: 'Browser tab title, Google description, social share text' },
      { file: 'styles', editor: 'code', fingerprint: 'HUBSPOT OVERRIDES', find: '<style> /* ── HUBSPOT OVERRIDES', what: 'Colours, spacing, layout. Code only — check the preview on phone and desktop.' },
      { file: 'hero', editor: 'content', fingerprint: 'Component: Hero Section', find: '<!-- Component: Hero Section -->', what: 'Hero heading and intro. The words shown are set in scripts › Page text.' },
      { file: 'trust-bar', editor: 'content', fingerprint: 'Component: Trust Bar', find: '<!-- Component: Trust Bar -->', what: 'Trust points under the hero (text set in scripts › Page text)' },
      lang === 'zh'
        ? { file: 'promo-banner', editor: 'banner', fingerprint: 'Component: Promo Banner', find: '<!-- Component: Promo Banner Carousel -->', what: 'Banner images, links, alt text. Add or remove banners.' }
        // the EN banner is a bare image with no link (checked 2026-10-15), so there is no slide to copy
        : { file: 'promo-banner', editor: 'content', fingerprint: 'Component: Promo Banner', find: '<!-- Component: Promo Banner Carousel -->', what: 'Banner images and alt text. This banner has no link; to add one or a second banner, use "Edit code directly".' },
      { file: 'sidebar-and-products', editor: 'content', fingerprint: 'Component: Quote Bar', find: '<!-- Component: Quote Bar + Sidebar + Product List', what: 'Quote bar and filter labels' },
      { file: 'compare-banner', editor: 'content', fingerprint: 'Component: Compare Banner', find: '<!-- Component: Compare Banner -->', what: 'The compare box and its banner' },
      { file: 'claims-section', editor: 'content', fingerprint: 'Component: Claims and Features', find: '<!-- Component: Claims and Features Section -->', what: 'Claims and features section' }
    ];
    if (lang === 'en') m.push({ file: 'faq-section', editor: 'content', fingerprint: 'Component: FAQ Section', find: '<!-- Component: FAQ Section -->', what: 'FAQ heading. Questions and answers are set in scripts › Page text (faq1q, faq1a…).' });
    m.push(
      { file: 'seo-content', editor: 'content', fingerprint: 'Component: SEO Content', find: '<!-- Component: SEO Content Section -->', what: lang === 'zh' ? 'SEO article. (The extra article text below it is a HubSpot rich-text module — edit that directly in HubSpot.)' : 'SEO article' },
      { file: 'footer-cta', editor: 'content', fingerprint: 'Component: Footer CTA', find: '<!-- Component: Footer CTA -->', what: 'Bottom call-to-action (text set in scripts › Page text)' },
      { file: 'sticky-elements', editor: 'content', fingerprint: 'Component: Sticky Elements', find: '<!-- Component: Sticky Elements', what: 'Sticky buy button, compare tray, compare pop-up' },
      { file: 'product-data', editor: 'products', fingerprint: 'PRODUCT DATA', find: '<script> /* ===== PRODUCT DATA ===== */', what: 'Ranking, product names, tags, offers, promo codes, apply links',
        vars: [{ v: '@tags', title: 'Tags 標籤', kind: 'productTags', field: 'tags' }],
        note: 'Premiums are in the scripts module › Premium table. Coverage, pros/cons and documents → "Edit code directly".' },
      { file: 'scripts', editor: 'scripts', fingerprint: 'var PREMIUM_RATES', find: '<script> /* ===== i18n ===== */', what: 'Page text (hero, FAQ, labels) and premium tables',
        vars: [
          { v: 'T', title: lang === 'zh' ? 'Page text 頁面文字' : 'Page text', kind: 'text', root: lang },
          { v: 'PREMIUM_RATES', title: 'Premium table 保費表', kind: 'rates', na: true, // Life scripts read 'NA' as not offered
            excel: { expect: ['long'], sumInsured: '3M', products: 'product-data',
              how: 'In the Term Life RP Product Details Excel, open one provider\'s premium sheet (e.g. "Premium FWD"). Click the corner above row 1 to select the whole sheet, copy, and paste below. Do one provider at a time.',
              // Excel plan names as Phillip writes them (checked against the 29/09 file)
              aliases: { 'fwd-standard': ['FWD 自主保（升級版）定期保障計劃 - 標準計劃'], 'fwd-premier': ['FWD 自主保（升級版）定期保障計劃 - 特等級別'],
                zurich: ['Zurich 至安心定期壽險計劃'], bowtie: ['Bowtie 定期人壽保險計劃'],
                'blue-tl3': ['Blue WeCare 定期人壽保障計劃 TL3'], 'blue-tf1': ['Blue WeCare 靈活定期人壽保障計劃 TF1'] } } },
          { v: 'BOWTIE_RATES', title: 'Bowtie monthly rates (per HK$1M)', kind: 'grid' }
        ] }
    );
    return m;
  }

  /* ===== Critical Illness (繁中 only) ===== */
  var CI_FIELDS = [
    { path: 'enabled', label: 'Show on the page', group: 'Product', type: 'toggle', hint: 'Off = the product stays in the data but is hidden from the page.' },
    { path: 'name.zh', label: '計劃名稱', group: 'Product', type: 'text' },
    { path: 'tags', label: 'Tags 標籤 (top chips on the card)', group: 'Product', type: 'tags', langs: ['zh'] },
    { path: 'exclusive.text.zh', label: '獨家優惠內容', group: 'Offer', type: 'textarea', hint: 'Line break: type <br>' },
    { path: 'exclusive.code', label: '優惠碼 Promo code', group: 'Offer', type: 'text', pattern: PROMO_CODE.pattern, patternMsg: PROMO_CODE.patternMsg },
    { path: 'exclusive.expiry.zh', label: '優惠期', group: 'Offer', type: 'text', hint: 'e.g. 限時至2026年11月30日 — the tool warns when this date has passed' },
    { path: 'url', label: '投保連結 Apply link', group: 'Link', type: 'url', hint: 'Full https:// link from the provider, including UTM' }
  ];

  /* ===== Overseas Student Insurance (繁中 only) ===== */
  var OSI_FIELDS = [
    { path: 'name', label: '計劃名稱', group: 'Product', type: 'text' },
    { path: 'badge', label: '角標 Badge', group: 'Product', type: 'text-null', hint: 'Leave empty for no badge. Products with a badge always show above products without one.' },
    { path: 'price', label: '原價 Original price (HK$ / year)', group: 'Price & offer', type: 'number' },
    { path: 'disc', label: '折後價 Discounted price (HK$ / year)', group: 'Price & offer', type: 'number-null', hint: 'Leave empty if there is no discount.' },
    { path: 'promo', label: '優惠碼 Promo code', group: 'Price & offer', type: 'text-null', pattern: '^[A-Za-z0-9_-]*$', patternMsg: PROMO_CODE.patternMsg, hint: 'Leave empty if there is no code.' },
    { path: 'age', label: '投保年齡', group: 'Coverage', type: 'text' },
    { path: 'med', label: '醫療保障 Medical (HK$)', group: 'Coverage', type: 'number' },
    { path: 'acc', label: '意外保障 Accident (HK$)', group: 'Coverage', type: 'number' },
    { path: 'tui', label: '學費保障 Tuition (HK$)', group: 'Coverage', type: 'number' },
    { path: 'edu', label: '教育保障 Education (HK$)', group: 'Coverage', type: 'number' },
    { path: 'url', label: '投保連結 Apply link', group: 'Links', type: 'url' },
    { path: 'leaflet', label: '產品小冊子 Leaflet PDF', group: 'Links', type: 'url' },
    { path: 'policy', label: '保單條款 Policy PDF', group: 'Links', type: 'url' }
  ];

  var PAGES = [
    {
      key: 'life-zh', label: 'Life 人壽 (中)', status: 'live',
      liveUrl: 'https://www.moneyhero.com.hk/zh/life-insurance',
      hubspotPage: 'Life Insurance — 繁中',
      modules: lifeModules('zh'),
      shortcuts: [
        { label: 'Premiums', file: 'scripts', tab: 'PREMIUM_RATES' },
        { label: 'Ranking & offers', file: 'product-data', tab: 'products' },
        { label: 'Tags', file: 'product-data', tab: '@tags' },
        { label: 'Banners', file: 'promo-banner' },
        { label: 'Page text', file: 'scripts', tab: 'T' }
      ],
      // Elements whose text scripts overwrite on load → the key in scripts › Page text that really controls it.
      overriddenIds: { heroTitle: 'heroTitle', heroDesc: 'heroDesc' },
      data: lifeData('zh')
    },
    {
      key: 'life-en', label: 'Life (EN)', status: 'live',
      // Clara 2026-10-15: the EN page is /en/life-insurance (returned 404 that day — not yet published).
      // Until it is live, "Load live version" says so and PCT pastes from HubSpot.
      liveUrl: 'https://www.moneyhero.com.hk/en/life-insurance',
      hubspotPage: 'Life Insurance — English',
      modules: lifeModules('en'),
      shortcuts: [
        { label: 'Premiums', file: 'scripts', tab: 'PREMIUM_RATES' },
        { label: 'Ranking & offers', file: 'product-data', tab: 'products' },
        { label: 'Tags', file: 'product-data', tab: '@tags' },
        { label: 'Banners', file: 'promo-banner' },
        { label: 'Page text', file: 'scripts', tab: 'T' }
      ],
      overriddenIds: { heroTitle: 'heroTitle', heroDesc: 'heroDesc' },
      data: lifeData('en')
    },
    {
      key: 'ci', label: 'CI 危疾', status: 'live',
      liveUrl: 'https://www.moneyhero.com.hk/zh/insurance/critical-illness-insurance',
      hubspotPage: 'Critical Illness Insurance — 繁中',
      shortcuts: [
        { label: 'Premiums', file: 'product-data', tab: 'PREMIUM_RATES' },
        { label: 'Ranking, show/hide & offers', file: 'product-data', tab: 'products' },
        { label: 'Tags', file: 'product-data', tab: '@tags' },
        { label: 'FAQ', file: 'product-data', tab: 'FAQS' },
        { label: 'Banners', file: 'promo-banner' },
        { label: 'Page text', file: 'scripts', tab: 'T' }
      ],
      modules: [
        { file: 'head', editor: 'content', fingerprint: 'Component: Head', find: '<!-- Component: Head', what: 'Browser tab title, Google description, social share text' },
        { file: 'styles', editor: 'code', fingerprint: 'HUBSPOT OVERRIDES', find: '<style> /* ── HUBSPOT OVERRIDES', what: 'Colours, spacing, layout. Code only — check the preview on phone and desktop.' },
        { file: 'hero', editor: 'content', fingerprint: 'Component: Hero Section', find: '<!-- Component: Hero Section -->', what: 'Hero heading, intro and notice. The words shown are set in scripts › Page text.' },
        { file: 'trust-bar', editor: 'content', fingerprint: 'Component: Trust Bar', find: '<!-- Component: Trust Bar -->', what: 'Trust points under the hero (text set in scripts › Page text)' },
        { file: 'promo-banner', editor: 'banner', fingerprint: 'Component: Promo Banner', find: '<!-- Component: Promo Banner Carousel', what: 'Banner images, links, alt text. Add or remove banners.' },
        { file: 'sidebar-and-products', editor: 'content', fingerprint: 'Component: Quote Bar', find: '<!-- Component: Quote Bar + Sidebar + Product List', what: 'Quote bar and filter labels' },
        { file: 'compare-banner', editor: 'content', fingerprint: 'class="compare-banner"', find: '<!-- 獨立 Blue banner（26-0252）已拎走', what: 'The 先比後買 box' },
        { file: 'claims-section', editor: 'content', fingerprint: 'Component: Claims and Features', find: '<!-- Component: Claims and Features Section -->', what: 'Claims and features section' },
        { file: 'faq-section', editor: 'content', fingerprint: 'Component: FAQ Section', find: '<!-- Component: FAQ Section -->', what: 'FAQ heading. Questions and answers are in product-data › FAQ.' },
        { file: 'seo-content', editor: 'content', fingerprint: 'Component: SEO Content', find: '<!-- Component: SEO Content Section', what: 'SEO article' },
        { file: 'footer-cta', editor: 'content', fingerprint: 'Component: Footer CTA', find: '<!-- Component: Footer CTA -->', what: 'Bottom call-to-action (text set in scripts › Page text)' },
        { file: 'sticky-elements', editor: 'content', fingerprint: 'Component: Sticky Elements', find: '<!-- Component: Sticky Elements', what: 'Sticky buy button, compare tray, compare pop-up' },
        { file: 'product-data', editor: 'products', fingerprint: 'var PREMIUM_RATES', find: '<!-- ══════ 產品資料 PRODUCT DATA', what: 'Ranking, show/hide, names, tags, offers, codes, apply links, premium table, FAQ',
          vars: [
            { v: '@tags', title: 'Tags 標籤', kind: 'productTags', field: 'tags' },
            // CI cells: [original, discounted|null] or {n:'note shown instead of a price'}; no 'NA'
            { v: 'PREMIUM_RATES', title: 'Premium table 保費表', kind: 'rates', discountOptional: true,
              excel: { expect: ['ci'], how: 'In the Critical Illness RP Product Details Excel, open the "Premium" sheet. Click the corner above row 1 to select the whole sheet, copy, and paste below.' } },
            { v: 'FAQS', title: 'FAQ 常見問題', kind: 'list', fields: [{ p: 'q.zh', label: '問題 Question' }, { p: 'a.zh', label: '答案 Answer', long: true }] }
          ],
          note: 'Coverage table, more info and documents → "Edit code directly".' },
        { file: 'scripts', editor: 'scripts', fingerprint: 'var LANG=', find: '<script> /* ===== i18n ===== */', what: 'Page text (hero, labels)',
          vars: [{ v: 'T', title: 'Page text 頁面文字', kind: 'text', root: 'zh' }] }
      ],
      overriddenIds: { heroTitle: 'heroTitle', heroDesc: 'heroDesc', heroNotice: 'heroNotice' },
      data: {
        moduleLabel: 'CI product-data',
        arrayVar: 'P',
        productLabel: function (d) { return (d.name && d.name.zh) || d.id; },
        productSub: function (d) { return d.insurer; },
        logo: function (d) { return d.logo; },
        // Ranking = order of P among products that are switched on (scripts filters enabled!==false, never reads rank).
        rank: { field: 'rank' },
        displayOrder: function (list) { return list.filter(function (d) { return d.enabled !== false; }); },
        defaults: { enabled: true },
        fields: CI_FIELDS,
        required: ['id', 'insurer', 'providerId', 'name.zh', 'logo', 'url'],
        urlFields: ['url', 'logo'],
        bilingualPairs: ['name'],
        requireEn: false,
        expiryFields: ['exclusive.expiry'],
        htmlTextFields: ['exclusive.text'],
        idMaps: ['SOCIAL_PROOF', 'PREMIUM_RATES'],
        lookups: [{ field: 'providerId', vars: ['ISSUERS'] }]
      }
    },
    {
      key: 'osi', label: 'OSI 海外升學', status: 'live',
      liveUrl: 'https://www.moneyhero.com.hk/zh/insurance/oversea-student-insurance',
      hubspotPage: 'Overseas Student Insurance — 繁中',
      shortcuts: [
        { label: 'Premiums', file: 'product-data', tab: '@premiums' },
        { label: 'Ranking & offers', file: 'product-data', tab: 'products' },
        { label: 'Tags (badges)', file: 'product-data', tab: '@tags' },
        { label: 'FAQ', file: 'product-data', tab: 'FAQS' },
        { label: 'Banners', file: 'promo-banner' }
      ],
      modules: [
        { file: 'head', editor: 'content', fingerprint: '<title>', find: '<meta charset="UTF-8">', what: 'Browser tab title, Google description, social share text' },
        { file: 'styles', editor: 'code', fingerprint: 'HUBSPOT OVERRIDES', find: '<style> /* ── HUBSPOT OVERRIDES', what: 'Colours, spacing, layout. Code only — check the preview on phone and desktop.' },
        { file: 'hero', editor: 'content', fingerprint: '<!-- HERO -->', find: '<!-- HERO -->', what: 'Hero heading and intro' },
        { file: 'trust-bar', editor: 'content', fingerprint: '<!-- TRUST BAR -->', find: '<!-- TRUST BAR -->', what: 'Trust points under the hero' },
        { file: 'promo-banner', editor: 'banner', fingerprint: '<!-- PROMO BANNER CAROUSEL', find: '<!-- PROMO BANNER CAROUSEL', what: 'Banner images, links, alt text. Add or remove banners.' },
        { file: 'sidebar-and-products', editor: 'content', fingerprint: 'id="productList"', find: '<div class="page">', what: 'Filters, results bar and the product list container' },
        { file: 'compare-banner', editor: 'content', fingerprint: '<!-- COMPARE BANNER -->', find: '<!-- COMPARE BANNER -->', what: 'The compare box' },
        { file: 'claims-section', editor: 'content', fingerprint: '<!-- CLAIMS & FEATURES -->', find: '<!-- CLAIMS & FEATURES -->', what: 'Claims and features section' },
        { file: 'faq-section', editor: 'content', fingerprint: '<!-- FAQ -->', find: '<!-- FAQ -->', what: 'FAQ heading. Questions and answers are in product-data › FAQ.' },
        { file: 'seo-content', editor: 'content', fingerprint: '<!-- SEO CONTENT -->', find: '<!-- SEO CONTENT -->', what: 'SEO article' },
        { file: 'footer-cta', editor: 'content', fingerprint: '<!-- FOOTER CTA -->', find: '<!-- FOOTER CTA -->', what: 'Bottom call-to-action' },
        { file: 'sticky-elements', editor: 'content', fingerprint: '<!-- STICKY BOTTOM CTA -->', find: '<!-- STICKY BOTTOM CTA -->', what: 'Sticky bottom bar, compare tray, compare pop-up' },
        { file: 'product-data', editor: 'products', fingerprint: 'var ISSUERS', find: '<!-- ══════ 產品資料 PRODUCT DATA', what: 'Ranking, prices, discounts, codes, badges, coverage amounts, links, FAQ',
          vars: [
            { v: '@tags', title: 'Badges 角標', kind: 'productTags', field: 'badge' },
            { v: '@premiums', title: 'Premiums 保費', kind: 'productColumns',
              excel: { expect: ['osi'], how: 'Open the OSI Excel (one row per plan: 保險計劃, Badge, Link, … 保費, Discounted Price). Click the corner above row 1 to select the whole sheet, copy, and paste below. Badges, links, ages and coverage amounts are updated too.' },
              cols: [{ p: 'price', label: '原價 Original (HK$/yr)' }, { p: 'disc', label: '折後價 Discounted (HK$/yr)', nullable: true }] },
            { v: 'FAQS', title: 'FAQ 常見問題', kind: 'list', fields: [{ p: 'q', label: '問題 Question' }, { p: 'a', label: '答案 Answer', long: true }] }
          ],
          note: 'Issuer names and anything not in the form → "Edit code directly".' },
        { file: 'scripts', editor: 'code', fingerprint: 'Component: Scripts', find: '<!-- Component: Scripts — All JavaScript', what: 'Page behaviour. Code only. This page has no separate page-text table: change text in the module where it appears.' }
      ],
      overriddenIds: {},
      data: {
        moduleLabel: 'OSI product-data',
        arrayVar: 'P',
        blockStart: '═{5}', // each product starts with a /* ═════ name ═════ */ comment
        productLabel: function (d) { return d.name || d.id; },
        productSub: function (d) { return d.iss + ' · ' + d.dest + ' · ' + d.dur + (d.badge ? ' · ' + d.badge : ''); },
        logo: function () { return null; },
        // Default view: products with a badge first, otherwise P order (stable sort in scripts).
        displayOrder: function (list) { return list.filter(function (d) { return d.badge; }).concat(list.filter(function (d) { return !d.badge; })); },
        fields: OSI_FIELDS,
        required: ['id', 'iss', 'name', 'url', 'dest', 'dur'],
        urlFields: ['url', 'leaflet', 'policy'],
        numberFields: [{ path: 'price' }, { path: 'disc', nullable: true }, { path: 'med' }, { path: 'acc' }, { path: 'tui' }, { path: 'edu' }],
        pairs: [{ low: 'disc', high: 'price' }],
        enums: { dest: ['global', 'usca', 'asia'], dur: ['6m', '1y', '2y'] },
        lookups: [{ field: 'iss', vars: ['ISSUERS', 'ISSUER_ICON'] }]
      }
    },
    {
      key: 'vhis', label: 'VHIS 自願醫保', status: 'live',
      liveUrl: 'https://www.moneyhero.com.hk/zh/insurance/vhis',
      hubspotPage: 'VHIS 自願醫保 — 繁中',
      shortcuts: [
        { label: 'Premiums', file: '08 product data', tab: '@premiums' },
        { label: 'Ranking & offers', file: '08 product data', tab: 'products' },
        { label: 'Tags', file: '08 product data', tab: '@tags' },
        { label: 'Banners', file: '09 banner', tab: 'BANNERS' }
      ],
      // Modules are labelled "MODULE 0N —" in their first comment. MODULE 01 (fonts) lives in
      // Page Settings › Head HTML, not in a module. Product data (08) is edited here, not from the Excel
      // (Clara, 2026-10-15) — running the old Excel build would undo PCT's edits.
      modules: [
        { file: '02 styles', editor: 'code', fingerprint: 'MODULE 02 —', find: '<!-- ═══ MODULE 02 — Styles', what: 'Colours, spacing, layout. Code only — check the preview on phone and desktop.' },
        { file: '03 hero', editor: 'content', fingerprint: 'MODULE 03 —', find: '<!-- ═══ MODULE 03 — Hero', what: 'Hero heading and intro' },
        { file: '05 results + banners', editor: 'content', fingerprint: 'MODULE 05 —', find: '<!-- ═══ MODULE 05 — Results bar + sidebar + product list', what: 'Results bar, filters, banner slots. Banner images and alt text are in 09 banner.' },
        { file: '06 tax note', editor: 'content', fingerprint: 'MODULE 06 —', find: '<!-- ═══ MODULE 06 — Tax deduction note', what: 'Tax deduction note' },
        { file: '07 overlays', editor: 'content', fingerprint: 'MODULE 07 —', find: '<!-- ═══ MODULE 07 — Tooltip, compare tray', what: 'Tooltip, compare tray, compare pop-up, filter sheet' },
        { file: '08 product data', editor: 'products', fingerprint: 'MODULE 08 —', find: '<!-- ═══ MODULE 08 — Product data', what: 'Ranking, plan names, tags, offers, codes, offer end dates, apply links, premiums',
          vars: [{ v: '@tags', title: 'Tags 標籤', kind: 'productTags', field: 'tags' }, { v: '@premiums', title: 'Premiums 保費', kind: 'productRates', path: 'premiums', discPath: 'discount.prices', tiersPath: 'deductibleTiers',
            excel: { expect: ['vhis'], two: true, how: 'In the VHIS RP Product Details Excel, open the "Premium" sheet, click the corner above row 1 to select the whole sheet, copy, and paste in box 1. Then do the same with the "Discounted Premium" sheet in box 2.' } }],
          note: 'Deductible levels, discount label and coverage → "Edit code directly". This module is one very long line of code, so the form is the easier way in.' },
        { file: '09 banner', editor: 'scripts', fingerprint: 'MODULE 09 —', find: '<!-- ═══ MODULE 09 — Behaviour', what: 'Top and bottom banners (image, alt text, linked plan). The rest is page behaviour.',
          vars: [{ v: 'BANNERS', title: 'Banners', kind: 'list', fields: [
            { p: 'alt', label: 'Banner text (alt) — also what screen readers and tracking use', long: true },
            { p: 'desktop', label: 'Desktop image (2592×360)' }, { p: 'mobile', label: 'Mobile image (750×375)' },
            { p: 'productId', label: 'Links to plan (id) — the banner uses that plan\'s apply link and hides after its offer ends' }] }] }
      ],
      overriddenIds: {},
      data: {
        moduleLabel: 'VHIS product data',
        arrayVar: 'DATA', arrayPath: 'products', quote: '"',
        productLabel: function (d) { return d.name || d.id; },
        productSub: function (d) { return d.insurer + (d.planType ? ' · ' + d.planType : ''); },
        logo: function () { return null; },
        // Page sorts by rank (no rank = last), then name. Ranking edits change rank numbers only.
        rank: { field: 'rank' }, rankOnly: true,
        displayOrder: function (list) {
          return list.slice().sort(function (a, b) { var ra = a.rank == null ? Infinity : a.rank, rb = b.rank == null ? Infinity : b.rank; return ra - rb || String(a.name).localeCompare(String(b.name)); });
        },
        fields: [
          { path: 'name', label: '計劃名稱', group: 'Product', type: 'text' },
          { path: 'tags', label: 'Tags 標籤', group: 'Product', type: 'strtags' },
          { path: 'offer.text', label: '優惠內容', group: 'Offer', type: 'textarea' },
          { path: 'offer.code', label: '優惠碼 Promo code', group: 'Offer', type: 'text-null', pattern: '^[A-Za-z0-9_-]*$', patternMsg: 'Letters, numbers, - and _ only', hint: 'Leave empty if there is no code.' },
          { path: 'offer.end', label: '優惠截止 Offer ends (YYYY-MM-DD)', group: 'Offer', type: 'text-null', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$', patternMsg: 'Use YYYY-MM-DD, e.g. 2026-11-30', hint: 'The offer (and any banner linked to this plan) hides after this date.' },
          { path: 'url', label: '投保連結 Apply link', group: 'Link', type: 'url' },
          // edited in the Premiums tab; listed so the change summary shows each changed cell
          { path: 'premiums', label: 'Premium', type: 'table', hidden: true },
          { path: 'discount.prices', label: 'First-year discounted premium', type: 'table', hidden: true }
        ],
        tableFields: ['premiums', 'discount.prices'],
        required: ['id', 'providerId', 'insurer', 'name', 'url'],
        urlFields: ['url'],
        expiryFields: ['offer.end']
      }
    }
  ];

  var api = { PAGES: PAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTPages = api;
})(typeof window !== 'undefined' ? window : globalThis);
