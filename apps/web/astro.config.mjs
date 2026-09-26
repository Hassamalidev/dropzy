// @ts-check
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const site = process.env.PUBLIC_SITE_URL || 'https://dropzy.app';

// App shells and private pages are excluded from the sitemap (§15).
const PRIVATE = ['/s/', '/r/', '/f/', '/j/', '/join', '/private', '/room/', '/admin'];

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
    sitemap({ filter: (page) => !PRIVATE.some((p) => new URL(page).pathname.startsWith(p)) }),
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
