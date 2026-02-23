import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const portlessBase = process.env.PORTLESS_BASE?.trim();
const portlessApiHost = portlessBase ? `${portlessBase}-api.localhost:1355` : null;
const apiHttpTarget = portlessBase
  ? 'http://127.0.0.1:1355'
  : 'http://localhost:4877';
const apiWsTarget = portlessBase
  ? 'ws://127.0.0.1:1355'
  : 'ws://localhost:4877';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT) || 4873,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiHttpTarget,
        changeOrigin: true,
        headers: portlessApiHost
          ? {
              Host: portlessApiHost,
            }
          : undefined,
      },
      '/ws': {
        target: apiWsTarget,
        changeOrigin: true,
        ws: true,
        headers: portlessApiHost
          ? {
              Host: portlessApiHost,
            }
          : undefined,
      },
    },
  },
});
