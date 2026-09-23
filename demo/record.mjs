// Records the real Workbench (desktop interface) solving the demo bug, as footage for the launch clip.
// Frames come from the Chrome DevTools screencast with their real timestamps, then ffmpeg encodes them
// at a constant 30 fps. Run against a freshly reset demo (see demo/README.md).
// Usage: node demo/record.mjs [out.mp4] [url]
import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'demo/out/app.mp4');
const url = process.argv[3] || 'http://127.0.0.1:9219/workbench';
const PROMPT = 'Checkout totals are off by a cent on some carts. Find the bug and fix it.';
const frameDir = `${out}.frames`;
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto(url, { waitUntil: 'load' });
const app = await (await page.waitForSelector('.hwb-desktop iframe', { timeout: 20000 })).contentFrame();
await app.getByText('New session').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);
// Close the host's own "Update ready" notification (it arrives a few seconds after load), as a user would.
const dismiss = app.getByRole('button', { name: 'Dismiss notification' }).first();
if (await dismiss.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
  await dismiss.click();
  await page.waitForTimeout(800);
}

const frames = [];
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = path.join(frameDir, `${String(frames.length).padStart(5, '0')}.jpg`);
  frames.push({ file, t: metadata.timestamp });
  await writeFile(file, Buffer.from(data, 'base64'));
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
// Without a max size the screencast sends CSS-pixel frames, ignoring the device scale factor.
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: 2160, maxHeight: 1350 });
const marks = { start: Date.now() };

await page.waitForTimeout(700);
await app.locator('[contenteditable="true"]').first().click();
marks.typing = Date.now() - marks.start;
await page.keyboard.type(PROMPT, { delay: 32 });
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
marks.sent = Date.now() - marks.start;
await app.getByText('All 3 tests pass', { exact: false }).first().waitFor({ timeout: 180000 });
marks.done = Date.now() - marks.start;
await page.waitForTimeout(3000);
await cdp.send('Page.stopScreencast');
await page.waitForTimeout(300);
await browser.close();

// Constant-rate encode from the real frame timestamps (each frame holds until the next one).
const list = frames.map((f, i) => {
  const next = frames[i + 1]?.t ?? f.t + 1 / 30;
  // Paths in a concat list resolve against the list's own folder.
  return `file '${path.basename(f.file)}'\nduration ${Math.max(next - f.t, 0.001).toFixed(4)}`;
}).join('\n') + `\nfile '${path.basename(frames.at(-1).file)}'\n`;
await writeFile(`${frameDir}/list.txt`, list);
await writeFile(`${frameDir}/frames.json`, JSON.stringify({ frames, marks }));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${frameDir}/list.txt`,
  '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', out]);
await rm(frameDir, { recursive: true, force: true });
console.log(JSON.stringify({ out, frames: frames.length, marksMs: marks }, null, 1));
