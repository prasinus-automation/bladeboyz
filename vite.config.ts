import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    // Dev: the game server (npm run dev:server) listens on 3004; proxying
    // /ws keeps the client same-origin in every environment (production
    // serves bundle + WS from one Node process — docs/networking/01).
    proxy: {
      '/ws': {
        target: 'ws://localhost:3004',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
