import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4873,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:4877",
      "/ws": {
        target: "ws://localhost:4877",
        ws: true,
      },
    },
  },
});
