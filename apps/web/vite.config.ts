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
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Third-party code split out from the app's own — it changes far
        // less often than screens/components do, so a deploy that only
        // touches app code lets a returning visitor's browser skip
        // re-downloading this chunk entirely (same content hash, already
        // cached), instead of invalidating one shared ~500KB bundle on
        // every single deploy regardless of what actually changed.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          'vendor-radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-switch',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          'vendor-query': ['@tanstack/react-query', '@tanstack/react-table'],
        },
      },
    },
  },
});
