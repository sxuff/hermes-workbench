# Workbench client contract

Integration target: `import { WorkbenchClient } from './client'` and `import { initialWorkbenchState, workbenchReducer } from './state'`.

Important verified SDK correction: the installed `/opt/hermes/web/src/lib/api.ts` exports `SDK.api.buildWsUrl('/api/ws')`, NOT `SDK.api.wsUrl`. The SDK also exports `SDK.buildWsUrl`. The adapter accepts either verified builder location, obtaining a fresh authenticated URL each connect. It never reads credentials or makes its own token URL.

```ts
const client = new WorkbenchClient(SDK);
const unsubscribe = client.subscribe(action => dispatch(action));
await client.connect();
const sessions = await client.listSessions(); // SessionSummary[]
const session = await client.createSession({title: 'New session', cwd: '/opt/data'});
// or await client.resumeSession(storedSessionId)
await client.submit(session.session_id, 'Hello');
```

Public methods: `connect()`, `disconnect()`, `subscribe(action)`, `onEvent(handler)`, `onState(handler)`, `createSession(options?)`, `resumeSession(storedSessionId)`, `listSessions(limit?)`, `history(sessionId)`, `submit(sessionId,text)`, `queue(sessionId,text)`, `steer(sessionId,text)`, `stop(sessionId)`, `rename(sessionId,title)`, `fork(sessionId)`, `listAgents(sessionId)`, `steerAgent(sessionId,agentId,text)`, `stopAgent(sessionId,agentId)`, `refreshApprovals(sessionId)`, `respondApproval(sessionId,requestId,decision)`, `respondClarification(sessionId,requestId,answer)`. All operations return promises except subscriptions/disconnect. Server-side sudo/secret prompts are surfaced, never automatically answered.

State contract: `connection`, `sessions` (summary array), `threads` (record keyed by live session ID), `activeSessionId`, `error`. A thread has `session`, `messages`, `streamingText`, `reasoningText`, `tools`, `todos`, `approvals`, `agents`, `running`, `ownership` (`owned` or `unknown`), and `error`. `messages` is the ordered timeline: live tool events insert a `role: 'tool'` row (with `tool_id`, `live: true`) where the tool started, sealing any text or reasoning streamed before it into its own interim assistant row; `tools` indexes the current turn's rows by ID. `todos` comes from `todo_state` on bind, `todo.updated`, and todo snapshots on `tool.complete`. Actions are exported as `WorkbenchAction`; subscribing dispatches lifecycle, session snapshots, history, agents, approval snapshots, and native events. The reducer is pure. Native events preserve `type`, `session_id`, `payload`, and `seq`.

Safety: new/resumed sessions can be controlled only after a successful native ownership bind. Read-only listing does not grant control. Disconnect revokes local control, reconnect rebinds only this client's previous sessions, then refreshes native pending approvals. No take-control API, no automatic retry of prompt sends, no approval auto-accept. Request errors retain JSON-RPC code and data. The adapter is scoped explicitly to profile `default`.

Runtime safety findings: `session.resume` is a multi-viewer transport bind, NOT an exclusive takeover/lease. Adapter refuses to resume an already-live foreign session found by `session.active_list`; only its own remembered live IDs may reconnect. Native cross-process ownership refusal is JSON-RPC 4090 with structured `data.reason`, which revokes local control. `ownership: owned` means this adapter created/bound the session, not a guaranteed server-side exclusive lock. Native API exposes no atomic browser-owner claim. `subagent.interrupt` is globally addressed server-side, so adapter MUST verify fresh `delegation.status` membership against `owner_agent_session_id` before sending. `agents.list` is terminal processes, NOT subagents; use `delegation.status` instead. This transport uses full resume snapshots on reconnect, not guaranteed lossless token replay.

`ThreadState.approvals` and `.agents` are arrays. `.requests` is an array of `ServerRequest` objects (`type`, `session_id`, `request_id`, `payload`) for native approval/clarify/sudo/secret request events. UI can subscribe via `client.onServerRequest(handler)` as well. Explicit approval choices: `once | session | always | deny`; choices prohibited by request policy are rejected. Sudo/secret responses are intentionally unsupported in this workbench. Clarification supports optional fifth `questionId` argument for batch questions. All native event payloads are preserved.
