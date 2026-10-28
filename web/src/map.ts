import * as d3 from "d3";
import { numericToAlpha3 } from "i18n-iso-countries";
import * as topojson from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import worldUrl from "world-atlas/countries-50m.json?url";
import type { YearRow } from "./data";
import { type GapDomain, gapScale } from "./colors";
import { fmtAge, fmtGap } from "./format";
import { hideTooltip, showTooltip } from "./tooltip";

type CountryFeature = Feature<Geometry, { name: string }> & { iso3: string | null };

// Natural Earth shapes without an ISO numeric code.
const NAME_TO_ISO3: Record<string, string> = { Kosovo: "OWID_KOS" };

export class WorldMap {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private paths?: d3.Selection<SVGPathElement, CountryFeature, SVGGElement, unknown>;
  private features: CountryFeature[] = [];
  private rows = new Map<string, YearRow>();
  private selected: string | null = null;

  private host: HTMLElement;
  private onSelect: (iso3: string) => void;

  private domain: GapDomain;

  constructor(host: HTMLElement, domain: GapDomain, onSelect: (iso3: string) => void) {
    this.host = host;
    this.domain = domain;
    this.onSelect = onSelect;
    this.svg = d3.select(host).append("svg").attr("role", "img").attr("aria-label", "World map of the leader–population age gap");
  }

  async load(): Promise<void> {
    const world = (await (await fetch(worldUrl)).json()) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = topojson.feature(world, world.objects.countries);
    this.features = fc.features
      .filter((f) => f.id !== "010") // Antarctica
      .map((f) => {
        const iso3 = (f.id != null && numericToAlpha3(String(f.id))) || NAME_TO_ISO3[f.properties.name] || null;
        return Object.assign(f, { iso3 }) as CountryFeature;
      });
    this.draw();
    new ResizeObserver(() => this.draw()).observe(this.host);
  }

  private draw(): void {
    const width = this.host.clientWidth || 800;
    const height = Math.round(width * 0.47);
    const projection = d3.geoEqualEarth().fitExtent(
      [
        [4, 4],
        [width - 4, height - 4],
      ],
      { type: "Sphere" },
    );
    const path = d3.geoPath(projection);
    this.svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    this.svg.selectAll("*").remove();
    this.svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    this.paths = this.svg
      .append("g")
      .selectAll<SVGPathElement, CountryFeature>("path")
      .data(this.features)
      .join("path")
      .attr("class", "country")
      .attr("d", (f) => path(f))
      .on("pointermove", (ev: PointerEvent, f) => this.hover(ev, f))
      .on("pointerleave", () => hideTooltip())
      .on("click", (_ev, f) => {
        if (f.iso3 && this.rows.has(f.iso3)) this.onSelect(f.iso3);
      });
    this.paint();
  }

  update(rows: YearRow[], selected: string | null): void {
    this.rows = new Map(rows.map((r) => [r.iso3, r]));
    this.selected = selected;
    this.paint();
  }

  paint(): void {
    if (!this.paths) return;
    const color = gapScale(this.domain);
    this.paths
      .attr("fill", (f) => {
        const r = f.iso3 ? this.rows.get(f.iso3) : undefined;
        return r?.gap != null ? color(r.gap) : "var(--nodata)";
      })
      .classed("nodata", (f) => !(f.iso3 && this.rows.get(f.iso3)?.gap != null))
      .classed("selected", (f) => f.iso3 != null && f.iso3 === this.selected);
    this.paths.filter(".selected").raise();
  }

  private hover(ev: PointerEvent, f: CountryFeature): void {
    const r = f.iso3 ? this.rows.get(f.iso3) : undefined;
    if (!r) {
      showTooltip({ title: f.properties.name, rows: [], note: "No data for this year" }, ev.clientX, ev.clientY);
      return;
    }
    showTooltip(
      {
        title: r.country.name,
        sub: r.leader.name,
        rows: [
          { value: `${fmtGap(r.gap)} yrs`, label: "gap" },
          { value: fmtAge(r.la), label: "leader age" },
          { value: fmtAge(r.ma), label: "population mean age" },
        ],
        note: r.via,
      },
      ev.clientX,
      ev.clientY,
    );
  }
}
