import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#090a0b",
          900: "#101214",
          850: "#15181b",
          800: "#1b1f23",
          700: "#293038",
          400: "#8b96a3",
          200: "#d7dde5",
        },
        signal: {
          green: "#55d979",
          cyan: "#5ec8d8",
          amber: "#f4bd50",
          red: "#f46b6b",
        },
      },
      boxShadow: {
        surface: "0 0 0 1px rgba(255,255,255,0.08)",
        "surface-hover": "0 0 0 1px rgba(255,255,255,0.13)",
      },
      fontFamily: {
        sans: ["Aptos", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Cascadia Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
