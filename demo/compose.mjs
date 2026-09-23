// Composes the README hero and the catalog banner from a raw capture (demo/capture.mjs):
// the real screenshot inside a browser frame, on a Nous-blue backdrop, rendered at exact sizes.
// Usage: node demo/compose.mjs [rawScreenshot] [outDir]
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

const raw = process.argv[2] || 'demo/out/raw/session.png';
const outDir = process.argv[3] || 'docs/media';
await mkdir(outDir, { recursive: true });
const shot = `data:image/png;base64,${(await readFile(raw)).toString('base64')}`;

// Canvas size, window width, and how far from the top the window starts; it bleeds off the bottom.
const TARGETS = [
  { file: 'banner.png', width: 1200, height: 600, windowWidth: 1100, top: 44 },
  { file: 'hero.png', width: 1600, height: 900, windowWidth: 1380, top: 72 },
];

const html = ({ width, height, windowWidth, top }) => `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    background:
      radial-gradient(ellipse 70% 60% at 50% 110%, rgba(120, 170, 255, .55), transparent 70%),
      radial-gradient(ellipse 60% 50% at 10% -10%, rgba(0, 40, 140, .9), transparent 70%),
      linear-gradient(160deg, #0a2a8a 0%, #0053fd 55%, #3b7bff 100%);
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  .window {
    position: absolute; left: 50%; top: ${top}px; width: ${windowWidth}px; transform: translateX(-50%);
    border-radius: 12px 12px 0 0; overflow: hidden; background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .08), 0 30px 80px -20px rgba(0, 10, 60, .55), 0 12px 30px -12px rgba(0, 10, 60, .35);
  }
  .chrome { height: 40px; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: #f1f3f5; border-bottom: 1px solid #e3e6ea; }
  .dots { display: flex; gap: 7px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; display: block; background: #d7dbe0; }
  .url {
    flex: 1; max-width: 420px; margin: 0 auto; height: 26px; border-radius: 13px; background: #fff;
    box-shadow: inset 0 0 0 1px #e1e4e8; display: flex; align-items: center; justify-content: center; gap: 6px;
    font-size: 12.5px; color: #3c434a; letter-spacing: .1px;
  }
  .url svg { width: 12px; height: 12px; color: #8a929b; }
  .url b { font-weight: 400; color: #8a929b; }
  .spacer { width: 60px; }
  .window img { display: block; width: 100%; }
</style></head><body>
  <div class="window">
    <div class="chrome">
      <div class="dots"><i></i><i></i><i></i></div>
      <div class="url"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><span>127.0.0.1:9119<b>/workbench</b></span></div>
      <div class="spacer"></div>
    </div>
    <img src="${shot}">
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
for (const target of TARGETS) {
  const page = await browser.newPage({ viewport: { width: target.width, height: target.height }, deviceScaleFactor: 1 });
  await page.setContent(html(target), { waitUntil: 'load' });
  await page.screenshot({ path: `${outDir}/${target.file}` });
  await page.close();
  console.log(`${outDir}/${target.file} (${target.width}x${target.height})`);
}
await browser.close();
