import type { YearRow } from "./data";
import { type GapDomain, gapScale } from "./colors";
import { el, fmtAge, fmtBorn, fmtGap } from "./format";

type SortKey = "country" | "leader" | "la" | "ma" | "gap";

interface Column {
  key: SortKey | null;
  label: string;
  num?: boolean;
  /** extra class, e.g. to hide the column on narrow screens */
  cls?: string;
}

const COLUMNS: Column[] = [
  { key: "country", label: "Country" },
  { key: "leader", label: "Leader" },
  { key: null, label: "Born", cls: "col-born" },
  { key: "la", label: "Leader age", num: true, cls: "col-age" },
  { key: "ma", label: "Mean age", num: true, cls: "col-age" },
  { key: "gap", label: "Gap (years)", num: true },
];

export class YearTable {
  private sort: { key: SortKey; dir: 1 | -1 } = { key: "gap", dir: -1 };
  private query = "";
  private continent = "";
  private rows: YearRow[] = [];
  private selected: string | null = null;
  private thead: HTMLTableSectionElement;
  private tbody: HTMLTableSectionElement;

  private countLabel: HTMLElement;
  private onSelect: (iso3: string) => void;
  private domain: GapDomain;

  constructor(
    host: HTMLElement,
    domain: GapDomain,
    filters: HTMLElement,
    countLabel: HTMLElement,
    continents: string[],
    onSelect: (iso3: string) => void,
  ) {
    this.countLabel = countLabel;
    this.onSelect = onSelect;
    this.domain = domain;
    const search = el("input", { type: "search", placeholder: "Filter by country or leader", "aria-label": "Filter table" });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.renderBody();
    });
    const select = el(
      "select",
      { "aria-label": "Continent" },
      el("option", { value: "" }, "All continents"),
      ...continents.map((c) => el("option", { value: c }, c)),
    );
    select.addEventListener("change", () => {
      this.continent = select.value;
      this.renderBody();
    });
    filters.append(search, select);

    this.thead = el("thead");
    this.tbody = el("tbody");
    host.append(el("table", {}, this.thead, this.tbody));
    this.renderHead();
  }

  update(rows: YearRow[], selected: string | null): void {
    this.rows = rows;
    this.selected = selected;
    this.renderBody();
  }

  private renderHead(): void {
    const tr = el("tr");
    for (const c of COLUMNS) {
      const active = c.key === this.sort.key;
      const th = el(
        "th",
        {
          class: [c.num ? "num" : "", c.key ? "sortable" : "", c.cls ?? ""].join(" ").trim(),
          scope: "col",
          "aria-sort": active ? (this.sort.dir === 1 ? "ascending" : "descending") : undefined,
          tabindex: c.key ? 0 : undefined,
        },
        c.label,
        c.key ? el("span", { class: "sort-indicator", "aria-hidden": "true" }, active ? (this.sort.dir === 1 ? "▲" : "▼") : "") : null,
      );
      if (c.key) {
        const key = c.key;
        const activate = () => {
          this.sort = { key, dir: this.sort.key === key ? (-this.sort.dir as 1 | -1) : key === "country" || key === "leader" ? 1 : -1 };
          this.renderHead();
          this.renderBody();
        };
        th.addEventListener("click", activate);
        th.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        });
      }
      tr.append(th);
    }
    this.thead.replaceChildren(tr);
  }

  private renderBody(): void {
    const q = this.query;
    const rows = this.rows.filter(
      (r) =>
        (!this.continent || r.country.continent === this.continent) &&
        (!q || r.country.name.toLowerCase().includes(q) || r.leader.name.toLowerCase().includes(q)),
    );
    const { key, dir } = this.sort;
    const val = (r: YearRow): string | number => {
      switch (key) {
        case "country":
          return r.country.name;
        case "leader":
          return r.leader.name;
        case "la":
          return r.la ?? -Infinity;
        case "ma":
          return r.ma;
        case "gap":
          return r.gap ?? -Infinity;
      }
    };
    rows.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number)) * dir;
    });

    const color = gapScale(this.domain);
    this.countLabel.textContent = `${rows.length} of ${this.rows.length} countries`;
    this.tbody.replaceChildren(
      ...rows.map((r) => {
        const tr = el(
          "tr",
          { class: r.iso3 === this.selected ? "selected" : undefined, tabindex: 0 },
          el(
            "td",
            {},
            r.country.name,
            r.via ? el("span", { class: "flag", title: r.via }, "historical state") : null,
          ),
          el("td", {}, r.leader.name),
          el("td", { class: "muted col-born" }, fmtBorn(r.leader)),
          el("td", { class: "num col-age" }, fmtAge(r.la)),
          el("td", { class: "num col-age" }, fmtAge(r.ma), r.proj ? el("span", { class: "muted", title: "UN projection" }, "*") : null),
          el("td", { class: "num" }, gapCell(r.gap, color, this.domain)),
        );
        tr.addEventListener("click", () => this.onSelect(r.iso3));
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.onSelect(r.iso3);
        });
        return tr;
      }),
    );
  }
}

function gapCell(gap: number | null, color: (v: number) => string, [lo, hi]: GapDomain): HTMLElement {
  const wrap = el("div", { class: "gap-cell" }, el("span", {}, fmtGap(gap)));
  if (gap == null) return wrap;
  // Bar from zero, on the same lo..hi range as the color scale.
  const pct = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
  const zero = pct(0);
  const end = pct(gap);
  const bar = el(
    "div",
    { class: "gap-bar", "aria-hidden": "true" },
    el("div", {
      class: `fill ${gap >= 0 ? "pos" : "neg"}`,
      style: `left:${Math.min(zero, end)}%;width:${Math.abs(end - zero)}%;background:${color(gap)}`,
    }),
    el("div", { class: "zero", style: `left:${zero}%` }),
  );
  wrap.prepend(bar);
  return wrap;
}
