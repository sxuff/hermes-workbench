import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchClient, WorkbenchRpcError, OwnershipError, type Approval, type ApprovalDecision } from '../src/client';

// Deterministic transport fixture only. These tests do not claim backend integration.
class FixtureSocket {
  readyState = 0;
  sent: any[] = [];
  listeners = new Map<string, Array<(e: any) => void>>();
  addEventListener(type: string, listener: (e: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: any = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  open() { this.readyState = 1; this.emit('open'); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', { code: 1006 }); }
  frame(frame: unknown) { this.emit('message', { data: JSON.stringify(frame) }); }
  reply(request: any, result: unknown) { this.frame({ jsonrpc: '2.0', id: request.id, result }); }
  error(request: any, code: number, message = 'denied', data?: unknown) { this.frame({ jsonrpc: '2.0', id: request.id, error: { code, message, data } }); }
  event(type: string, session_id: string, payload: object, seq?: number) { this.frame({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload, seq } }); }
  last() { assert.ok(this.sent.length); return this.sent[this.sent.length - 1]; }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const snapshot = (id = 'a') => ({ session_id: id, stored_session_id: `stored-${id}`, messages: [], info: { profile_name: 'default' } });
async function fixture(t: TestContext, requestTimeoutMs = 1000) {
  const sockets: FixtureSocket[] = [];
  const client = new WorkbenchClient({ api: { getSessionLatestDescendant: async (id: string, profile: string) => { assert.equal(profile, 'default'); return {session_id:id, changed:false}; }, buildWsUrl: (path: string) => { assert.equal(path, '/api/ws'); return 'ws://fixture.invalid/api/ws'; } } }, {
    socketFactory: () => { const s = new FixtureSocket(); sockets.push(s); return s as unknown as WebSocket; },
    autoReconnect: false, heartbeatIntervalMs: 0, connectTimeoutMs: 1000, requestTimeoutMs,
  });
  t.after(() => client.disconnect());
  const connecting = client.connect();
  await tick(); sockets[0].open(); await connecting;
  return { client, socket: sockets[0], sockets };
}
async function create(client: WorkbenchClient, socket: FixtureSocket, id = 'a') {
  const result = client.createSession();
  assert.equal(socket.last().method, 'session.create');
  socket.reply(socket.last(), snapshot(id));
  return result;
}

test('fixture transport: concurrent pending RPCs correlate by ID, not response order or server requests', async t => {
  const { client, socket } = await fixture(t);
  const first = client.listSessions(); const req1 = socket.last();
  const second = client.listSessions(); const req2 = socket.last();
  assert.notEqual(req1.id, req2.id);
  socket.frame({ jsonrpc: '2.0', id: req1.id, method: 'unexpected', params: {} });
  assert.equal(socket.last().error.code, -32601);
  socket.reply(req2, { sessions: [{ id: 'second' }] });
  assert.deepEqual(await second, [{ id: 'second' }]);
  socket.reply(req1, { sessions: [{ id: 'first' }] });
  assert.deepEqual(await first, [{ id: 'first' }]);
  socket.reply(req1, { sessions: [{ id: 'duplicate' }] });
  assert.deepEqual(client.state.sessions, [{ id: 'first' }]);
  await assert.rejects(client.submit('first', 'not owned'), OwnershipError);
});

test('fixture transport: native request listeners are isolated and sequenced per session', async t => {
  const { client, socket } = await fixture(t);
  await create(client, socket, 'a'); await create(client, socket, 'b');
  const requests: string[] = [];
  client.subscribe(() => { throw new Error('bad consumer'); });
  client.onServerRequest(() => { throw new Error('bad consumer'); });
  const unsubscribe = client.onServerRequest(r => requests.push(`${r.session_id}:${r.request_id}`));
  socket.event('message.delta', 'a', { text: 'A' }, 1);
  socket.event('message.delta', 'b', { text: 'B' }, 1);
  socket.event('approval.request', 'a', { request_id: 'approval' }, 2);
  socket.event('approval.request', 'a', { request_id: 'approval' }, 2);
  socket.event('clarify.request', 'b', { request_id: 'question' }, 2);
  assert.deepEqual(requests, ['a:approval', 'b:question']);
  assert.equal(client.state.threads.a.streamingText, 'A');
  assert.equal(client.state.threads.b.streamingText, 'B');
  await assert.rejects(client.respondClarification('a', 'question', 'x'), OwnershipError);
  unsubscribe();
  socket.event('secret.request', 'a', { request_id: 'secret' }, 3);
  assert.equal(requests.length, 2);
});

test('fixture transport: RPC errors preserve code/data and ownership errors reject prompts and revoke control', async t => {
  const { client, socket } = await fixture(t);
  await create(client, socket);
  const prompt = client.submit('a', 'hello');
  const rejection = assert.rejects(prompt, (error: unknown) => {
    assert.ok(error instanceof WorkbenchRpcError);
    assert.equal(error.code, 4090); assert.deepEqual(error.data, { reason: 'foreign-owner' }); return true;
  });
  socket.error(socket.last(), 4090, 'ownership lost', { reason: 'foreign-owner' });
  await rejection;
  assert.equal(client.state.threads.a.messages[0].delivery, 'rejected');
  assert.equal(client.state.threads.a.ownership, 'unknown');
  const count = socket.sent.length;
  await assert.rejects(client.stop('a'), OwnershipError);
  assert.equal(socket.sent.length, count);
});

test('fixture transport: malformed responses reject one RPC; invalid JSON retires socket and all pending requests', async t => {
  const { client, socket } = await fixture(t);
  const malformed = client.listSessions();
  const malformedCheck = assert.rejects(malformed, /Malformed JSON-RPC response/);
  socket.frame({ jsonrpc: '2.0', id: socket.last().id }); await malformedCheck;
  const first = client.listSessions(); const second = client.listSessions();
  const checks = [assert.rejects(first, /Invalid JSON/), assert.rejects(second, /Invalid JSON/)];
  socket.emit('message', { data: '{invalid' }); await Promise.all(checks);
  assert.equal(client.connectionState, 'error'); assert.equal(socket.readyState, 3);
});

test('fixture transport: request timeout marks mutation uncertain, closes socket, and never retries', async t => {
  const { client, socket } = await fixture(t, 20);
  await create(client, socket);
  const promise = client.submit('a', 'only once');
  await assert.rejects(promise, /Delivery may be uncertain/);
  assert.equal(client.state.threads.a.messages[0].delivery, 'uncertain');
  assert.equal(client.state.threads.a.ownership, 'unknown');
  assert.equal(socket.sent.filter(r => r.method === 'prompt.submit').length, 1);
  assert.equal(client.connectionState, 'error');
});

test('fixture transport: reconnect keeps authority revoked if preflight finds a foreign live owner', async t => {
  const { client, socket, sockets } = await fixture(t);
  await create(client, socket);
  const pending = client.submit('a', 'not replayed');
  const rejected = assert.rejects(pending, /WebSocket closed/);
  socket.close(); await rejected;
  await assert.rejects(client.stop('a'), OwnershipError);
  const recovery = client.connect(); await tick(); const next = sockets[1]; next.open(); await tick();
  assert.equal(next.last().method, 'session.active_list');
  await assert.rejects(client.submit('a', 'still no authority'), OwnershipError);
  next.reply(next.last(), { sessions: [{ id: 'foreign-live', session_key: 'stored-a' }] });
  await recovery;
  assert.equal(client.connectionState, 'open');
  assert.equal(client.state.threads.a.ownership, 'unknown');
  assert.match(client.state.threads.a.error ?? '', /already live outside/);
  assert.deepEqual(next.sent.map(r => r.method), ['session.active_list']);
  // A late frame from the replaced transport cannot grant control or add content.
  socket.event('message.delta', 'a', { text: 'stale' }, 10);
  assert.equal(client.state.threads.a.streamingText, '');
  await assert.rejects(client.stop('a'), OwnershipError);
});

test('fixture transport: approval decisions fail closed on stale, prohibited, invalid or unverifiable requests', async t => {
  const { client, socket } = await fixture(t); await create(client, socket);
  const cases: Array<{ approvals: Approval[]; choice: ApprovalDecision; error: RegExp }> = [
    { approvals: [], choice: 'once', error: /no longer pending/ },
    { approvals: [{ request_id: 'p', choices: ['deny'] }], choice: 'once', error: /not permitted/ },
    { approvals: [{ request_id: 'p', smart_denied: true }], choice: 'always', error: /not permitted/ },
    { approvals: [{ request_id: 'p', allow_session: false }], choice: 'session', error: /not permitted/ },
    { approvals: [{ request_id: 'p', allow_permanent: false }], choice: 'always', error: /not permitted/ },
  ];
  for (const c of cases) {
    const p = client.respondApproval('a', 'p', c.choice); const checked = assert.rejects(p, c.error);
    assert.equal(socket.last().method, 'approval.pending');
    socket.reply(socket.last(), { approvals: c.approvals }); await checked;
  }
  const before = socket.sent.length;
  await assert.rejects(client.respondApproval('a', 'p', 'yes' as ApprovalDecision), /Invalid approval choice/);
  assert.equal(socket.sent.length, before);
  const p = client.respondApproval('a', 'p', 'deny'); const checked = assert.rejects(p, /cannot verify/);
  socket.error(socket.last(), -32000, 'cannot verify'); await checked;
  assert.equal(socket.sent.filter(r => r.method === 'approval.respond').length, 0);
});

test('fixture transport: explicit approval sends exact target with all:false and verifies refreshed pending state', async t => {
  const { client, socket } = await fixture(t); await create(client, socket);
  const p = client.respondApproval('a', 'p', 'deny');
  socket.reply(socket.last(), { approvals: [{ request_id: 'p', choices: ['deny'] }] }); await tick();
  assert.equal(socket.last().method, 'approval.respond');
  assert.deepEqual(socket.last().params, { request_id: 'p', choice: 'deny', all: false, session_id: 'a', profile: 'default' });
  socket.reply(socket.last(), { resolved: 1 }); await tick();
  assert.equal(socket.last().method, 'approval.pending');
  socket.reply(socket.last(), { approvals: [] });
  assert.deepEqual(await p, { resolved: 1 });
  assert.deepEqual(client.state.threads.a.approvals, []);
});

test('fixture transport: session creation pins safety fields and refuses incomplete or foreign-profile identity', async t => {
  const { client, socket } = await fixture(t);
  for (const response of [{ session_id: 'bad', messages: [] }, { ...snapshot('bad'), info: { profile_name: 'other' } }]) {
    const p = client.createSession({ title: 'safe', profile: 'other', hidden: true, close_on_disconnect: true } as any);
    const checked = assert.rejects(p, /incomplete|outside the default profile/);
    assert.deepEqual(socket.last().params, { profile: 'default', source: 'dashboard', close_on_disconnect: false, hidden: false, title: 'safe' });
    socket.reply(socket.last(), response); await checked;
  }
  assert.deepEqual(client.state.threads, {});
});
