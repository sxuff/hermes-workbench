import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorkbenchState, workbenchReducer as reduce } from '../src/state';
import type { NativeSession, GatewayEvent } from '../src/client';

const session = (id: string, extra: Partial<NativeSession> = {}): NativeSession => ({
  session_id: id, stored_session_id: `stored-${id}`, messages: [], info: {}, ...extra,
});
const bound = () => ['a', 'b'].reduce((s, id) => reduce(s, { type: 'session.bound', session: session(id) }), createInitialWorkbenchState());
const event = (s: ReturnType<typeof bound>, session_id: string, type: string, payload: GatewayEvent['payload'] = {}, seq?: number) => reduce(s, { type: 'event', event: { session_id, type, payload, seq } });

test('reducer: interleaved streams and sequence deduplication are session-local and immutable', () => {
  const initial = bound();
  let s = event(initial, 'a', 'message.start', {}, 1);
  s = event(s, 'b', 'message.start', {}, 1);
  s = event(s, 'a', 'message.delta', { text: 'hello' }, 2);
  s = event(s, 'b', 'message.delta', { text: 'other' }, 2);
  s = event(s, 'a', 'message.delta', { text: 'DUPLICATE' }, 2);
  s = event(s, 'a', 'message.delta', { text: 'STALE' }, 1);
  s = event(s, 'a', 'thinking.delta', { text: 'reason' }, 3);
  const untouchedB = s.threads.b;
  s = event(s, 'a', 'message.complete', {}, 4);
  assert.deepEqual(s.threads.a.messages, [{ role: 'assistant', text: 'hello', reasoning: 'reason' }]);
  assert.equal(s.threads.a.streamingText, '');
  assert.equal(s.threads.a.reasoningText, '');
  assert.equal(s.threads.a.running, false);
  assert.equal(s.threads.b, untouchedB);
  assert.equal(s.threads.b.streamingText, 'other');
  assert.equal(s.threads.b.running, true);
  assert.equal(initial.threads.a.messages.length, 0);
  assert.equal(initial.threads.a.streamingText, '');
  assert.equal(event(s, 'foreign', 'message.delta', { text: 'unsafe' }), s);
});

test('reducer: tools, delegation, usage and terminal error events preserve payloads', () => {
  let s = bound();
  s = event(s, 'a', 'tool.start', { tool_id: 'tool-1', name: 'terminal', args: { command: 'pwd' } });
  s = event(s, 'a', 'tool.progress', { tool_id: 'tool-1', context: 'running' });
  s = event(s, 'a', 'tool.complete', { tool_id: 'tool-1', result: '/tmp' });
  assert.deepEqual(s.threads.a.tools['tool-1'], { tool_id: 'tool-1', name: 'terminal', args: { command: 'pwd' }, context: 'running', result: '/tmp', status: 'complete' });
  s = event(s, 'a', 'subagent.start', { subagent_id: 'agent', goal: 'check' });
  s = event(s, 'a', 'subagent.complete', { subagent_id: 'agent' });
  assert.deepEqual(s.threads.a.agents, [{ subagent_id: 'agent', goal: 'check', status: 'complete' }]);
  s = event(s, 'a', 'session.usage', { tokens: 42 });
  s = event(s, 'a', 'message.complete', { status: 'error', error: 'failed', text: '' });
  assert.deepEqual(s.threads.a.usage, { tokens: 42 });
  assert.equal(s.threads.a.error, 'failed');
  assert.equal(s.threads.a.running, false);
  assert.deepEqual(s.threads.b.tools, {});
  assert.equal(s.threads.b.error, null);
});

test('reducer: pending requests replace by ID, refresh preserves clarification, resolution stays local', () => {
  let s = bound();
  s = event(s, 'a', 'approval.request', { request_id: 'same', command: 'old' });
  s = event(s, 'a', 'approval.request', { request_id: 'same', command: 'new' });
  s = event(s, 'b', 'approval.request', { request_id: 'same', command: 'other session' });
  s = event(s, 'a', 'clarify.request', { request_id: 'question', question: 'which?' });
  s = event(s, 'a', 'secret.request', { description: 'missing ID ignored' });
  assert.equal(s.threads.a.requests.length, 2);
  assert.equal(s.threads.a.approvals[0].command, 'new');
  s = reduce(s, { type: 'approvals', sessionId: 'a', approvals: [] });
  assert.deepEqual(s.threads.a.requests.map(r => r.request_id), ['question']);
  s = event(s, 'a', 'clarify.timeout', { request_id: 'question' });
  assert.deepEqual(s.threads.a.requests, []);
  assert.equal(s.threads.b.approvals.length, 1);
});

test('reducer: disconnect revokes authority; snapshot remaps identity and repairs inflight history', () => {
  let s = bound();
  s = reduce(s, { type: 'session.select', sessionId: 'a' });
  s = reduce(s, { type: 'connection', connection: 'closed' });
  s = reduce(s, { type: 'connection', connection: 'open' });
  assert.equal(s.threads.a.ownership, 'unknown');
  assert.equal(s.threads.b.ownership, 'unknown');
  s = reduce(s, { type: 'session.bound', previousSessionId: 'a', activate: false, session: session('new-a', {
    messages: [{ role: 'user', text: 'question' }], inflight: { user: 'question', assistant: 'partial' }, running: true,
    pending_approval: { request_id: 'approval' }, pending_clarify: { request_id: 'clarify' },
  }) });
  assert.equal(s.threads.a, undefined);
  assert.equal(s.activeSessionId, 'new-a');
  assert.equal(s.threads['new-a'].messages.length, 1);
  assert.equal(s.threads['new-a'].streamingText, 'partial');
  assert.equal(s.threads['new-a'].ownership, 'owned');
  assert.equal(s.threads['new-a'].requests.length, 2);
  s = reduce(s, { type: 'event', event: { type: 'session.reclaimed', payload: { stored_session_id: 'stored-new-a' } } });
  assert.equal(s.threads['new-a'].ownership, 'unknown');
  assert.equal(s.threads['new-a'].running, false);
});

test('reducer: prompt outcomes update exact client ID without contaminating another session', () => {
  let s = bound();
  s = reduce(s, { type: 'prompt.pending', sessionId: 'a', clientId: 'one', text: 'first', mode: 'submit' });
  s = reduce(s, { type: 'prompt.pending', sessionId: 'a', clientId: 'two', text: 'second', mode: 'queue' });
  s = reduce(s, { type: 'prompt.result', sessionId: 'a', clientId: 'one', status: 'uncertain' });
  assert.deepEqual(s.threads.a.messages.map(m => m.delivery), ['uncertain', 'pending']);
  assert.deepEqual(s.threads.b.messages, []);
});
