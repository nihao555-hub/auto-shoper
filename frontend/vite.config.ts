import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The production site is mounted under /auto-shoper/ behind nginx.
  base: "/auto-shoper/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    allowedHosts: [".devinapps.com"],
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
