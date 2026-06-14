import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        // Neutral, slightly warm dark ramp. 950 = page canvas, 900 = card surface,
        // 850 = raised / hover, lighter steps for text. Not pure black.
        ink: {
          950: "#0b0c0f",
          925: "#101216",
          900: "#15171c",
          850: "#1b1e24",
          800: "#23262e",
          700: "#2d313a",
          600: "#3a3f49",
          500: "#69727f",
          400: "#949dab",
          300: "#b8c0cb",
          200: "#dde2e9",
        },
        // Semantic signal colors — reserved for status only. Calmer than neon.
        signal: {
          green: "#4fbe7b",
          cyan: "#56b8cf",
          amber: "#e0aa57",
          red: "#e8716e",
        },
      },
      borderRadius: {
        none: "0px",
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px",
        full: "9999px",
      },
      boxShadow: {
        surface: "0 0 0 1px rgba(255,255,255,0.055)",
        "surface-hover": "0 0 0 1px rgba(255,255,255,0.10)",
        card: "0 0 0 1px rgba(255,255,255,0.05), 0 1px 1px rgba(0,0,0,0.45), 0 12px 32px -18px rgba(0,0,0,0.8)",
        popover: "0 0 0 1px rgba(255,255,255,0.08), 0 22px 56px -18px rgba(0,0,0,0.78)",
        "primary-glow": "0 0 0 1px rgba(86,184,207,0.35), 0 8px 22px -10px rgba(86,184,207,0.45)",
      },
      fontFamily: {
        sans: ["Aptos", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Cascadia Mono", "Consolas", "monospace"],
      },
      fontSize: {
        meta: ["10.5px", { lineHeight: "1.2", letterSpacing: "0.12em" }],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.32s cubic-bezier(0.2,0,0,1) both",
        "pulse-dot": "pulse-dot 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
