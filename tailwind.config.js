/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        // Sleek dark cockpit palette.
        bg: {
          DEFAULT: "#0b0d12",
          raised: "#11141b",
          panel: "#151925",
          hover: "#1b2030",
        },
        border: {
          DEFAULT: "#222838",
          subtle: "#1a1f2c",
          strong: "#2c3346",
        },
        ink: {
          DEFAULT: "#e6e9f0",
          muted: "#9aa3b8",
          faint: "#6b7488",
        },
        accent: {
          DEFAULT: "#6d8cff",
          hover: "#84a0ff",
          soft: "#1c2438",
        },
        success: "#4ade80",
        warn: "#fbbf24",
        danger: "#f87171",
        thinking: "#a78bfa",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.25)",
        glow: "0 0 0 1px rgba(109,140,255,0.35), 0 8px 30px rgba(109,140,255,0.15)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "pulse-slow": "pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
