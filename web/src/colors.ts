import * as d3 from "d3";

/** Gap (years) at which the diverging scale saturates. */
export const GAP_LIMIT = 60;

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Diverging blue (leader younger) ↔ gray (same age) ↔ red (leader older). */
export function gapScale(): d3.ScaleDiverging<string> {
  const interp = d3.piecewise(d3.interpolateLab, [
    cssVar("--div-neg"),
    cssVar("--div-neg-mid"),
    cssVar("--div-mid"),
    cssVar("--div-pos-mid"),
    cssVar("--div-pos"),
  ]);
  return d3.scaleDiverging(interp).domain([-GAP_LIMIT, 0, GAP_LIMIT]).clamp(true);
}

export const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
