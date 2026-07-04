// SPDX-License-Identifier: AGPL-3.0-only
// Browser preview of PageDetail with Tauri APIs mocked (fixtures, no daemon).
// Run: pnpm exec vite --config vite.preview.config.ts
// Open: http://localhost:1421/preview/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const mock = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@tauri-apps/api/core": mock("./preview/mocks/core.ts"),
      "@tauri-apps/plugin-shell": mock("./preview/mocks/shell.ts"),
    },
  },
  server: {
    port: 1421,
    strictPort: true,
    open: false,
    watch: { ignored: ["**/app/**"] },
  },
});
