// @ts-check
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import fs from 'node:fs';

const site = process.env.PUBLIC_SITE_URL || 'https://dropzy.app';

// App shells and private pages are excluded from the sitemap (§15). A prefix matches the path
// itself and anything under it: '/s' covers /s and /s/{token}.
const PRIVATE = ['/s', '/r', '/f', '/j', '/join', '/private', '/room', '/admin'];
const isPrivate = (/** @type {string} */ path) => PRIVATE.some((p) => path === p || path.startsWith(`${p}/`));

/** Guides carry their own "updated" date; everything else gets the build date. */
const guideDates = Object.fromEntries(
  fs
    .readdirSync(new URL('./src/content/guides/', import.meta.url))
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => {
      const m = /^updated:\s*['"]?([^'"\s]+)/m.exec(fs.readFileSync(new URL(`./src/content/guides/${f}`, import.meta.url), 'utf8'));
      const d = m ? new Date(m[1]) : null;
      // A date that doesn't parse falls back to the build date rather than failing the build.
      return [`/guides/${f.replace(/\.mdx$/, '')}`, d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined];
    }),
);

/** Mirror vercel.json rewrites in `astro dev` so /s/{token} etc. load their static shells. */
/** @type {import('astro').AstroIntegration} */
const devRewrites = {
  name: 'dz-dev-rewrites',
  hooks: {
    'astro:server:setup': ({ server }) => {
      server.middlewares.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {() => void} */ next) => {
        const m = /^\/(s|r|f|j)\/[^/?#]+\/?(\?.*)?$/.exec(req.url || '');
        if (m) req.url = `/${m[1] === 'j' ? 'join' : m[1]}${m[2] || ''}`;
        next();
      });
    },
  },
};

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { inlineStylesheets: 'always', format: 'directory' },
  prefetch: false,
  devToolbar: { enabled: false },
  integrations: [
    devRewrites,
    react(),
    mdx(),
    sitemap({
      filter: (page) => !isPrivate(new URL(page).pathname),
      serialize: (item) => ({ ...item, lastmod: guideDates[new URL(item.url).pathname] ?? new Date().toISOString() }),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          // Fewer requests per visit (§4.4): React and the shared app code load as one file;
          // QR, ZIP, direct transfer and the OPFS worker stay lazy.
          manualChunks(id) {
            if (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'app';
            if (/[\/]src[\/](lib|strings|components[\/]share)[\/]/.test(id) && !/[\/]lib[\/](direct|sink[\/]opfs)/.test(id)) return 'app';
            if (/packages[\/]shared[\/]/.test(id)) return 'app';
          },
        },
      },
    },
  },
});
