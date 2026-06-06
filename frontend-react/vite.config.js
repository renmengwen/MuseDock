import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@': src,
    },
  },
  build: {
    outDir: '../frontend-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
