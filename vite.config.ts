import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Link previews need absolute image URLs. Vercel tells the build its production domain; SITE_URL overrides it.
const site = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'absolute-preview-image',
      transformIndexHtml: (html: string) => html.replace('property="og:image" content="/', `property="og:image" content="${site}/`),
    },
  ],
  server: { port: 5173 },
});
