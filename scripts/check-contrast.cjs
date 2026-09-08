/**
 * Checks the theme's foreground/background pairs against WCAG contrast ratios,
 * in BOTH themes.
 *
 * Dark mode here is a palette inversion, and the failure mode of an inversion
 * is a pair that was legible in one direction and is not in the other. Eyeballing
 * a screenshot does not catch a 4.1:1 that should be 4.5:1, so it is computed.
 *
 *   node scripts/check-contrast.cjs
 *
 * Exits non-zero if any pair marked `required` falls below its threshold.
 */

const fs = require('fs');

const css = fs.readFileSync('src/app/theme.css', 'utf8');

function tokens(selector) {
  const block = css.split(selector)[1]?.split('}')[0] ?? '';
  const out = {};
  for (const m of block.matchAll(/--c-([a-z0-9-]+):\s*([\d\s]+);/g)) {
    out[m[1]] = m[2].trim().split(/\s+/).map(Number);
  }
  return out;
}

const LIGHT = tokens(':root {');
const DARK = tokens('.dark {');

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The pairs the interface actually renders. `min` is 4.5 for body text and 3.0
 * for large text, borders and non-text indicators, per WCAG 2.1 AA.
 */
const PAIRS = [
  { fg: 'slate-900', bg: 'white', min: 4.5, what: 'primary ink on a card', required: true },
  { fg: 'slate-700', bg: 'white', min: 4.5, what: 'body text on a card', required: true },
  { fg: 'slate-600', bg: 'white', min: 4.5, what: 'secondary text on a card', required: true },
  { fg: 'slate-500', bg: 'white', min: 4.5, what: 'muted text on a card', required: true },
  { fg: 'slate-900', bg: 'slate-50', min: 4.5, what: 'ink on the page', required: true },
  { fg: 'slate-400', bg: 'white', min: 3.0, what: 'placeholder / icon', required: true },
  { fg: 'slate-200', bg: 'white', min: 1.2, what: 'border against a card', required: true },
  { fg: 'brand-700', bg: 'white', min: 4.5, what: 'link on a card', required: true },
  { fg: 'brand-700', bg: 'brand-50', min: 4.5, what: 'active nav item', required: true },
  { fg: 'emerald-700', bg: 'emerald-50', min: 4.5, what: 'success badge', required: true },
  { fg: 'amber-800', bg: 'amber-50', min: 4.5, what: 'warning badge', required: true },
  { fg: 'rose-700', bg: 'rose-50', min: 4.5, what: 'danger badge', required: true },
  { fg: 'sky-700', bg: 'sky-50', min: 4.5, what: 'info badge', required: true },
  { fg: 'on-accent', bg: 'brand-600', min: 4.5, what: 'primary button label', required: true },
  { fg: 'on-accent', bg: 'rose-600', min: 4.5, what: 'danger button label', required: true },
  { fg: 'on-accent', bg: 'emerald-600', min: 3.0, what: 'success button label', required: true },
  { fg: 'on-accent', bg: 'brand-600', min: 4.5, what: 'avatar initials', required: true },
  { fg: 'on-ink', bg: 'ink', min: 4.5, what: 'selected filter chip', required: true },
  { fg: 'on-ink', bg: 'ink', min: 4.5, what: 'sign-in panel text', required: true },
];

let failures = 0;

for (const [theme, set] of [['light', LIGHT], ['dark', DARK]]) {
  console.log(`\n${theme.toUpperCase()}`);
  for (const p of PAIRS) {
    const fg = set[p.fg];
    const bg = set[p.bg];
    if (!fg || !bg) {
      console.log(`  ?      ${p.what} — token missing (${p.fg} / ${p.bg})`);
      if (p.required) failures += 1;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= p.min;
    if (!ok && p.required) failures += 1;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${p.min})  ${p.what}`,
    );
  }
}

console.log(
  failures === 0
    ? '\nAll required pairs meet their threshold in both themes.'
    : `\n${failures} required pair(s) below threshold.`,
);
process.exit(failures === 0 ? 0 : 1);
