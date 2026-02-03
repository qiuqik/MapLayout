/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: colors.gray[200],
        input: colors.gray[100],
        ring: colors.indigo[500],
        background: colors.white,
        foreground: colors.gray[900],
        muted: colors.gray[100],
        primary: {
          DEFAULT: colors.indigo[500],
          foreground: colors.white,
        },
        secondary: {
          DEFAULT: colors.teal[500],
          foreground: colors.white,
        },
        destructive: {
          DEFAULT: colors.red[600],
          foreground: colors.white,
        },
      },
    },
  },
  plugins: [],
}