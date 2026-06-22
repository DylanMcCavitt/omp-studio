import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const shared = resolve(__dirname, "src/shared");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": shared },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": shared },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // Sandboxed preload scripts (sandbox:true in src/main/index.ts) must be
        // CommonJS — Electron cannot load an ESM preload in a sandboxed context.
        // The package is `"type":"module"`, so force CJS output with a `.cjs`
        // extension to override that default; inlineDynamicImports keeps the
        // sandbox-safe single-file bundle (no runtime require of local chunks).
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          inlineDynamicImports: true,
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@shared": shared,
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
