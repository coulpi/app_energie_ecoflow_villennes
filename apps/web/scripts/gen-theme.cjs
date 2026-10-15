// Usage : node scripts/gen-theme.cjs . app/theme-colors.css (depuis apps/web)
// Génère app/theme-colors.css : palettes Tailwind exposées en variables CSS,
// valeurs d'origine en sombre (.dark) et échelle inversée en clair (:root).
const path = require("path");
const colors = require(path.resolve(process.argv[2], "node_modules/tailwindcss/colors"));
const out = process.argv[3];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const PALETTES = ["emerald", "rose", "amber", "sky", "cyan", "violet", "red", "orange", "blue"];
const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};
// Inversion clair : les tons pâles (texte sur fond sombre) deviennent foncés
// et inversement ; 500/600 (aplats, boutons) restent identiques.
const LIGHT_STEP = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 600, 700: 300, 800: 200, 900: 100, 950: 50 };
// Neutres clairs (slate) choisis par rôle : texte → bordures → surfaces.
const ZINC_LIGHT = {
  50: "#0b1220", 100: "#0f172a", 200: "#1e293b", 300: "#334155", 400: "#475569",
  500: "#64748b", 600: "#94a3b8", 700: "#cbd5e1", 800: "#e2e8f0", 900: "#f1f5f9", 950: "#f4f6fb",
};
let dark = "", light = "";
for (const s of STEPS) {
  dark += `  --c-zinc-${s}: ${rgb(colors.zinc[s])};\n`;
  light += `  --c-zinc-${s}: ${rgb(ZINC_LIGHT[s])};\n`;
}
for (const p of PALETTES) {
  for (const s of STEPS) {
    dark += `  --c-${p}-${s}: ${rgb(colors[p][s])};\n`;
    light += `  --c-${p}-${s}: ${rgb(colors[p][LIGHT_STEP[s]])};\n`;
  }
}
dark += "  --c-white: 255 255 255;\n";
light += "  --c-white: 15 23 42;\n";
const css = `/* Généré par apps/web/scripts/gen-theme.cjs (palettes Tailwind → variables CSS).
 * Clair = :root (défaut), sombre = .dark. Ne pas éditer à la main :
 * les classes Tailwind existantes (text-zinc-100, bg-white/[0.03]…)
 * s'adaptent ainsi automatiquement au thème. */
:root {
${light}}
.dark {
${dark}}
`;
require("fs").writeFileSync(out, css);
console.log("ok", css.split("\n").length, "lines");
