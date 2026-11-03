// Renders the PWA PNG icons from public/icon.svg: bun scripts/icons.ts
import { chromium } from "@playwright/test";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "../public");
const svg = await Bun.file(join(PUBLIC, "icon.svg")).text();
const ICONS = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: true },
] as const;

const browser = await chromium.launch();
const renders = ICONS.map(async ({ name, size, maskable }) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable and touch icons fill the square (the platform rounds them); the glyph keeps the safe zone.
  const art = maskable ? svg.replace(/rx="\d+"/, 'rx="0"') : svg;
  await page.setContent(
    `<body style="margin:0">${art.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`,
  );
  await page.screenshot({ path: join(PUBLIC, name), omitBackground: !maskable });
  await page.close();
});
await Promise.all(renders);
await browser.close();
