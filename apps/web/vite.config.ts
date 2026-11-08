import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = Number(process.env.ORGWATCH_APP_PORT || 18080);
const apiTarget = `http://127.0.0.1:${Number.isFinite(apiPort) ? apiPort : 18080}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
