// Checks that the desktop interface still boots through the shim after a Hermes update.
// Read-only: loads /workbench, waits for the desktop app's sidebar, opens nothing, sends nothing.
// Usage: node scripts/desktop-smoke.mjs [outDir] [dashboardUrl]   (run `hermes workbench` first)
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const outDir = process.argv[2] || 'evidence/desktop';
const url = process.argv[3] || 'http://127.0.0.1:9119/workbench';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const failed = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(url, { waitUntil: 'load' });
const frame = await page.waitForSelector('.hwb-desktop iframe', { timeout: 15000 }).then(el => el.contentFrame()).catch(() => null);
if (!frame) {
  console.log(JSON.stringify({ ok: false, reason: 'desktop interface not installed (run `hermes workbench`)' }));
  process.exit(1);
}
// The desktop sidebar's New session row is the first thing a healthy boot renders.
const booted = await frame.getByText('New session', { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/desktop.png` });
const stubbed = await frame.evaluate(() => [...(window.__hermesWebShimMissing || [])]);
await browser.close();
const ok = booted && !errors.length && !failed.length;
console.log(JSON.stringify({ ok, booted, errors, failed, stubbed }, null, 1));
process.exit(ok ? 0 : 1);
