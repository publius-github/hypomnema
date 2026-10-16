import { defineConfig, mergeConfig } from "vite";
import base from "../vite.config";

// The e2e build: the app bundle behind e2e/app/index.html, which loads
// the fake core before the app. Built once and served with
// `vite preview`, so a test run starts in seconds and exercises the
// same production bundle the installer ships.
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: "dist-e2e",
      emptyOutDir: true,
      rollupOptions: { input: "e2e/app/index.html" },
    },
    preview: { port: 1430, strictPort: true },
  }),
);
