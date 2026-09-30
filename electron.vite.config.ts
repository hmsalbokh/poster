import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: { input: { index: resolve(__dirname, "electron/main.ts") } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: { input: { index: resolve(__dirname, "electron/preload.ts") } }
    }
  },
  renderer: {
    plugins: [react()],
    root: ".",
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: { index: resolve(__dirname, "index.html") } }
    }
  }
});
