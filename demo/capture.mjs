// Drives the real Workbench (desktop interface) against the scripted demo model and captures
// raw 2x screenshots for the README and catalog visuals. See demo/README.md for the setup.
// Usage: node demo/capture.mjs [outDir] [url]
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const outDir = process.argv[2] || 'demo/out/raw';
const url = process.argv[3] || 'http://127.0.0.1:9219/workbench';
await mkdir(outDir, { recursive: true });

// Short sessions first (they fill the sidebar), then the main one, so it ends up selected on top.
const SESSIONS = [
  ['Draft release notes for 2.3.1 from the changes since 2.3.0.', 'No breaking changes'],
  ['Why is the first page load slow in dev?', 'optimizeDeps.include'],
  ['Add a dark mode toggle to the settings page.', 'start with the settings store'],
  ['Checkout totals are off by a cent on some carts. Find the bug and fix it.', 'All 3 tests pass'],
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
const app = await (await page.waitForSelector('.hwb-desktop iframe', { timeout: 20000 })).contentFrame();
await app.getByText('New session').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/home.png` });

for (const [prompt, doneText] of SESSIONS) {
  await app.getByText('New session').first().click();
  await page.waitForTimeout(800);
  await app.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
  await app.getByText(doneText, { exact: false }).first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: `${outDir}/session.png` });

// Slash command menu over the finished session.
await app.locator('[contenteditable="true"]').first().click();
await page.keyboard.type('/');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/slash.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');

// Model picker.
await app.getByText('Local Model', { exact: false }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/models.png` });
await page.keyboard.press('Escape');

await browser.close();
console.log(JSON.stringify({ outDir, errors }, null, 1));
process.exit(errors.length ? 1 : 0);
