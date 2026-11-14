// Draws the installer window's background (the DMG that opens when people download the
// app): a Cloud Nine sky with pixel clouds, a pixel arrow from the app to Applications,
// and "Drag the cherub into Applications" in the popover's pixel font. Rendered by
// Electron to build/background.png (600x400), which electron-builder uses (sizes and
// icon positions match the dmg section of electron-builder.yml). 1x only: Finder showed
// a 1x+2x TIFF at double size on macOS 27, and the pixel art scales up cleanly.
// Deterministic. Usage: npx electron scripts/dmg-background.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "build");
const W = 600;
const H = 400;
const APP_X = 150; // icon centers, as in electron-builder.yml dmg.contents
const APPS_X = 450;
const ICON_Y = 190;
const FONT = path.join(ROOT, "assets", "fonts", "Silkscreen-Regular.ttf");

const page = (zoom) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Silkscreen; src: url("file://${FONT}") format("truetype"); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; zoom: ${zoom}; }
body { background: linear-gradient(#cfe4f8, #fbefe2); font-family: Silkscreen, monospace; color: #302f52; }
canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; }
h1 { position: absolute; top: 34px; width: 100%; margin: 0; text-align: center; font-size: 26px; font-weight: 400; letter-spacing: 0.02em; }
p { position: absolute; top: 318px; width: 100%; margin: 0; text-align: center; font-size: 13px; letter-spacing: 0.04em; color: #4b4766; }
</style></head><body>
<canvas id="c" width="${W / 3}" height="${H / 3}" style="width:${W}px;height:${H}px"></canvas>
<h1>Cherub Courier</h1>
<p>Drag the cherub into Applications</p>
<script>
// Clouds and arrow on a 3 px pixel grid.
const g = document.getElementById("c").getContext("2d");
const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function cloud(cx, cy, puffs) {
  for (const [dx, dy, r] of puffs) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) px(cx + dx + x, cy + dy + y, 1, 1, y > r - 2 && dy >= 0 ? "#e3edf8" : "#ffffff");
}
cloud(28, 104, [[0, 0, 5], [6, -2, 6], [12, 0, 5]]);
cloud(170, 26, [[0, 0, 4], [5, -2, 5], [10, 0, 4]]);
cloud(166, 112, [[0, 0, 3], [4, -1, 4], [8, 0, 3]]);
// Arrow from the app to Applications, dashed, with a stepped head.
const y = Math.round(${ICON_Y} / 3), x0 = Math.round(${APP_X} / 3) + 22, x1 = Math.round(${APPS_X} / 3) - 24;
for (let x = x0; x < x1 - 4; x += 4) px(x, y, 2, 2, "#b2606b");
for (let i = 0; i < 5; i++) { px(x1 - 5 + i, y - 4 + i, 1, 2 + (4 - i) * 0, "#b2606b"); px(x1 - 5 + i, y + 5 - i, 1, 1, "#b2606b"); }
px(x1 - 1, y, 2, 2, "#b2606b");
</script></body></html>`;

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-bg-"));
  const html = path.join(tmp, "bg.html");
  fs.writeFileSync(html, page(1));
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(html);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await new Promise((r) => setTimeout(r, 300));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "background.png"), (await win.webContents.capturePage()).toPNG());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("wrote build/background.png (600x400)");
  app.quit();
}).catch((e) => {
  console.error("dmg-background failed:", e);
  app.exit(1);
});
