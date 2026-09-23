// Deterministic UI smoke: runs the installed Workbench inside a real dashboard page, but
// replaces the gateway WebSocket with a scripted fake so a full turn renders without a model.
// Usage: node scripts/fixture-smoke.mjs [outDir] [dashboardUrl]
// Needs the plugin installed (npm run install:plugin) and a local dashboard running.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const outDir = process.argv[2] || 'evidence/fixture';
const url = process.argv[3] || 'http://127.0.0.1:9119/workbench?ui=classic';
await mkdir(outDir, { recursive: true });

function fakeGateway() {
  const RealWebSocket = window.WebSocket;
  const sid = 'live-fixture', stored = 'stored-fixture';
  let seq = 0, approvals = [], waiters = {};
  const diff = ['--- a/src/app.tsx', '+++ b/src/app.tsx', '@@ -12,3 +12,4 @@', ' const text = (v) => v;', '-const tools = [];', '+const tools = new Map();', '+const todos = [];', ' export default text;'].join('\n');
  const finalText = [
    'Done. The marker is **WORKBENCH_ALPHA_OK**.',
    '',
    '### What changed',
    '- Tool rows now stay inside the turn that ran them',
    '- `tools` became a `Map` so updates keep their position',
    '',
    '```ts',
    "const row = { ...tool, role: 'tool', live: true };",
    'messages.splice(index, 1, row);',
    '```',
    '',
    '| Check | Result |',
    '| --- | --- |',
    '| Typecheck | pass |',
    '| Tests | 19/19 |',
  ].join('\n');
  class FakeSocket extends EventTarget {
    constructor(u) {
      super(); this.url = u; this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); this.event('gateway.ready', { heartbeat: false }, ''); }, 30);
    }
    close() { this.readyState = 3; }
    push(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })); }
    event(type, payload, session_id = sid) { this.push({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload, ...(session_id ? { seq: ++seq } : {}) } }); }
    async script(steps) { for (const [delay, fn] of steps) { await new Promise(r => setTimeout(r, delay)); await fn(); } }
    stream(text, size = 12) { const out = []; for (let i = 0; i < text.length; i += size) out.push([25, () => this.event('message.delta', { text: text.slice(i, i + size) })]); return out; }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      const reply = result => setTimeout(() => this.push({ jsonrpc: '2.0', id, result }), 20);
      switch (method) {
        case 'session.list': return reply({ sessions: [
          { id: 'stored-a', title: 'Refactor gateway client', source: 'dashboard', message_count: 12 },
          { id: 'stored-b', title: 'Nightly dependency audit', source: 'cron', message_count: 4 },
          { id: 'stored-c', title: 'Ship the release notes', source: 'telegram', message_count: 9 },
        ] });
        case 'session.create': return reply({ session_id: sid, stored_session_id: stored, messages: [], info: { model: 'fixture-model', cwd: '/work/hermes-workbench', title: 'Workbench fixture' }, title: 'Workbench fixture' });
        case 'session.title': return reply({ title: params.title || 'Workbench fixture' });
        case 'delegation.status': return reply({ active: [] });
        case 'approval.pending': return reply({ approvals });
        case 'gateway.ping': return reply({ ok: true });
        case 'prompt.submit':
          reply({ status: 'accepted' });
          return void this.script([
            [150, () => this.event('message.start', {})],
            ...['Checking the layout, ', 'then asking which ', 'marker to echo.'].map(t => [120, () => this.event('thinking.delta', { text: t })]),
            ...this.stream("I'll look at the source tree first."),
            [80, () => this.event('message.interim', { text: "I'll look at the source tree first.", already_streamed: true })],
            [60, () => this.event('tool.start', { tool_id: 't1', name: 'terminal', context: 'ls src', args: { command: 'ls src' } })],
            [500, () => this.event('tool.complete', { tool_id: 't1', name: 'terminal', duration_s: 0.4, result_text: 'app.tsx\nclient.ts\nstate.ts\nui/' })],
            [80, () => this.event('todo.updated', { revision: 1, todos: [{ id: '1', content: 'Inspect the source tree', status: 'completed' }, { id: '2', content: 'Ask which marker to use', status: 'in_progress' }, { id: '3', content: 'Echo the marker', status: 'pending' }] })],
            [200, () => this.event('clarify.request', { request_id: 'q1', question: 'Which marker?', choices: ['ALPHA', 'BETA'] })],
            [0, () => new Promise(r => { waiters.clarify = r; })],
            [150, () => this.event('tool.start', { tool_id: 't2', name: 'patch', args: { path: 'src/app.tsx' }, context: 'src/app.tsx' })],
            [400, () => this.event('tool.complete', { tool_id: 't2', name: 'patch', duration_s: 0.2, inline_diff: diff, result_text: 'Applied 1 hunk' })],
            [150, () => { approvals = [{ request_id: 'a1', command: 'rm -rf build/ && npm run build', description: 'Clean and rebuild the bundle' }]; this.event('approval.request', approvals[0]); }],
            [0, () => new Promise(r => { waiters.approval = r; })],
            [100, () => this.event('tool.start', { tool_id: 't3', name: 'terminal', context: 'echo WORKBENCH_ALPHA_OK', args: { command: 'echo WORKBENCH_ALPHA_OK' } })],
            [400, () => this.event('tool.complete', { tool_id: 't3', name: 'terminal', duration_s: 0.1, result_text: 'WORKBENCH_ALPHA_OK' })],
            [60, () => this.event('todo.updated', { revision: 2, todos: [{ id: '1', content: 'Inspect the source tree', status: 'completed' }, { id: '2', content: 'Ask which marker to use', status: 'completed' }, { id: '3', content: 'Echo the marker', status: 'completed' }] })],
            ...this.stream(finalText, 24),
            [200, () => this.event('message.complete', { text: finalText, status: 'complete', usage: { input_tokens: 1200, output_tokens: 180 } })],
          ]);
        case 'clarify.respond': reply({ status: 'ok', remaining: [] }); waiters.clarify?.(); return;
        case 'approval.respond':
          approvals = []; reply({ resolved: 1 });
          setTimeout(() => { this.event('approval.resolved', { request_id: params.request_id }); waiters.approval?.(); }, 50); return;
        default: return setTimeout(() => this.push({ jsonrpc: '2.0', id, error: { code: -32601, message: `fixture: ${method}` } }), 20);
      }
    }
  }
  window.WebSocket = function (u, p) { return String(u).includes('/api/ws') ? new FakeSocket(u) : new RealWebSocket(u, p); };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const results = [];
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeGateway);
  await page.addInitScript(t => { try { localStorage.setItem('hermes-workbench:theme', t); sessionStorage.clear(); } catch {} }, theme);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.hwb-statusbar')?.textContent?.includes('Gateway ready'), null, { timeout: 20000 });
  await page.screenshot({ path: `${outDir}/${theme}-empty.png` });
  await page.fill('.hwb-composer textarea', 'Echo a marker after asking me which one.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hwb-choice', { timeout: 20000 });
  await page.getByRole('button', { name: /Toggle details panel/ }).click();
  await page.screenshot({ path: `${outDir}/${theme}-clarify.png` });
  await page.getByRole('button', { name: /ALPHA/ }).click();
  await page.waitForSelector('.hwb-request.is-approval', { timeout: 20000 });
  await page.screenshot({ path: `${outDir}/${theme}-approval.png` });
  await page.getByRole('button', { name: 'Allow once' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${theme}-streaming.png` });
  await page.waitForFunction(() => !document.querySelector('.hwb-round-btn.is-stop'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${theme}-done.png` });
  const order = await page.evaluate(() => [...document.querySelectorAll('.hwb-thread-inner > *')].map(el => el.className.split(' ')[0]));
  results.push({ theme, errors, order });
  await page.close();
}
await browser.close();
// Three settled tools collapse into one group row, between the interim text and the final answer.
const expected = ['hwb-turn-user', 'hwb-turn-assistant', 'hwb-scaffold', 'hwb-turn-assistant'];
const ok = results.every(r => !r.errors.length && JSON.stringify(r.order) === JSON.stringify(expected));
console.log(JSON.stringify({ ok, results }, null, 1));
process.exit(ok ? 0 : 1);
