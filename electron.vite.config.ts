import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const sharedAlias = {
  "@shared": resolve(__dirname, "src/shared"),
};

/** Prefer TypeScript sources so accidental tsc .js emit next to .ts is ignored. */
const tsFirstExtensions = [".ts", ".mts", ".tsx", ".mjs", ".js", ".jsx", ".json"];

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias, extensions: tsFirstExtensions },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    resolve: { alias: sharedAlias, extensions: tsFirstExtensions },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
      extensions: tsFirstExtensions,
    },
    plugins: [react(), tailwindcss()],
  },
});
