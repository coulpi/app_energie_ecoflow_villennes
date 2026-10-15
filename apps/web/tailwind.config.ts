import type { Config } from "tailwindcss";

// Palettes adossées aux variables CSS de app/theme-colors.css : chaque
// classe (text-zinc-100, bg-emerald-900/40, border-white/[0.07]…) prend
// sa valeur claire ou sombre selon la classe `dark` sur <html>.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const PALETTES = [
  "zinc",
  "emerald",
  "rose",
  "amber",
  "sky",
  "cyan",
  "violet",
  "red",
  "orange",
  "blue",
];
const themed = Object.fromEntries(
  PALETTES.map((p) => [
    p,
    Object.fromEntries(
      STEPS.map((s) => [s, `rgb(var(--c-${p}-${s}) / <alpha-value>)`]),
    ),
  ]),
);

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ...themed,
        white: "rgb(var(--c-white) / <alpha-value>)",
        accent: {
          DEFAULT: "#10b981",
          dark: "#059669",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
