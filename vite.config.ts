import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true, allowedHosts: true },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
