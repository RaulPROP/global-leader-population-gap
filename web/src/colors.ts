import * as d3 from "d3";

/** Gaps (years) at the two ends of the diverging scale: [most negative, most positive]. */
export type GapDomain = readonly [lo: number, hi: number];

/** The smallest and largest gap over all years, rounded out to 5 years, so the scale ends where the data ends. */
export function gapDomain(gaps: Iterable<number>): GapDomain {
  let lo = 0;
  let hi = 0;
  for (const g of gaps) {
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return [Math.floor(lo / 5) * 5, Math.ceil(hi / 5) * 5];
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Diverging blue (leader younger) ↔ gray (same age) ↔ red (leader older). Each arm spans its own side of the
 * domain, so the most negative gap is as saturated as the most positive one.
 */
export function gapScale([lo, hi]: GapDomain): d3.ScaleDiverging<string> {
  const interp = d3.piecewise(d3.interpolateLab, [
    cssVar("--div-neg"),
    cssVar("--div-neg-mid"),
    cssVar("--div-mid"),
    cssVar("--div-pos-mid"),
    cssVar("--div-pos"),
  ]);
  return d3.scaleDiverging(interp).domain([lo, 0, hi]).clamp(true);
}

/** CSS gradient of the scale from lo to hi, for legends. */
export function gapGradient(domain: GapDomain): string {
  const [lo, hi] = domain;
  const color = gapScale(domain);
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const values = [...d3.range(21).map((i) => lo + (i * (hi - lo)) / 20), 0].sort((a, b) => a - b);
  return `linear-gradient(90deg, ${values.map((v) => `${color(v)} ${pct(v)}%`).join(",")})`;
}

export const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
