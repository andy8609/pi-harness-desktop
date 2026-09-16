import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const sharedAlias = {
  "@shared": resolve(__dirname, "src/shared"),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
