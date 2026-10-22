import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rolldownOptions: {
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
  },
});
