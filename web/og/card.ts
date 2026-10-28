import "../src/style.css";
import "./card.css";
import { GAP_LIMIT, gapScale } from "../src/colors";
import { Model, loadDataset } from "../src/data";
import { el, fmtGap } from "../src/format";
import { WorldMap } from "../src/map";

const model = new Model(await loadDataset());
const year = model.ds.lastYear;
const stat = model.stat(year)!;
document.getElementById("sub")!.textContent =
  `Leader age minus the population's mean age, ${year}. Typical gap: ${fmtGap(stat.median, 0)} years.`;

const map = new WorldMap(document.getElementById("map")!, () => {});
await map.load();
map.update(model.rows(year), null);

const color = gapScale();
const stops = Array.from({ length: 11 }, (_, i) => `${color(-GAP_LIMIT + (i * GAP_LIMIT) / 5)} ${i * 10}%`);
document.getElementById("legend")!.replaceChildren(
  el("span", {}, "Leader younger"),
  el("div", { class: "og-bar", style: `background:linear-gradient(90deg, ${stops.join(",")})` }),
  el("span", {}, "Leader older"),
);
document.body.dataset.ready = "1";
