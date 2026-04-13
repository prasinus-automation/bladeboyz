import { defineConfig } from 'vite';

export default defineConfig({
  // Enable top-level await for Rapier WASM initialization
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
});
