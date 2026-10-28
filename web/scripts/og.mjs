// Renders og/card.html with the current data and saves it as public/og.png,
// the social preview image. Run after rebuilding the data: npm run og
// Needs Chrome/Chromium; set CHROME to its path if it is not "chromium".
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = fileURLToPath(new URL("../public/og.png", import.meta.url));
const chrome = process.env.CHROME ?? "chromium";

// A static build of just the card, served from this process (so Chrome must
// run asynchronously, or the server could not answer it).
const outDir = mkdtempSync(join(tmpdir(), "og-"));
// base "/": the card sits in og/, so the site's relative base would miss data/.
await build({ root, base: "/", logLevel: "error", build: { outDir, rollupOptions: { input: join(root, "og/card.html") } } });
const server = await preview({ root, logLevel: "error", build: { outDir }, preview: { port: 5199, strictPort: true } });
try {
  await promisify(execFile)(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--window-size=1200,630",
    "--virtual-time-budget=10000",
    `--screenshot=${out}`,
    "http://localhost:5199/og/card.html",
  ], { timeout: 60_000 });
  console.log(`Wrote ${out}`);
} finally {
  await server.close();
  rmSync(outDir, { recursive: true, force: true });
}
