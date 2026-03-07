import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
    // Performance optimizations
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Split React and its dependencies into a separate chunk
          "react-vendor": ["react", "react-dom"],
          // Split Radix UI components
          "radix-vendor": ["@radix-ui/themes"],
          // Split Tauri API
          "tauri-vendor": ["@tauri-apps/api", "@tauri-apps/plugin-dialog"],
        },
      },
    },
    // Enable chunk size warnings
    chunkSizeWarningLimit: 500,
    // Disable.terser for faster builds (esbuild is faster)
    // Uses esbuild for minification by default
  },
  // Enable filesystem caching for faster rebuilds
  cacheDir: "node_modules/.vite",
  // Optimize dependencies
  optimizeDeps: {
    include: ["react", "react-dom", "@radix-ui/themes", "@tauri-apps/api"],
    // Speed up dependency pre-bundling
    esbuildOptions: {
      // Enable platform-specific optimizations
      target: "esnext",
    },
  },
});
