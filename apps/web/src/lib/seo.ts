import { brand } from '../strings/en';
import { SITE_URL } from './site';

// JSON-LD helpers (§15).

export const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: brand,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
};

export const webApplication = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: brand,
  url: SITE_URL,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (runs in the browser)',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description: 'Move files and text between phones and computers in the browser. No app, no account, and everything deletes itself.',
  browserRequirements: 'Requires a modern browser with JavaScript.',
  featureList: [
    'Share files and text with devices on the same Wi-Fi',
    'Send files straight to a nearby device, browser to browser',
    'End-to-end encrypted Private Share by link or QR code',
    'Rooms for groups, joined with a 6-digit code',
    'No app, no account, and everything deletes itself',
  ],
  image: `${SITE_URL}/og.png`,
};

/** Lets search engines show the site's name ("Dropzy") instead of its domain. */
export const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: brand,
  url: SITE_URL,
};

export function breadcrumbs(trail: [name: string, path: string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE_URL}${path}` })),
  };
}

export function faqPage(faq: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function article(a: { title: string; description: string; url: string; updated: Date }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    url: a.url,
    dateModified: a.updated.toISOString().slice(0, 10),
    author: { '@type': 'Organization', name: brand },
    publisher: { '@type': 'Organization', name: brand, logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.svg` } },
  };
}
