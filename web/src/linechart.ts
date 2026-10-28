import * as d3 from "d3";
import { hideTooltip, showTooltip, type TooltipContent } from "./tooltip";

export interface Point {
  x: number;
  y: number | null;
  /** consecutive points with different groups are not joined (e.g. a change of leader) */
  group?: number | string;
}

export interface SeriesDef {
  id: string;
  label: string;
  color: string;
  points: Point[];
  /** draw the line dashed from this x onwards (projections) */
  dashedFrom?: number;
  /** short label drawn at the right end of the line */
  endLabel?: string;
}

export interface BandDef {
  color: string;
  points: { x: number; y0: number; y1: number }[];
}

export interface LineChartSpec {
  series: SeriesDef[];
  band?: BandDef;
  /** shade the area between two series (ids) */
  areaBetween?: [string, string];
  xDomain: [number, number];
  yDomain?: [number, number];
  zeroLine?: boolean;
  yLabel: string;
  markerX?: number;
  /** x positions of vertical hairlines (e.g. leader changes) */
  ticksAt?: number[];
  tooltip: (x: number) => TooltipContent | null;
  onSelect?: (x: number) => void;
}

const MARGIN = { top: 12, right: 92, bottom: 26, left: 40 };

export class LineChart {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private spec: LineChartSpec | null = null;
  private width = 600;
  private hoverX: number | null = null;

  private height: number;

  constructor(host: HTMLElement, height: number) {
    this.height = height;
    this.svg = d3.select(host).append("svg").attr("role", "img");
    new ResizeObserver(() => {
      const w = Math.round(host.clientWidth);
      if (w && w !== this.width) {
        this.width = w;
        this.render();
      }
    }).observe(host);
    this.width = host.clientWidth || 600;
  }

  update(spec: LineChartSpec): void {
    this.spec = spec;
    this.render();
  }

  private render(): void {
    const spec = this.spec;
    if (!spec) return;
    const { width, height } = this;
    const svg = this.svg.attr("width", width).attr("height", height).attr("aria-label", spec.yLabel);
    svg.selectAll("*").remove();

    const innerW = Math.max(50, width - MARGIN.left - MARGIN.right);
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const x = d3.scaleLinear().domain(spec.xDomain).range([0, innerW]);
    const allY: number[] = [];
    for (const s of spec.series) for (const p of s.points) if (p.y != null) allY.push(p.y);
    if (spec.band) for (const p of spec.band.points) allY.push(p.y0, p.y1);
    if (spec.zeroLine) allY.push(0);
    const y = d3
      .scaleLinear()
      .domain(spec.yDomain ?? (d3.extent(allY) as [number, number]))
      .nice()
      .range([innerH, 0]);

    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // grid + axes
    const yTicks = y.ticks(Math.max(3, Math.round(innerH / 50)));
    g.append("g")
      .selectAll("line")
      .data(yTicks)
      .join("line")
      .attr("class", (d) => (d === 0 && spec.zeroLine ? "zero-line" : "grid-line"))
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d));
    g.append("g")
      .attr("class", "axis")
      .selectAll("text")
      .data(yTicks)
      .join("text")
      .attr("x", -8)
      .attr("y", (d) => y(d))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((d) => (spec.zeroLine && d > 0 ? `+${d}` : String(d)));
    const xAxis = d3
      .axisBottom(x)
      .ticks(Math.max(3, Math.round(innerW / 80)))
      .tickFormat((d) => String(d))
      .tickSizeOuter(0);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`).call(xAxis);

    for (const t of spec.ticksAt ?? []) {
      g.append("line")
        .attr("class", "leader-change")
        .attr("x1", x(t))
        .attr("x2", x(t))
        .attr("y1", 0)
        .attr("y2", innerH);
    }

    if (spec.band) {
      const area = d3
        .area<{ x: number; y0: number; y1: number }>()
        .x((d) => x(d.x))
        .y0((d) => y(d.y0))
        .y1((d) => y(d.y1))
        .curve(d3.curveMonotoneX);
      g.append("path").attr("d", area(spec.band.points)).attr("fill", spec.band.color).attr("opacity", 0.16);
    }

    if (spec.areaBetween) {
      const [a, b] = spec.areaBetween.map((id) => spec.series.find((s) => s.id === id)!);
      const byX = new Map(b.points.map((p) => [p.x, p.y]));
      const pts = a.points
        .filter((p) => p.y != null && byX.get(p.x) != null)
        .map((p) => ({ x: p.x, y0: byX.get(p.x)!, y1: p.y! }));
      const area = d3
        .area<{ x: number; y0: number; y1: number }>()
        .x((d) => x(d.x))
        .y0((d) => y(d.y0))
        .y1((d) => y(d.y1))
        .curve(d3.curveStepAfter);
      // extend each yearly step by one so the last year has width
      const ext = pts.length ? [...pts, { ...pts[pts.length - 1], x: pts[pts.length - 1].x + 1 }] : pts;
      g.append("path").attr("class", "gap-area").attr("d", area(ext));
    }

    // series
    for (const s of spec.series) {
      for (const run of runs(s.points)) {
        const line = d3
          .line<Point>()
          .defined((p) => p.y != null)
          .x((p) => x(p.x))
          .y((p) => y(p.y!))
          .curve(d3.curveMonotoneX);
        const cut = s.dashedFrom;
        const solid = cut == null ? run : run.filter((p) => p.x <= cut);
        const dashed = cut == null ? [] : run.filter((p) => p.x >= cut);
        if (solid.length)
          g.append("path").attr("class", "series-line").attr("stroke", s.color).attr("d", line(solid));
        if (dashed.length > 1)
          g.append("path")
            .attr("class", "series-line")
            .attr("stroke", s.color)
            .attr("stroke-dasharray", "4 3")
            .attr("d", line(dashed));
        if (run.length === 1 && run[0].y != null) {
          g.append("circle").attr("cx", x(run[0].x)).attr("cy", y(run[0].y)).attr("r", 2).attr("fill", s.color);
        }
      }
      const last = [...s.points].reverse().find((p) => p.y != null);
      if (s.endLabel && last) {
        g.append("text")
          .attr("class", "direct-label")
          .attr("x", x(last.x) + 6)
          .attr("y", y(last.y!))
          .attr("dy", "0.32em")
          .text(s.endLabel);
      }
    }
    resolveLabelCollisions(g);

    // selected-year marker
    if (spec.markerX != null) {
      g.append("line")
        .attr("class", "year-marker")
        .attr("x1", x(spec.markerX))
        .attr("x2", x(spec.markerX))
        .attr("y1", 0)
        .attr("y2", innerH);
      for (const s of spec.series) {
        const p = s.points.find((q) => q.x === spec.markerX);
        if (p?.y != null)
          g.append("circle")
            .attr("class", "dot")
            .attr("cx", x(p.x))
            .attr("cy", y(p.y))
            .attr("r", 4)
            .attr("fill", s.color);
      }
    }

    // hover layer: crosshair snaps to the nearest year
    const cross = g.append("g").style("display", "none");
    cross.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", innerH);
    const dots = cross
      .selectAll("circle")
      .data(spec.series)
      .join("circle")
      .attr("class", "dot")
      .attr("r", 4)
      .attr("fill", (s) => s.color);

    const moveTo = (xv: number, clientX: number, clientY: number) => {
      const content = spec.tooltip(xv);
      if (!content) return hideAll();
      this.hoverX = xv;
      cross.style("display", null);
      cross.select("line").attr("x1", x(xv)).attr("x2", x(xv));
      dots
        .attr("cx", x(xv))
        .attr("cy", (s) => {
          const p = s.points.find((q) => q.x === xv);
          return p?.y != null ? y(p.y) : -999;
        })
        .style("display", (s) => (s.points.find((q) => q.x === xv)?.y != null ? null : "none"));
      showTooltip(content, clientX, clientY);
    };
    const hideAll = () => {
      this.hoverX = null;
      cross.style("display", "none");
      hideTooltip();
    };
    const [x0, x1] = spec.xDomain;
    const snap = (px: number) => Math.max(x0, Math.min(x1, Math.round(x.invert(px))));

    g.append("rect")
      .attr("class", "overlay")
      .attr("width", innerW)
      .attr("height", innerH)
      .attr("tabindex", 0)
      .attr("aria-label", "Chart: use left and right arrow keys to read values")
      .on("pointermove", (ev: PointerEvent) => {
        const [px] = d3.pointer(ev);
        moveTo(snap(px), ev.clientX, ev.clientY);
      })
      .on("pointerleave", hideAll)
      .on("blur", hideAll)
      .on("click", (ev: PointerEvent) => {
        const [px] = d3.pointer(ev);
        spec.onSelect?.(snap(px));
      })
      .on("keydown", (ev: KeyboardEvent) => {
        const cur = this.hoverX ?? spec.markerX ?? x0;
        let next = cur;
        if (ev.key === "ArrowLeft") next = Math.max(x0, cur - 1);
        else if (ev.key === "ArrowRight") next = Math.min(x1, cur + 1);
        else if (ev.key === "Enter") {
          spec.onSelect?.(cur);
          return;
        } else return;
        ev.preventDefault();
        const box = (ev.target as SVGRectElement).getBoundingClientRect();
        moveTo(next, box.left + x(next), box.top + 20);
      });
  }
}

/** Split points into runs of the same group. */
function runs(points: Point[]): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const p of points) {
    if (cur.length && cur[cur.length - 1].group !== p.group) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Nudge end labels apart vertically so they don't overlap. */
function resolveLabelCollisions(g: d3.Selection<SVGGElement, unknown, null, undefined>) {
  const labels = g.selectAll<SVGTextElement, unknown>("text.direct-label").nodes();
  const items = labels.map((n) => ({ n, y: Number(n.getAttribute("y")) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y < 13) items[i].y = items[i - 1].y + 13;
  }
  for (const it of items) it.n.setAttribute("y", String(it.y));
}
