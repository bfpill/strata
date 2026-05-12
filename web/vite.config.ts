import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

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
      return html.replace(/<script[^>]*src="\/?@vite\/client[^"]*"[^>]*><\/script>\s*/g, '');
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), stripHmrFromMdxFrame],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@noisy-tm/ui/src/InteractiveNoisyTM.css': path.resolve(__dirname, './src/stubs/empty.css'),
      '@noisy-tm/ui/src/TMTrajectory.css': path.resolve(__dirname, './src/stubs/empty.css'),
      '@noisy-tm/ui/src/styles.css': path.resolve(__dirname, './src/stubs/empty.css'),
      '@noisy-tm/ui': path.resolve(__dirname, './src/stubs/noisy-tm-ui.ts'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  server: {
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
