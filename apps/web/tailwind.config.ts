import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#10b981",
          dark: "#059669",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
