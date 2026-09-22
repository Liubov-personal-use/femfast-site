// Site-wide metadata. Every <head> the build emits comes from here.
//
// tildaMetaCaptured: the live Tilda site could not be reached from the build
// environment (egress policy), so the homepage title/description below are
// FemFast-authored fallbacks, not the live values. See /legal/tilda-meta.txt
// for how to capture the real ones. When you do, replace `title` and
// `description` on the `/` route — but only after checking they contain
// neither "diet" nor "weight loss".
export const tildaMetaCaptured = false;

export const site = {
  domain: 'femfast.io',
  origin: 'https://femfast.io',
  name: 'FemFast',
  locale: 'en',
  twitter: '@femfast',
  // Falls back to the lockup until a purpose-made share image exists.
  ogImage: '/assets/og-default.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  appStoreUrl: 'https://apps.apple.com/pl/app/femfast-hormonal-weight-loss/id6744979369',
};

// Route order here is the order used in sitemap.xml.
export const routes = [
  {
    path: '/',
    out: 'index.html',
    source: 'landing',
    title: 'FemFast — Daily guidance built around your cycle',
    description:
      'Fasting windows, food, training and supplements that change with your cycle phase. Built for women with PCOS and endometriosis. Free 60-second check-in.',
    priority: '1.0',
    changefreq: 'weekly',
    // the hero phone screenshot is the LCP element; tell the browser early
    preloadImage: '/assets/screen-dashboard.webp',
  },
  {
    path: '/checkin/',
    out: 'checkin/index.html',
    source: 'checkin',
    title: 'The 60-second check-in — FemFast',
    description:
      "Six questions. Then the fasting window, food and training that fit the phase you're in today. Free, no signup, nothing saved.",
    priority: '0.9',
    changefreq: 'monthly',
  },
  {
    path: '/help/',
    out: 'help/index.html',
    source: 'help',
    title: 'Help — FemFast',
    description:
      'How FemFast builds your daily plan, how fasting adapts to your cycle phase, and how to reach us when you need a person.',
    priority: '0.6',
    changefreq: 'monthly',
  },
  {
    path: '/contact/',
    out: 'contact/index.html',
    source: 'contact',
    title: 'Contact — FemFast',
    description:
      'Reach the FemFast team — support, press and business enquiries, and our registered business address.',
    priority: '0.5',
    changefreq: 'yearly',
  },
  {
    // The App Store listing points at https://femfast.io/privacypolicy and
    // those fields are not changing, so this is the canonical address — not a
    // redirect to somewhere prettier. `alsoAt` publishes the same page as
    // privacypolicy.html as well, so the extensionless URL Apple links to
    // answers 200 directly instead of 301-ing to the trailing-slash form.
    path: '/privacypolicy',
    out: 'privacypolicy/index.html',
    alsoAt: 'privacypolicy.html',
    source: 'privacy',
    title: 'Privacy Policy — FemFast',
    description:
      'What FemFast collects, why, and the control you keep over it. Your cycle and well-being data is never sold and never shared.',
    priority: '0.3',
    changefreq: 'yearly',
  },
  {
    // Same again: https://femfast.io/termsofuse is the live App Store address.
    path: '/termsofuse',
    out: 'termsofuse/index.html',
    alsoAt: 'termsofuse.html',
    source: 'terms',
    title: 'Terms of Use — FemFast',
    description:
      'The terms that apply when you use the FemFast app and website, including subscriptions, refunds and acceptable use.',
    priority: '0.3',
    changefreq: 'yearly',
  },
];

// The only two redirects the site has.
//
// /privacy/ and /terms/ were this site's own paths for a while, so anything
// that linked them in the meantime still resolves. Everything else that used
// to live here was guesswork at Tilda's spellings and has been removed —
// including /privacypolicy and /termsofuse, which are now real pages and
// would have been shadowed by a redirect stub at the same path.
//
// Each key gets a meta-refresh stub page, and /404.html maps the same table
// so a path lands correctly even where the stub is not served.
export const redirects = {
  '/privacy/': '/privacypolicy',
  '/terms/': '/termsofuse',
};
