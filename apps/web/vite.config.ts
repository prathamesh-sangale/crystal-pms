import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev, so there is no CORS preflight on every request
      // and the token header behaves exactly as it will in production.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  // The shared package is TypeScript source, not a built artefact.
  optimizeDeps: { exclude: ['@pms/shared'] },
  build: { sourcemap: true },
});
