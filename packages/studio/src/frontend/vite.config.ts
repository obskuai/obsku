import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  build: {
    lib: {
      entry: resolve(__dirname, 'main.tsx'),
      name: 'StudioFrontend',
      fileName: 'studio-frontend',
      formats: ['es'],
    },
    outDir: resolve(__dirname, '../../../dist/frontend'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
