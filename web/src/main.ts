import "./style.css";
import { GAP_LIMIT, cssVar, darkQuery, gapScale } from "./colors";
import { Model, loadDataset, type Dataset, type Row, type YearRow } from "./data";
import { el, fmtAge, fmtBorn, fmtGap, yearsRange } from "./format";
import { LineChart, type SeriesDef } from "./linechart";
import { WorldMap } from "./map";
import { YearTable } from "./table";

type TrendMode = "gap" | "ages";

interface State {
  year: number;
  country: string;
  trend: TrendMode;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const model = new Model(await loadDataset());
  const ds = model.ds;

  const state: State = { year: ds.lastYear, country: "USA", trend: "gap", ...readHash(model) };

  // ---------------------------------------------------------------- controls
  const slider = $<HTMLInputElement>("year");
  slider.min = String(ds.firstYear);
  slider.max = String(ds.lastYear);
  slider.value = String(state.year);
  slider.addEventListener("input", () => setState({ year: Number(slider.value) }));

  const playBtn = $<HTMLButtonElement>("play");
  let timer: number | undefined;
  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Play through the years");
  };
  playBtn.addEventListener("click", () => {
    if (timer) return stop();
    if (state.year >= ds.lastYear) setState({ year: ds.firstYear });
    playBtn.textContent = "❚❚";
    playBtn.setAttribute("aria-label", "Pause");
    timer = window.setInterval(() => {
      if (state.year >= ds.lastYear) return stop();
      setState({ year: state.year + 1 });
    }, 450);
  });

  const search = $<HTMLInputElement>("country-search");
  $("country-options").replaceChildren(...ds.countries.map((c) => el("option", { value: c.name })));
  const pickCountry = () => {
    const q = search.value.trim().toLowerCase();
    const c = ds.countries.find((c) => c.name.toLowerCase() === q) ?? ds.countries.find((c) => c.iso3.toLowerCase() === q);
    if (c) {
      setState({ country: c.iso3 });
      search.value = "";
      search.blur();
    }
  };
  search.addEventListener("change", pickCountry);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pickCountry();
  });

  document.querySelectorAll<HTMLButtonElement>(".segmented button").forEach((b) =>
    b.addEventListener("click", () => setState({ trend: b.dataset.mode as TrendMode })),
  );

  // ---------------------------------------------------------------- views
  const map = new WorldMap($("map"), (iso3) => setState({ country: iso3 }));
  const countryChart = new LineChart($("country-chart"), 300);
  const trendChart = new LineChart($("trend-chart"), 300);
  const continents = [...new Set(ds.countries.map((c) => c.continent).filter(Boolean) as string[])].sort();
  const table = new YearTable($("table"), $("table-filters"), $("table-count"), continents, (iso3) => {
    setState({ country: iso3 });
    $("country-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  renderStatic(model);
  $("loading").hidden = true;
  $("content").hidden = false;
  await map.load();

  function setState(patch: Partial<State>) {
    Object.assign(state, patch);
    history.replaceState(null, "", `#year=${state.year}&country=${state.country}`);
    render();
  }

  function render() {
    slider.value = String(state.year);
    $("year-output").textContent = String(state.year);
    const rows = model.rows(state.year);
    renderTiles(model, state, (iso3) => setState({ country: iso3 }));
    $("map-title").textContent = `Leader age minus population mean age, ${state.year}`;
    map.update(rows, state.country);
    table.update(rows, state.country);
    $("table-title").textContent = `All countries, ${state.year}`;
    renderCountry(model, state, countryChart, (year) => setState({ year }));
    renderTrend(model, state, trendChart, (year) => setState({ year }));
  }

  darkQuery.addEventListener("change", () => {
    renderLegend();
    map.paint();
    render();
  });
  window.addEventListener("hashchange", () => {
    Object.assign(state, readHash(model));
    render();
  });
  renderLegend();
  render();
}

// ------------------------------------------------------------------ helpers

function readHash(model: Model): Partial<State> {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: Partial<State> = {};
  const y = Number(p.get("year"));
  if (y >= model.ds.firstYear && y <= model.ds.lastYear) out.year = y;
  const c = p.get("country")?.toUpperCase();
  if (c && model.countries.has(c)) out.country = c;
  return out;
}

function renderStatic(model: Model) {
  const ds = model.ds;
  for (const n of document.querySelectorAll(".last-est, #last-est")) n.textContent = String(ds.lastEstimateYear);
  $("generated").textContent = `Data built ${ds.generated}. ${ds.countries.length} countries, ${ds.leaders.length} leaders.`;
  $("curation-list").replaceChildren(
    ...ds.curation.map((c) =>
      el("li", {}, el("strong", {}, model.countries.get(c.iso3)?.name ?? c.iso3), ` – ${curationText(c)}`),
    ),
  );
}

function curationText(c: Dataset["curation"][number]): string {
  switch (c.kind) {
    case "office":
      return `From Sep 2021 the series follows the ${c.note.charAt(0).toLowerCase()}${c.note.slice(1)}.`;
    case "excluded":
      return `Excluded: ${c.note}.`;
    default:
      return `${c.note}.`;
  }
}

function renderLegend() {
  const color = gapScale();
  const stops = Array.from({ length: 11 }, (_, i) => {
    const v = -GAP_LIMIT + (i * 2 * GAP_LIMIT) / 10;
    return `${color(v)} ${i * 10}%`;
  });
  const ticks = [-GAP_LIMIT, -GAP_LIMIT / 2, 0, GAP_LIMIT / 2, GAP_LIMIT].map((v) =>
    el("span", {}, v === GAP_LIMIT ? `${fmtGap(v, 0)}+` : v === -GAP_LIMIT ? `${fmtGap(v, 0)}` : fmtGap(v, 0)),
  );
  $("map-legend").replaceChildren(
    el("span", {}, "Leader younger"),
    el("div", { class: "bar", style: `background:linear-gradient(90deg, ${stops.join(",")})` }),
    el("span", {}, "Leader older"),
    el("div", { class: "ticks" }, ...ticks),
    el("span", { style: "grid-column: 1 / -1; margin-top: 4px" }, el("span", { class: "nodata-swatch" }), "No data (not independent, or no single leader)"),
  );
}

function renderTiles(model: Model, state: State, select: (iso3: string) => void) {
  const stat = model.stat(state.year);
  const rows = model.rows(state.year).filter((r) => r.gap != null);
  if (!stat || !rows.length) {
    $("tiles").replaceChildren();
    return;
  }
  const max = rows.reduce((a, b) => (b.gap! > a.gap! ? b : a));
  const min = rows.reduce((a, b) => (b.gap! < a.gap! ? b : a));
  const younger = rows.filter((r) => r.gap! < 0).length;

  const tile = (label: string, value: string, unit: string, sub: Node | string) =>
    el("div", { class: "tile" }, el("div", { class: "tile-label" }, label), el("div", { class: "tile-value" }, value, el("span", { class: "unit" }, unit)), el("div", { class: "tile-sub" }, sub));
  const countryLink = (r: YearRow) => {
    const b = el("button", { class: "link", type: "button" }, `${r.country.name} · ${r.leader.name}`);
    b.addEventListener("click", () => select(r.iso3));
    return el("span", {}, b, ` (${fmtAge(r.la, 0)} vs ${fmtAge(r.ma, 0)})`);
  };

  $("tiles").replaceChildren(
    tile("Typical gap", fmtGap(stat.median), "years", `median across ${stat.n} countries`),
    tile("Population-weighted gap", fmtGap(stat.weighted), "years", "what the average person in the world experiences"),
    tile("Largest gap", fmtGap(max.gap), "years", countryLink(max)),
    tile("Smallest gap", fmtGap(min.gap), "years", countryLink(min)),
    tile("Leaders younger than their people", String(younger), `of ${rows.length}`, "countries where the leader is below the population's mean age"),
  );
}

function tenures(rows: Row[]): { l: number; from: number; to: number; avgGap: number | null }[] {
  const out: { l: number; from: number; to: number; gaps: number[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.l === r.l && last.to === r.y - 1) {
      last.to = r.y;
      if (r.gap != null) last.gaps.push(r.gap);
    } else out.push({ l: r.l, from: r.y, to: r.y, gaps: r.gap != null ? [r.gap] : [] });
  }
  return out.map(({ l, from, to, gaps }) => ({
    l,
    from,
    to,
    avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
  }));
}

function renderCountry(model: Model, state: State, chart: LineChart, selectYear: (y: number) => void) {
  const ds = model.ds;
  const country = model.countries.get(state.country)!;
  const series = model.series(state.country);
  const row = model.row(state.country, state.year);
  const s1 = cssVar("--series-1");
  const s2 = cssVar("--series-2");

  $("country-title").textContent = country.name;
  const office =
    country.officeAfter2021 && country.officeAfter2021 !== "not tracked" ? ` · from Sep 2021 tracks the ${country.officeAfter2021}` : "";
  $("country-sub").textContent = `${country.continent ?? ""}${office}`;

  // headline
  const head = $("country-headline");
  if (row && row.gap != null) {
    const older = row.gap >= 0;
    head.replaceChildren(
      el("div", { class: "big-gap" }, fmtGap(row.gap), el("span", { class: "unit" }, `years in ${state.year}`)),
      el(
        "p",
        { class: "country-headline" },
        el("strong", {}, row.leader.name),
        ` (${fmtAge(row.la)}) was ${fmtAge(Math.abs(row.gap))} years ${older ? "older" : "younger"} than the average resident (${fmtAge(row.ma)}${row.proj ? ", projected" : ""}).`,
      ),
    );
  } else if (row) {
    head.replaceChildren(el("p", { class: "country-headline" }, `${row.leader.name}: birth date unknown, so no gap for ${state.year}.`));
  } else {
    head.replaceChildren(el("p", { class: "country-headline" }, `No leader data for ${country.name} in ${state.year}.`));
  }

  // chart
  const leaderSeries: SeriesDef = {
    id: "leader",
    label: "Leader age",
    color: s1,
    points: series.map((r) => ({ x: r.y, y: r.la, group: r.l })),
    endLabel: "Leader",
  };
  const meanSeries: SeriesDef = {
    id: "mean",
    label: "Population mean age",
    color: s2,
    points: series.map((r) => ({ x: r.y, y: r.ma })),
    dashedFrom: ds.lastEstimateYear,
    endLabel: "Average resident",
  };
  const changes = series.filter((r, i) => i > 0 && series[i - 1].l !== r.l).map((r) => r.y - 0.5);
  chart.update({
    series: [leaderSeries, meanSeries],
    areaBetween: ["leader", "mean"],
    xDomain: [ds.firstYear, ds.lastYear],
    yDomain: [0, 100],
    yLabel: `Leader age and population mean age in ${country.name}`,
    markerX: row ? state.year : undefined,
    ticksAt: changes,
    onSelect: selectYear,
    tooltip: (x) => {
      const r = series.find((q) => q.y === x);
      if (!r) return null;
      const leader = model.leader(r.l);
      const others = (r.others ?? []).map((i) => model.leader(i).name);
      const notes = [
        others.length ? `Also in office in ${x}: ${others.join(", ")}` : "",
        r.via ?? "",
        r.proj ? "Mean age based on a UN projection" : "",
      ].filter(Boolean);
      return {
        title: `${x} · ${leader.name}`,
        rows: [
          { value: `${fmtGap(r.gap)} yrs`, label: "gap" },
          { value: fmtAge(r.la), label: "leader age", color: s1 },
          { value: fmtAge(r.ma), label: "mean age", color: s2 },
        ],
        note: notes.join(". ") || undefined,
      };
    },
  });
  $("country-legend").replaceChildren(
    el("span", { class: "legend-item", style: `color:${s1}` }, el("span", { class: "legend-swatch-line" }), el("span", { style: "color:var(--ink-2)" }, "Leader age (breaks mark a change of leader)")),
    el("span", { class: "legend-item", style: `color:${s2}` }, el("span", { class: "legend-swatch-line" }), el("span", { style: "color:var(--ink-2)" }, "Population mean age")),
    el("span", { class: "legend-item" }, el("span", { class: "legend-swatch-band", style: "background:var(--ink-1);opacity:.12" }), "Gap"),
  );

  // notes
  const notes = ds.curation.filter((c) => c.iso3 === state.country);
  const via = row?.via;
  $("country-notes").replaceChildren(
    ...(via ? [el("p", { class: "note" }, `${state.year}: ${via}.`)] : []),
    ...notes.map((n) =>
      el("p", { class: "note" }, curationText(n)),
    ),
  );

  // leaders list (most recent first)
  const list = tenures(series).reverse();
  const tbody = el(
    "tbody",
    {},
    ...list.map((t) => {
      const leader = model.leader(t.l);
      const active = state.year >= t.from && state.year <= t.to;
      const tr = el(
        "tr",
        { class: active ? "selected" : undefined, tabindex: 0, title: `Show ${t.from}` },
        el("td", { class: "muted" }, yearsRange(t.from, t.to)),
        el("td", {}, leader.name),
        el("td", { class: "muted" }, fmtBorn(leader)),
        el("td", { class: "num" }, fmtGap(t.avgGap)),
      );
      const go = () => selectYear(active ? state.year : t.from);
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go();
      });
      return tr;
    }),
  );
  $("country-leaders").replaceChildren(
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el("tr", {}, el("th", {}, "Years"), el("th", {}, "Leader"), el("th", {}, "Born"), el("th", { class: "num" }, "Avg. gap")),
      ),
      tbody,
    ),
  );
}

function renderTrend(model: Model, state: State, chart: LineChart, selectYear: (y: number) => void) {
  const ds = model.ds;
  const s1 = cssVar("--series-1");
  const s2 = cssVar("--series-2");
  const stats = model.stats;
  document.querySelectorAll<HTMLButtonElement>(".segmented button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === state.trend)),
  );

  const legendItem = (color: string, label: string, kind: "line" | "band" = "line") =>
    el(
      "span",
      { class: "legend-item", style: `color:${color}` },
      kind === "line"
        ? el("span", { class: "legend-swatch-line" })
        : el("span", { class: "legend-swatch-band", style: `background:${color};opacity:.25` }),
      el("span", { style: "color:var(--ink-2)" }, label),
    );

  if (state.trend === "gap") {
    $("trend-title").textContent = "The gap over time";
    $("trend-sub").textContent = "Leader age minus population mean age, all countries with data.";
    $("trend-legend").replaceChildren(
      legendItem(s1, "Median country"),
      legendItem(s1, "Middle half of countries", "band"),
      legendItem(s2, "Population-weighted average"),
    );
    chart.update({
      series: [
        { id: "median", label: "Median country", color: s1, points: stats.map((s) => ({ x: s.year, y: s.median })), dashedFrom: ds.lastEstimateYear },
        { id: "weighted", label: "Population-weighted", color: s2, points: stats.map((s) => ({ x: s.year, y: s.weighted })), dashedFrom: ds.lastEstimateYear },
      ],
      band: { color: s1, points: stats.map((s) => ({ x: s.year, y0: s.q1, y1: s.q3 })) },
      xDomain: [ds.firstYear, ds.lastYear],
      zeroLine: true,
      yLabel: "Gap between leader age and population mean age, worldwide",
      markerX: state.year,
      onSelect: selectYear,
      tooltip: (x) => {
        const s = model.stat(x);
        if (!s) return null;
        return {
          title: String(x),
          rows: [
            { value: `${fmtGap(s.median)} yrs`, label: "median country", color: s1 },
            { value: `${fmtGap(s.q1)} to ${fmtGap(s.q3)}`, label: "middle half" },
            { value: `${fmtGap(s.weighted)} yrs`, label: "population-weighted", color: s2 },
          ],
          note: `${s.n} countries${x > ds.lastEstimateYear ? " · mean ages projected" : ""}. Click to select.`,
        };
      },
    });
  } else {
    $("trend-title").textContent = "Leaders vs. the world's population";
    $("trend-sub").textContent = "Average leader age (weighted by population) and the world population's mean age.";
    $("trend-legend").replaceChildren(legendItem(s1, "Leader age, population-weighted"), legendItem(s2, "World population mean age"));
    chart.update({
      series: [
        { id: "la", label: "Leader age", color: s1, points: stats.map((s) => ({ x: s.year, y: s.weightedLeaderAge })), endLabel: "Leaders" },
        { id: "wm", label: "World mean age", color: s2, points: stats.map((s) => ({ x: s.year, y: s.worldMeanAge })), dashedFrom: ds.lastEstimateYear, endLabel: "World average" },
      ],
      areaBetween: ["la", "wm"],
      xDomain: [ds.firstYear, ds.lastYear],
      yDomain: [0, 80],
      yLabel: "Population-weighted leader age and world mean age",
      markerX: state.year,
      onSelect: selectYear,
      tooltip: (x) => {
        const s = model.stat(x);
        if (!s) return null;
        return {
          title: String(x),
          rows: [
            { value: fmtAge(s.weightedLeaderAge), label: "leader age (pop.-weighted)", color: s1 },
            { value: fmtAge(s.worldMeanAge), label: "world mean age", color: s2 },
          ],
          note: "Click to select this year.",
        };
      },
    });
  }
  $("trend-note").textContent =
    "Population-weighted: each country counts in proportion to its population, so China and India dominate. Dashed: years where mean ages are based on UN projections.";
}

main().catch((err) => {
  console.error(err);
  $("loading").textContent = `Could not load the data: ${err instanceof Error ? err.message : String(err)}`;
});
