import { el } from "./format";

export interface TooltipRow {
  value: string;
  label: string;
  /** CSS color for the line key; omitted → no key */
  color?: string;
}

export interface TooltipContent {
  title: string;
  sub?: string;
  rows: TooltipRow[];
  note?: string;
}

const node = el("div", { class: "tooltip", role: "status", "aria-live": "polite" });
document.body.append(node);

export function showTooltip(content: TooltipContent, clientX: number, clientY: number): void {
  const children = [
    el("div", { class: "tt-title" }, content.title),
    content.sub ? el("div", { class: "tt-sub" }, content.sub) : null,
    ...content.rows.map((r) =>
      el(
        "div",
        { class: "tt-row" },
        r.color ? el("span", { class: "tt-key", style: `color:${r.color}` }) : null,
        el("span", { class: "tt-value" }, r.value),
        el("span", { class: "tt-label" }, r.label),
      ),
    ),
    content.note ? el("div", { class: "tt-note" }, content.note) : null,
  ];
  node.replaceChildren(...children.filter((c): c is HTMLDivElement => c !== null));
  node.classList.add("visible");
  const pad = 14;
  const { width, height } = node.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + width > window.innerWidth - 8) x = clientX - width - pad;
  if (y + height > window.innerHeight - 8) y = clientY - height - pad;
  node.style.left = `${Math.max(8, x)}px`;
  node.style.top = `${Math.max(8, y)}px`;
}

export function hideTooltip(): void {
  node.classList.remove("visible");
}
