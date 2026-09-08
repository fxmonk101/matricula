/**
 * Generates the theme token block in `src/app/globals.css`.
 *
 * WHY THIS IS GENERATED
 * ---------------------
 * Dark mode here is implemented by REDEFINING THE PALETTE rather than by
 * annotating 167 `dark:` variants across 17 files. Every colour utility in the
 * app resolves to a CSS variable, and `.dark` swaps the values.
 *
 * That works because the scales are already used semantically: 50 is the
 * lightest surface, 900 is the darkest ink, 200 is a border. Inverting the ramp
 * preserves every one of those relationships, so a card that reads
 * `bg-white text-slate-900 border-slate-200` in daylight becomes a dark card
 * with light text and a visible border at night — with no change to the markup.
 *
 * Hand-writing ~120 variable declarations twice is exactly the kind of thing
 * that acquires a typo nobody notices until one badge is unreadable, so the
 * block is generated and checked in.
 *
 *   node scripts/build-theme.cjs
 */

const fs = require('fs');

/** Tailwind's default scales, as RGB triples. */
const LIGHT = {
  white: [255, 255, 255],
  /**
   * Text and icons sitting ON a saturated fill — a primary button, a brand
   * chip, the school badge.
   *
   * Deliberately SEPARATE from `white`, and identical in both themes. They are
   * the same colour in daylight but they are not the same THING: `white` is the
   * card surface and must darken at night, whereas a label on a blue button must
   * stay white or the button becomes unreadable. Collapsing the two is exactly
   * the bug the contrast check caught — 3.31:1 on the primary button in dark
   * mode, which no screenshot would have made obvious.
   */
  onAccent: [255, 255, 255],
  /**
   * A high-contrast SOLID fill and its label — a selected filter chip, a
   * secondary submit button, the sign-in panel.
   *
   * These read as "dark block, white text" in daylight, but that is a
   * consequence of the theme, not the meaning. The meaning is "maximum
   * contrast against the page", so in dark mode the pair flips: a light block
   * with dark text. Written as `bg-slate-800 text-white` they inverted into a
   * light block with white text — 1.17:1, completely invisible, and the reason
   * the contrast check exists.
   */
  ink: [30, 41, 59],
  onInk: [255, 255, 255],
  /** Modal scrim. Stays dark in both themes; a light scrim is not a scrim. */
  scrim: [15, 23, 42],
  slate: {
    50: [248, 250, 252], 100: [241, 245, 249], 200: [226, 232, 240],
    300: [203, 213, 225], 400: [130, 145, 168], 500: [100, 116, 139],
    600: [71, 85, 105], 700: [51, 65, 85], 800: [30, 41, 59],
    900: [15, 23, 42], 950: [2, 6, 23],
  },
  emerald: {
    50: [236, 253, 245], 200: [167, 243, 208], 300: [110, 231, 183],
    600: [5, 150, 105], 700: [4, 120, 87], 800: [6, 95, 70], 900: [6, 78, 59], 950: [2, 44, 34],
  },
  amber: {
    50: [255, 251, 235], 100: [254, 243, 199], 200: [253, 230, 138],
    300: [252, 211, 77], 500: [245, 158, 11], 700: [180, 83, 9],
    800: [146, 64, 14], 900: [120, 53, 15], 950: [69, 26, 3],
  },
  rose: {
    50: [255, 241, 242], 200: [254, 205, 211], 300: [253, 164, 175],
    500: [244, 63, 94], 600: [225, 29, 72], 700: [190, 18, 60],
    800: [159, 18, 57], 900: [136, 19, 55], 950: [76, 5, 25],
  },
  sky: {
    50: [240, 249, 255], 200: [186, 230, 253], 300: [125, 211, 252],
    600: [2, 132, 199], 700: [3, 105, 161], 800: [7, 89, 133], 900: [12, 74, 110], 950: [8, 47, 73],
  },
  brand: {
    50: [238, 246, 255], 100: [217, 234, 255], 200: [188, 218, 255],
    300: [142, 195, 255], 400: [89, 161, 255], 500: [51, 125, 255],
    600: [27, 93, 245], 700: [20, 73, 225], 800: [23, 61, 182],
    900: [25, 56, 143], 950: [20, 36, 87],
  },
  gold: { 400: [245, 197, 66], 500: [224, 172, 31], 600: [187, 135, 18] },
};

/**
 * The dark ramp.
 *
 * Structural greys INVERT: what was the lightest page background becomes the
 * darkest, and what was the darkest ink becomes the lightest. `white` — the
 * card surface — becomes a raised dark surface, deliberately one step lighter
 * than the page behind it so cards still read as raised rather than as holes.
 */
const DARK_SLATE = {
  50: [2, 6, 23],      // page background — the darkest thing on screen
  100: [23, 31, 51],
  200: [45, 55, 78],   // borders: visible against the card surface, not glaring
  300: [64, 76, 100],
  400: [113, 128, 150],
  500: [148, 163, 184],
  600: [186, 199, 214],
  700: [212, 221, 232],
  800: [232, 238, 245],
  900: [246, 249, 252], // primary ink
  950: [255, 255, 255],
};
const DARK_WHITE = [17, 24, 41]; // raised card surface

/**
 * Tinted scales invert around their midpoint: the pale wash used as a badge
 * background (50) becomes a deep tint, and the saturated text colour (700)
 * becomes a light one. Without this a `bg-emerald-50 text-emerald-700` badge
 * stays a pale green block with dark green text — glaring on a dark page, and
 * the one place a naive palette inversion visibly fails.
 */
function invertTint(scale, deepBg, lightInk, midRing) {
  return {
    50: deepBg,
    100: deepBg,
    200: midRing,
    300: lightInk,
    500: scale[500] ?? scale[600],
    600: scale[600] ?? scale[500],
    700: lightInk,
    800: lightInk,
    900: lightInk,
    950: deepBg,
  };
}

const DARK = {
  white: DARK_WHITE,
  onAccent: [255, 255, 255],
  ink: [226, 232, 240],
  onInk: [15, 23, 42],
  scrim: [2, 6, 23],
  slate: DARK_SLATE,
  emerald: invertTint(LIGHT.emerald, [4, 47, 36], [110, 231, 183], [6, 95, 70]),
  amber: invertTint(LIGHT.amber, [61, 34, 8], [252, 211, 77], [146, 64, 14]),
  rose: invertTint(LIGHT.rose, [65, 10, 26], [253, 164, 175], [159, 18, 57]),
  sky: invertTint(LIGHT.sky, [8, 47, 73], [125, 211, 252], [7, 89, 133]),
  brand: {
    ...LIGHT.brand,
    // Brand keeps its hue — it is the school's colour and must stay
    // recognisable — but the pale wash and the ink swap so a brand-tinted
    // surface works on a dark page.
    50: [22, 38, 79], 100: [26, 48, 100], 200: [31, 62, 133],
    700: [142, 195, 255], 800: [188, 218, 255],
  },
  gold: { 400: [245, 197, 66], 500: [224, 172, 31], 600: [245, 197, 66] },
};

function declarations(set) {
  const out = [];
  out.push(`  --c-white: ${set.white.join(' ')};`);
  out.push(`  --c-on-accent: ${set.onAccent.join(' ')};`);
  out.push(`  --c-ink: ${set.ink.join(' ')};`);
  out.push(`  --c-on-ink: ${set.onInk.join(' ')};`);
  out.push(`  --c-scrim: ${set.scrim.join(' ')};`);
  for (const [name, scale] of Object.entries(set)) {
    if (['white', 'onAccent', 'ink', 'onInk', 'scrim'].includes(name)) continue;
    for (const [step, rgb] of Object.entries(scale)) {
      out.push(`  --c-${name}-${step}: ${rgb.join(' ')};`);
    }
  }
  return out.join('\n');
}

const block = `/* ===========================================================================
 * THEME TOKENS — GENERATED by scripts/build-theme.cjs. Do not edit by hand.
 *
 * Dark mode is implemented by redefining the palette, not by annotating every
 * component with \`dark:\` variants. The scales are already used semantically
 * (50 = lightest surface, 200 = border, 900 = ink), so inverting the ramp
 * preserves every relationship and the existing markup needs no changes.
 *
 * Plain :root / .dark rather than an @layer wrapper: this file is imported as
 * its own CSS module, where there is no @tailwind base for a layer to attach
 * to. Custom-property declarations do not need layering in any case.
 * =========================================================================== */
:root {
${declarations(LIGHT)}
}

.dark {
${declarations(DARK)}
}
`;

const path = 'src/app/theme.css';
fs.writeFileSync(path, block, 'utf8');

const count = block.split('\n').filter((l) => l.includes('--c-')).length;
console.log(`wrote ${path} — ${count} declarations`);
