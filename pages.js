/* ─────────────────────────────────────────────────────────────
   PCT Page Editor — page registry
   One entry per HubSpot page. Each lists its modules in paste order and
   says which ones PCT may edit. Field paths match the module's data,
   e.g. "exclusive.expiry.zh" → P[n].exclusive.expiry.zh.
   ───────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var LIFE_FIELDS = [
    { path: 'name.zh', label: '產品名稱 (中)', group: 'Product', type: 'text' },
    { path: 'name.en', label: 'Product name (EN)', group: 'Product', type: 'text' },
    { path: 'tags', label: 'Tags 標籤', group: 'Product', type: 'tags', colours: [
      { value: 't-blue', label: 'Blue' }, { value: 't-orange', label: 'Orange' }, { value: 't-green', label: 'Green' }] },
    { path: 'exclusive.text.zh', label: '優惠內容 (中)', group: 'Offer', type: 'textarea', hint: 'Line break: type <br>' },
    { path: 'exclusive.text.en', label: 'Offer text (EN)', group: 'Offer', type: 'textarea', hint: 'Line break: type <br>' },
    { path: 'exclusive.code', label: '優惠碼 Promo code', group: 'Offer', type: 'text', pattern: '^[A-Za-z0-9_-]*$', patternMsg: 'Letters, numbers, - and _ only' },
    { path: 'exclusive.expiry.zh', label: '優惠期 (中)', group: 'Offer', type: 'text', hint: 'e.g. 限時至2026年11月30日 — the tool warns when this date has passed' },
    { path: 'exclusive.expiry.en', label: 'Offer period (EN)', group: 'Offer', type: 'text', hint: 'e.g. Valid until 30 Nov 2026' },
    { path: 'url', label: '投保連結 Apply link', group: 'Link', type: 'url', hint: 'Full https:// link from the provider, including UTM' }
  ];

  var PAGES = [
    {
      key: 'life-zh', label: 'Life 人壽 (中)', status: 'live',
      liveUrl: 'https://www.moneyhero.com.hk/zh/life-insurance',
      hubspotPage: 'Life Insurance — 繁中',
      // Modules in the order they appear on the LIVE page (checked 2026-10-15 — differs from the old repo
      // _template.html: no mobile-quote-bar / category-tabs / faq-section live). HubSpot's own module numbers
      // are unknown, so PCT finds a module by its first line of code (`find`), never by number.
      // fingerprint: text that must be in the module; also how the live snapshot finds it.
      // editor: products = product forms · content = text/links/images · banner = content + add/remove banners
      //         scripts = page text + premium tables · code = direct code only. Every module also has "Edit code directly".
      modules: [
        { file: 'head', editor: 'content', fingerprint: 'Component: Head', find: '<!-- Component: Head', what: 'Browser tab title, Google description, social share text' },
        { file: 'styles', editor: 'code', fingerprint: 'HUBSPOT OVERRIDES', find: '<style> /* ── HUBSPOT OVERRIDES', what: 'Colours, spacing, layout. Code only — check the preview on phone and desktop.' },
        { file: 'hero', editor: 'content', fingerprint: 'Component: Hero Section', find: '<!-- Component: Hero Section -->', what: 'Hero heading and intro. The words shown are set in scripts › Page text.' },
        { file: 'trust-bar', editor: 'content', fingerprint: 'Component: Trust Bar', find: '<!-- Component: Trust Bar -->', what: 'Trust points under the hero (text set in scripts › Page text)' },
        { file: 'promo-banner', editor: 'banner', fingerprint: 'Component: Promo Banner', find: '<!-- Component: Promo Banner Carousel -->', what: 'Banner images, links, alt text. Add or remove banners.' },
        { file: 'sidebar-and-products', editor: 'content', fingerprint: 'Component: Quote Bar', find: '<!-- Component: Quote Bar + Sidebar + Product List', what: 'Quote bar and filter labels' },
        { file: 'compare-banner', editor: 'content', fingerprint: 'Component: Compare Banner', find: '<!-- Component: Compare Banner -->', what: 'The 先比後買 box and its banner' },
        { file: 'claims-section', editor: 'content', fingerprint: 'Component: Claims and Features', find: '<!-- Component: Claims and Features Section -->', what: 'Claims and features section' },
        { file: 'seo-content', editor: 'content', fingerprint: 'Component: SEO Content', find: '<!-- Component: SEO Content Section -->', what: 'SEO article. (The extra article text below it is a HubSpot rich-text module — edit that directly in HubSpot.)' },
        { file: 'footer-cta', editor: 'content', fingerprint: 'Component: Footer CTA', find: '<!-- Component: Footer CTA -->', what: 'Bottom call-to-action (text set in scripts › Page text)' },
        { file: 'sticky-elements', editor: 'content', fingerprint: 'Component: Sticky Elements', find: '<!-- Component: Sticky Elements', what: 'Sticky buy button, compare tray, compare pop-up' },
        { file: 'product-data', editor: 'products', fingerprint: 'PRODUCT DATA', find: '<script> /* ===== PRODUCT DATA ===== */', what: 'Ranking, product names, tags, offers, promo codes, apply links' },
        { file: 'scripts', editor: 'scripts', fingerprint: 'var PREMIUM_RATES', find: '<script> /* ===== i18n ===== */', what: 'Page text (hero, FAQ, labels) and premium tables',
          vars: [
            { v: 'T', title: 'Page text 頁面文字', kind: 'text', root: 'zh' },
            { v: 'PREMIUM_RATES', title: 'Premium table 保費表', kind: 'rates' },
            { v: 'BOWTIE_RATES', title: 'Bowtie monthly rates (per HK$1M)', kind: 'grid' }
          ] }
      ],
      // Elements whose text scripts overwrite on load → the key in scripts › Page text that really controls it.
      overriddenIds: { heroTitle: 'heroTitle', heroDesc: 'heroDesc' },
      data: {
        moduleLabel: 'Life product-data',
        arrayVar: 'P',
        productLabel: function (d) { return (d.name && (d.name.zh || d.name.en)) || d.id; },
        productSub: function (d) { return d.insurer; },
        logo: function (d) { return d.logo; },
        // Ranking on this page = order of products in P (scripts.html renders P in order).
        // rank / rankClass are kept in step for anyone reading the data.
        rank: { field: 'rank', classField: 'rankClass', classFor: function (n) { return n <= 3 ? 'rank-' + n : 'rank-other'; } },
        fields: LIFE_FIELDS,
        required: ['id', 'insurer', 'providerId', 'name.zh', 'logo', 'url'],
        urlFields: ['url', 'logo'],
        bilingualPairs: ['name', 'exclusive.text', 'exclusive.expiry'],
        requireEn: true,
        expiryFields: ['exclusive.expiry'],
        htmlTextFields: ['exclusive.text'],
        idMaps: ['SOCIAL_PROOF']
      }
    },
    { key: 'life-en', label: 'Life (EN)', status: 'soon', reason: 'Live EN page differs from the repo — Clara to resync first' },
    { key: 'osi', label: 'OSI 海外升學', status: 'soon' },
    { key: 'ci', label: 'CI 危疾', status: 'soon' },
    { key: 'vhis', label: 'VHIS 自願醫保', status: 'soon' }
  ];

  var api = { PAGES: PAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PCTPages = api;
})(typeof window !== 'undefined' ? window : globalThis);
