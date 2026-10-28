import type { Leader } from "./data";

export function fmtGap(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "–";
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function fmtAge(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "–";
  return v.toFixed(digits);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtBorn(l: Leader): string {
  if (!l.born) return "unknown";
  const [y, m, d] = l.born.split("-");
  switch (l.bornPrecision) {
    case "day":
      return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    case "month":
      return `${MONTHS[Number(m) - 1]} ${y}`;
    case "estimated":
      return `c. ${y}`;
    default:
      return y;
  }
}

export function fmtPop(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} bn`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} m`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(v);
}

export function yearsRange(a: number, b: number): string {
  return a === b ? String(a) : `${a}–${b}`;
}

/** Tiny DOM helper: el("div", {class: "x"}, "text", child) — text is always textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
