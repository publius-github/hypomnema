/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--color-surface-alt) / <alpha-value>)",
        content: "rgb(var(--color-content) / <alpha-value>)",
        "content-muted": "rgb(var(--color-content-muted) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
