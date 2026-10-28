// Shape of public/data/gap.json (written by pipeline/build.py) and the
// derived per-year views the UI works from.

export interface Row {
  y: number;
  /** index into Dataset.leaders */
  l: number;
  /** population mean age (computed from UN WPP single-age population, mid-year) */
  ma: number;
  /** leader age at mid-year */
  la: number | null;
  /** la - ma */
  gap: number | null;
  /** mean age is based on a UN projection rather than an estimate */
  proj?: 1;
  /** leader governed this territory as part of a larger state */
  via?: string;
  /** other leaders who held office during the year */
  others?: number[];
  pop?: number;
}

export interface Leader {
  name: string;
  born: string | null;
  bornPrecision: "day" | "month" | "year" | "estimated" | "unknown";
  sources: string[];
  qid?: string;
  wiki?: string;
}

export interface Country {
  iso3: string;
  name: string;
  continent: string | null;
  officeAfter2021?: string;
}

export interface Spell {
  l: number;
  start: string;
  end: string;
  src: string;
  via?: string;
}

export interface Dataset {
  generated: string;
  firstYear: number;
  lastYear: number;
  lastEstimateYear: number;
  reignEnd: string;
  worldMeanAge: Record<string, number>;
  countries: Country[];
  leaders: Leader[];
  series: Record<string, Row[]>;
  spells: Record<string, Spell[]>;
  warnings: string[];
  curation: { iso3: string; kind: "office" | "untracked" | "curated" | "excluded"; note: string }[];
}

export interface YearRow extends Row {
  iso3: string;
  country: Country;
  leader: Leader;
}

export interface YearStat {
  year: number;
  n: number;
  median: number;
  q1: number;
  q3: number;
  /** population-weighted mean gap */
  weighted: number;
  /** population-weighted mean leader age */
  weightedLeaderAge: number;
  worldMeanAge: number | null;
}

export class Model {
  readonly years: number[];
  readonly countries = new Map<string, Country>();
  readonly byYear = new Map<number, YearRow[]>();
  readonly stats: YearStat[] = [];

  readonly ds: Dataset;

  constructor(ds: Dataset) {
    this.ds = ds;
    for (const c of ds.countries) this.countries.set(c.iso3, c);
    this.years = [];
    for (let y = ds.firstYear; y <= ds.lastYear; y++) {
      this.years.push(y);
      this.byYear.set(y, []);
    }
    for (const [iso3, rows] of Object.entries(ds.series)) {
      const country = this.countries.get(iso3);
      if (!country) continue;
      for (const r of rows) {
        this.byYear.get(r.y)?.push({ ...r, iso3, country, leader: ds.leaders[r.l] });
      }
    }
    for (const year of this.years) {
      const rows = this.byYear.get(year)!.filter((r) => r.gap != null);
      if (!rows.length) continue;
      const gaps = rows.map((r) => r.gap!).sort((a, b) => a - b);
      let wSum = 0;
      let wGap = 0;
      let wAge = 0;
      for (const r of rows) {
        if (!r.pop) continue;
        wSum += r.pop;
        wGap += r.pop * r.gap!;
        wAge += r.pop * r.la!;
      }
      this.stats.push({
        year,
        n: rows.length,
        median: quantile(gaps, 0.5),
        q1: quantile(gaps, 0.25),
        q3: quantile(gaps, 0.75),
        weighted: wGap / wSum,
        weightedLeaderAge: wAge / wSum,
        worldMeanAge: ds.worldMeanAge[year] ?? null,
      });
    }
  }

  rows(year: number): YearRow[] {
    return this.byYear.get(year) ?? [];
  }

  row(iso3: string, year: number): YearRow | undefined {
    return this.rows(year).find((r) => r.iso3 === iso3);
  }

  series(iso3: string): Row[] {
    return this.ds.series[iso3] ?? [];
  }

  stat(year: number): YearStat | undefined {
    return this.stats.find((s) => s.year === year);
  }

  leader(i: number): Leader {
    return this.ds.leaders[i];
  }
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function loadDataset(): Promise<Dataset> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/gap.json`);
  if (!res.ok) throw new Error(`Could not load data (${res.status})`);
  return res.json();
}
