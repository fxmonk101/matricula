import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The theme is generated and its contrast is computed, so both are checked here
 * rather than left to somebody's eye on a screenshot.
 *
 * This suite exists because a palette inversion has a specific failure mode: a
 * pair that is legible in one direction and not the other. Three real ones got
 * through visual review and were only caught by the arithmetic — a warning
 * badge at 2.07:1, a primary button at 3.31:1, and an avatar at 1.17:1.
 */
describe('theme tokens', () => {
  const css = readFileSync('src/app/theme.css', 'utf8');

  function tokens(selector: string): Record<string, number[]> {
    const block = css.split(selector)[1]?.split('}')[0] ?? '';
    const out: Record<string, number[]> = {};
    for (const m of block.matchAll(/--c-([a-z0-9-]+):\s*([\d\s]+);/g)) {
      out[m[1]] = m[2].trim().split(/\s+/).map(Number);
    }
    return out;
  }

  const light = tokens(':root {');
  const dark = tokens('.dark {');

  it('defines every light token in dark as well', () => {
    // A token defined only in :root silently keeps its light value at night,
    // which is the quietest way for one element to stay wrong.
    for (const name of Object.keys(light)) {
      expect(dark[name], `--c-${name} is missing from .dark`).toBeDefined();
    }
  });

  it('gives every token three channel values in range', () => {
    for (const [theme, set] of [['light', light], ['dark', dark]] as const) {
      for (const [name, rgb] of Object.entries(set)) {
        expect(rgb, `${theme} --c-${name}`).toHaveLength(3);
        for (const c of rgb) {
          expect(Number.isInteger(c) && c >= 0 && c <= 255, `${theme} --c-${name}`).toBe(true);
        }
      }
    }
  });

  it('inverts the structural greys rather than merely darkening them', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The page background is the lightest thing by day and the darkest by night.
    expect(lum(light['slate-50'])).toBeGreaterThan(lum(light['slate-900']));
    expect(lum(dark['slate-50'])).toBeLessThan(lum(dark['slate-900']));
  });

  it('keeps on-accent white in both themes', () => {
    // The bug this pins: `white` is the card surface and must darken at night,
    // whereas a label on a blue button must not. Collapsing them put the
    // primary button at 3.31:1.
    expect(light['on-accent']).toEqual([255, 255, 255]);
    expect(dark['on-accent']).toEqual([255, 255, 255]);
  });

  it('flips the ink pair, so a solid chip stays high-contrast in both themes', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(lum(light.ink)).toBeLessThan(lum(light['on-ink']));
    expect(lum(dark.ink)).toBeGreaterThan(lum(dark['on-ink']));
  });

  it('keeps the scrim dark in both themes', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // A light scrim is not a scrim.
    expect(lum(dark.scrim)).toBeLessThan(60);
    expect(lum(light.scrim)).toBeLessThan(60);
  });

  it('meets WCAG AA on every rendered pair, in both themes', () => {
    // Runs the same script a developer runs by hand. It exits non-zero on any
    // failure, so this assertion is the whole check.
    expect(() =>
      execFileSync('node', ['scripts/check-contrast.cjs'], { encoding: 'utf8' }),
    ).not.toThrow();
  });

  it('is reproducible from the generator', () => {
    // A hand edit to the generated file would be silently lost on the next
    // build; this fails instead.
    const regenerated = execFileSync('node', ['scripts/build-theme.cjs'], { encoding: 'utf8' });
    expect(regenerated).toContain('declarations');
    expect(readFileSync('src/app/theme.css', 'utf8')).toBe(css);
  });
});
