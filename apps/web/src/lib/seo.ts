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
};

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
