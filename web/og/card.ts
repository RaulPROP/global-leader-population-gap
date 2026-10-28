import "../src/style.css";
import "./card.css";
import { gapGradient } from "../src/colors";
import { Model, loadDataset } from "../src/data";
import { el, fmtGap } from "../src/format";
import { WorldMap } from "../src/map";

const model = new Model(await loadDataset());
const year = model.ds.lastYear;
const stat = model.stat(year)!;
document.getElementById("sub")!.textContent =
  `Leader age minus the population's mean age, ${year}. Typical gap: ${fmtGap(stat.median, 0)} years.`;

const map = new WorldMap(document.getElementById("map")!, model.gapDomain, () => {});
await map.load();
map.update(model.rows(year), null);

document.getElementById("legend")!.replaceChildren(
  el("span", {}, "Leader younger"),
  el("div", { class: "og-bar", style: `background:${gapGradient(model.gapDomain)}` }),
  el("span", {}, "Leader older"),
);
document.body.dataset.ready = "1";
