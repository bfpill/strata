import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Strip Vite's @vite/client (HMR websocket + location.reload) from mdx-frame.html.
 *  Sandboxed iframes (null origin) can't perform same-origin navigations,
 *  so HMR's location.reload() throws "Unsafe attempt to load URL X from
 *  frame with URL X". The @react-refresh preamble is left intact —
 *  plugin-react's TSX transform requires the $RefreshReg$ globals at
 *  module load time, even if we never trigger a refresh. */
const stripHmrFromMdxFrame: Plugin = {
  name: 'mdx-frame-no-hmr',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const isMdxFrame =
        ctx.path === '/mdx-frame.html' ||
        ctx.path?.startsWith('/mdx-frame.html?') ||
        ctx.filename.endsWith('mdx-frame.html');
      if (!isMdxFrame) return html;
      // Only strip @vite/client; keep the @react-refresh preamble.
      return html.replace(/<script[^>]*src="\/?@vite\/client[^"]*"[^>]*><\/script>\s*/g, '');
    },
  },
};

export default defineConfig({
  plugins: [react(), stripHmrFromMdxFrame],
  resolve: {
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  server: {
    // Allow the sandboxed mdx-frame iframe (null origin) to fetch dev modules.
    cors: { origin: '*' },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        mdxFrame: path.resolve(__dirname, 'mdx-frame.html'),
      },
      output: {
        manualChunks: {
          plotly: ['plotly.js/dist/plotly'],
        },
      },
    },
  },
})
