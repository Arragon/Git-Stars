/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // Semantic tokens — defined once in src/index.css, theme-aware via the
        // `.dark` class. Page code should prefer these over raw grays.
        canvas: "var(--c-canvas)",
        surface: "var(--c-surface)",
        subtle: "var(--c-subtle)",
        side: "var(--c-side)",
        ink: "var(--c-ink)",
        muted: "var(--c-muted)",
        line: {
          DEFAULT: "var(--c-line)",
          strong: "var(--c-line-strong)",
        },
        brand: {
          DEFAULT: "var(--c-brand)",
          hover: "var(--c-brand-hover)",
          soft: "var(--c-brand-soft)",
          text: "var(--c-brand-text)",
          contrast: "var(--c-brand-contrast)",
        },
        gold: {
          DEFAULT: "var(--c-gold)",
          soft: "var(--c-gold-soft)",
        },
        ai: {
          DEFAULT: "var(--c-ai)",
          soft: "var(--c-ai-soft)",
        },
        info: {
          DEFAULT: "var(--c-info)",
          soft: "var(--c-info-soft)",
        },
        danger: {
          DEFAULT: "var(--c-danger)",
          soft: "var(--c-danger-soft)",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        "card-hover": "0 4px 12px -2px rgb(0 0 0 / 0.08)",
        overlay: "0 12px 40px rgb(22 32 43 / 0.13)",
      },
      width: {
        side: "var(--side-width, 216px)",
      },
    },
  },
  plugins: [],
};
