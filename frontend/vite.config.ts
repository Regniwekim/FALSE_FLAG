import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [
    react(),
    viteCompression({
      algorithm: "brotliCompress",
      ext: ".br",
      threshold: 10240,
      deleteOriginFile: false
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    exclude: ["e2e/**"]
  }
});
