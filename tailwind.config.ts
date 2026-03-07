import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Explicitly specify for faster content scanning
    "./src/ui/**/*.{js,ts,jsx,tsx}",
    "./src/ui/pages/**/*.{js,ts,jsx,tsx}",
    "./src/ui/components/**/*.{js,ts,jsx,tsx}",
  ],
  // Enable safelist for dynamic classes if needed (helps with JIT)
  safelist: [],
  theme: {
    extend: {
      colors: {
        panel: {
          900: "#11151b",
          800: "#171d25",
          700: "#222b36",
        },
        accent: {
          500: "#2ca6ff",
          400: "#53b5ff",
        },
      },
      boxShadow: {
        depth: "0 18px 48px rgba(0, 0, 0, 0.45)",
        panel: "0 10px 30px rgba(0, 0, 0, 0.35)",
      },
      fontFamily: {
        sans: ["Segoe UI Variable", "Segoe UI", "Noto Sans", "sans-serif"],
      },
    },
  },
  // Disable dark mode class detection for faster builds
  darkMode: "class",
  plugins: [],
} satisfies Config;
