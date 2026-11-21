import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The app ships two pages: the output (index.html) and the controller window.
  build: {
    rollupOptions: {
      input: { main: "index.html", controller: "controller.html" },
    },
  },
  // The verify harness runs its own server next to `npm run dev:web`; a
  // separate dependency cache keeps the two from invalidating each other.
  // @ts-expect-error process is a nodejs global
  cacheDir: process.env.SONORA_VITE_CACHE || 'node_modules/.vite',
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // @ts-expect-error process is a nodejs global
    hmr: process.env.SONORA_VITE_CACHE ? false : host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // The verify / media harness must never reload mid-render when a source
    // file changes: no file watching or HMR for its server.
    // @ts-expect-error process is a nodejs global
    watch: process.env.SONORA_VITE_CACHE ? null : {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/target/**", "**/media/**", "**/verify/**", "**/local-media/**", "**/site/**"],
    },
  },
}));
