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
    path: '/privacy/',
    out: 'privacy/index.html',
    source: 'privacy',
    title: 'Privacy Policy — FemFast',
    description:
      'What FemFast collects, why, and the control you keep over it. Your cycle and well-being data is never sold and never shared.',
    priority: '0.3',
    changefreq: 'yearly',
  },
  {
    path: '/terms/',
    out: 'terms/index.html',
    source: 'terms',
    title: 'Terms of Use — FemFast',
    description:
      'The terms that apply when you use the FemFast app and website, including subscriptions, refunds and acceptable use.',
    priority: '0.3',
    changefreq: 'yearly',
  },
];

// Old Tilda paths that may still be linked from the App Store listing or
// elsewhere. /404.html maps these to their new homes; each also gets a
// meta-refresh stub so the redirect works even where 404.html is not served.
// NOTE: this list is a best guess at Tilda's common spellings — the live site
// could not be crawled to confirm. Add any real paths once they are known.
export const redirects = {
  '/privacy-policy': '/privacy/',
  '/privacy-policy/': '/privacy/',
  '/privacypolicy': '/privacy/',
  '/policy': '/privacy/',
  '/terms-of-use': '/terms/',
  '/terms-of-use/': '/terms/',
  '/termsofuse': '/terms/',
  '/terms-and-conditions': '/terms/',
  '/contacts': '/contact/',
  '/contacts/': '/contact/',
  '/support': '/help/',
  '/faq': '/help/',
};
