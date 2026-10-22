import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and no auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // the Rust side is Tauri's to watch: cargo rewriting target/ under
    // Vite's watcher crashes the dev server on Windows (EBUSY)
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    // The editor core (@codemirror/view alone is half of it) is one
    // indivisible chunk a little over Vite's default 500 kB; the bundle
    // loads from disk, so the limit only has to catch a chunk growing
    // by accident.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // the editor core and the React/Tauri runtime change only with
        // their own dependencies and sit in their own chunks; the
        // language modes stay lazy chunks of their own, loaded on first
        // use of a fenced block in that language
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(@codemirror\/(state|view|language|autocomplete|commands|lint|search|lang-markdown|lang-yaml)|@lezer\/(common|highlight|lr|markdown|yaml)|codemirror|style-mod|w3c-keyname|crelt)\//.test(id)) return "codemirror";
          if (/\/node_modules\/(react|react-dom|scheduler|@tauri-apps|@dnd-kit)\//.test(id)) return "runtime";
          return undefined;
        },
      },
    },
  },
});
