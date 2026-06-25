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
      // Semantic tokens are backed by CSS variables (space-separated RGB
      // channels) defined in styles.css, so `bg-bg`, `text-ink`, `bg-accent/10`,
      // etc. resolve through the active theme. `:root` = light, `.dark` = dark.
      colors: {
        bg: {
          DEFAULT: "rgb(var(--c-bg) / <alpha-value>)",
          raised: "rgb(var(--c-bg-raised) / <alpha-value>)",
          panel: "rgb(var(--c-bg-panel) / <alpha-value>)",
          hover: "rgb(var(--c-bg-hover) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--c-border) / <alpha-value>)",
          subtle: "rgb(var(--c-border-subtle) / <alpha-value>)",
          strong: "rgb(var(--c-border-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          muted: "rgb(var(--c-ink-muted) / <alpha-value>)",
          faint: "rgb(var(--c-ink-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          hover: "rgb(var(--c-accent-hover) / <alpha-value>)",
          soft: "rgb(var(--c-accent-soft) / <alpha-value>)",
        },
        success: "rgb(var(--c-success) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        thinking: "rgb(var(--c-thinking) / <alpha-value>)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        glow: "var(--shadow-glow)",
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
        // AGE-699 Live Dot: a running dot emits an expanding ring in its
        // workspace glow. The ring color is per-workspace, so it reads the
        // `--omp-glow` custom property the dot sets inline.
        ompPulse: {
          "0%": { boxShadow: "0 0 0 0 var(--omp-glow, transparent)" },
          "70%": { boxShadow: "0 0 0 5px transparent" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
        // AGE-699 Live Dot: a 1.3s opacity blink for "running…" affordances.
        ompBlink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "pulse-slow": "pulse 1.6s ease-in-out infinite",
        "omp-pulse": "ompPulse 1.8s infinite",
        "omp-blink": "ompBlink 1.3s infinite",
      },
    },
  },
  plugins: [],
};
