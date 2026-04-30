/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // FIX: usar `class` strategy para que `dark:` modifiers respondan a `html.dark`
  // (el toggle de tema del app), no a `prefers-color-scheme` del SO.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#edfff7",
          100: "#d5ffee",
          400: "#3dffa0",
          500: "#00d97e",
          600: "#00b065",
        },
        dark: {
          900: "#090b11",
          800: "#101318",
          700: "#171b24",
          600: "#1e2330",
          500: "#252b3a",
          border: "#1f2636",
        },
      },
      fontFamily: {
        sans: ["var(--font-outfit)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
    },
  },
  plugins: [],
};
