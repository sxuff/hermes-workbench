/**
 * Small browser JSON-RPC adapter, implemented against the installed runtime:
 * /opt/hermes/{tui_gateway/{ws,server,methods_session,methods_prompt}.py,
 * tools/delegate_tool.py,web/src/{lib/api.ts,plugins/sdk.d.ts}}.
 * Transport semantics reviewed against apps/shared/src/json-rpc-gateway.ts
 * (Nous Research, MIT). This is an independent transport, not a vendored copy.
 * Full resume snapshots repair reconnects; no claim of lossless token replay.
 */
import { createInitialWorkbenchState, workbenchReducer, type WorkbenchAction, type WorkbenchState } from './state';
export type { WorkbenchAction, WorkbenchState } from './state';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
export type ApprovalDecision = 'once' | 'session' | 'always' | 'deny';
export interface GatewayEvent { type: string; session_id?: string; payload?: Record<string, unknown>; seq?: number }
export interface NativeMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'; text?: string; name?: string;
  row_id?: number; timestamp?: number; reasoning?: unknown; client_id?: string;
  delivery?: string; [key: string]: unknown;
}
export interface Approval extends Record<string, unknown> {
  request_id: string; command?: string; description?: string; choices?: ApprovalDecision[];
  allow_session?: boolean; allow_permanent?: boolean; smart_denied?: boolean;
}
export interface NativeSession {
  session_id: string; stored_session_id: string; messages: NativeMessage[];
  message_count?: number; info: Record<string, unknown>; title?: string;
  running?: boolean; status?: string; inflight?: Record<string, unknown> | null;
  pending_approval?: Approval; pending_clarify?: Record<string, unknown>; queued?: unknown;
  [key: string]: unknown;
}
export interface SessionSummary {
  id: string; title?: string; preview?: string; source?: string; started_at?: number;
  message_count?: number; resolved_id?: string; [key: string]: unknown;
}
export interface Subagent extends Record<string, unknown> {
  subagent_id: string; parent_id?: string | null; owner_agent_session_id?: string | null;
  goal?: string; model?: string | null; depth?: number; status?: string; started_at?: number;
}
export interface ServerRequest {
  type: string; session_id: string; request_id: string; payload: Record<string, unknown>;
}
export interface CreateSessionOptions { title?: string; cwd?: string; model?: string; provider?: string; reasoning_effort?: string; fast?: boolean }
export interface PromptResult { status?: string; voice_stopped?: boolean; [key: string]: unknown }
export interface SDKLike {
  api?: object;
  buildWsUrl?: (path: string, params?: Record<string, string>) => Promise<string> | string;
}
export interface ClientOptions {
  socketFactory?: (url: string) => WebSocket;
  connectTimeoutMs?: number; requestTimeoutMs?: number;
  autoReconnect?: boolean; reconnectDelayMs?: number;
  heartbeatIntervalMs?: number; heartbeatDeadlineMs?: number;
}
export interface IWorkbenchClient {
  readonly state: WorkbenchState;
  readonly connectionState: ConnectionState;
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(handler: (action: WorkbenchAction) => void): () => void;
  onEvent(handler: (event: GatewayEvent) => void): () => void;
  onState(handler: (state: ConnectionState) => void): () => void;
  onServerRequest(handler: (request: ServerRequest) => void): () => void;
  createSession(options?: CreateSessionOptions): Promise<NativeSession>;
  resumeSession(storedSessionId: string): Promise<NativeSession>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  history(sessionId: string): Promise<NativeMessage[]>;
  submit(sessionId: string, text: string): Promise<PromptResult>;
  queue(sessionId: string, text: string): Promise<PromptResult>;
  steer(sessionId: string, text: string): Promise<PromptResult>;
  stop(sessionId: string): Promise<{ status: string; interrupted?: boolean }>;
  rename(sessionId: string, title: string): Promise<{ title: string; pending?: boolean }>;
  fork(sessionId: string, options?: { name?: string; count?: number }): Promise<NativeSession>;
  listAgents(sessionId: string): Promise<Subagent[]>;
  steerAgent(sessionId: string, agentId: string, text: string): Promise<PromptResult>;
  stopAgent(sessionId: string, agentId: string): Promise<{ found: boolean; subagent_id: string }>;
  refreshApprovals(sessionId: string): Promise<Approval[]>;
  respondApproval(sessionId: string, requestId: string, choice: ApprovalDecision): Promise<{ resolved: number }>;
  respondClarification(sessionId: string, requestId: string, answer: string, questionId?: string): Promise<{ status: string; remaining?: string[] }>;
}
export class WorkbenchRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  readonly method?: string;
  constructor(message: string, options: { code?: number; data?: unknown; method?: string } = {}) {
    super(message); this.name = 'WorkbenchRpcError';
    this.code = options.code; this.data = options.data; this.method = options.method;
  }
}
export class OwnershipError extends Error {
  constructor(message = 'Session control is not verified. Resume explicitly before sending commands.') { super(message); this.name = 'OwnershipError'; }
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown): string => typeof v === 'string' ? v : '';
const errorOf = (v: unknown): Error => v instanceof Error ? v : new Error(String(v));
const validText = (v: string, label = 'Text'): string => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} is required`); return v; };
// One bad UI listener must never strand pending RPCs or disable safety listeners.
function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) { try { listener(value); } catch { /* isolated consumer */ } }
}
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Remembered = { liveId: string; storedId: string };

export class WorkbenchClient implements IWorkbenchClient {
  private current = createInitialWorkbenchState();
  private socket: WebSocket | null = null;
  private pending = new Map<string | number, Pending>();
  private owned = new Set<string>();
  private remembered = new Map<string, Remembered>();
  private restoredActive: string | null = null;
  private readonly storageKey = 'hermes-workbench:default:owned:v1';
  private persistRemembered(): void {
    if (typeof window === 'undefined') return;
    try { globalThis.sessionStorage?.setItem(this.storageKey, JSON.stringify({sessions:[...this.remembered.values()],active:this.current.activeSessionId})); } catch {}
  }
  setActiveSession(sessionId: string | null): void { this.emit({ type: 'session.select', sessionId }); this.persistRemembered(); }
  private actions = new Set<(a: WorkbenchAction) => void>();
  private events = new Set<(e: GatewayEvent) => void>();
  private states = new Set<(s: ConnectionState) => void>();
  private requests = new Set<(r: ServerRequest) => void>();
  private earlyEvents: GatewayEvent[] = [];
  private resuming = new Set<string>();
  private serial = 0;
  private generation = 0;
  private connecting: Promise<void> | null = null;
  private cancelConnect: ((error: Error) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private wantConnection = false;
  private readonly options: Required<ClientOptions>;
  constructor(private readonly sdk: SDKLike, options: ClientOptions = {}) {
    this.options = {
      socketFactory: options.socketFactory ?? (url => new WebSocket(url)),
      connectTimeoutMs: options.connectTimeoutMs ?? 15_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelayMs: options.reconnectDelayMs ?? 1_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
      heartbeatDeadlineMs: options.heartbeatDeadlineMs ?? 45_000,
    };
    // Tab-scoped IDs only, never prompts or tokens. Gateway ownership checks
    // still run on every resume. A new tab does not silently claim sessions.
    try {
      const saved = JSON.parse(typeof window !== 'undefined' ? globalThis.sessionStorage?.getItem(this.storageKey) || '{}' : '{}');
      for (const r of (Array.isArray(saved.sessions) ? saved.sessions.slice(0, 50) : [])) {
        if (typeof r.liveId === 'string' && typeof r.storedId === 'string') this.remembered.set(r.liveId, r);
      }
      this.restoredActive = typeof saved.active === 'string' ? saved.active : null;
    } catch {}
  }
  get state(): WorkbenchState { return this.current; }
  get connectionState(): ConnectionState { return this.current.connection; }
  subscribe(handler: (action: WorkbenchAction) => void): () => void { this.actions.add(handler); return () => { this.actions.delete(handler); }; }
  onEvent(handler: (event: GatewayEvent) => void): () => void { this.events.add(handler); return () => { this.events.delete(handler); }; }
  onServerRequest(handler: (request: ServerRequest) => void): () => void { this.requests.add(handler); return () => { this.requests.delete(handler); }; }
  onState(handler: (state: ConnectionState) => void): () => void { this.states.add(handler); notify(new Set([handler]), this.connectionState); return () => { this.states.delete(handler); }; }
  private emit(action: WorkbenchAction): void { this.current = workbenchReducer(this.current, action); notify(this.actions, action); }
  private setState(connection: ConnectionState): void {
    if (connection !== 'open') this.owned.clear();
    this.emit({ type: 'connection', connection }); notify(this.states, connection);
  }

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.socket?.readyState === 1 && this.connectionState === 'open') return Promise.resolve();
    this.wantConnection = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const generation = ++this.generation;
    this.setState('connecting');
    const work = this.openSocket(generation).then(async () => {
      // Reconnect only sessions this instance previously created/bound. No send retry.
      for (const remembered of [...this.remembered.values()]) {
        if (generation !== this.generation) throw new Error('Connection replaced');
        try { await this.bindResume(remembered.storedId, remembered.liveId, remembered.liveId === this.restoredActive); }
        catch (error) {
          this.revoke(remembered.liveId, errorOf(error).message);
          this.emit({ type: 'error', sessionId: remembered.liveId, error: errorOf(error).message });
        }
      }
      if (generation !== this.generation || this.socket?.readyState !== 1) throw new Error('Connection closed during recovery');
      this.reconnectAttempts = 0;
      this.restoredActive = null;
    }).catch(error => {
      if (generation === this.generation) this.fail(errorOf(error), 'error');
      throw error;
    }).finally(() => { if (this.connecting === work) this.connecting = null; });
    this.connecting = work;
    return work;
  }
  private openSocket(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.cancelConnect = null;
        if (error) reject(error); else resolve();
      };
      this.cancelConnect = error => finish(error);
      const timer = setTimeout(() => finish(new Error('WebSocket connection timed out')), this.options.connectTimeoutMs);
      void (async () => {
        const api = object(this.sdk.api);
        const build = typeof api.buildWsUrl === 'function' ? api.buildWsUrl as (path: string) => Promise<string> | string : this.sdk.buildWsUrl;
        if (typeof build !== 'function') throw new Error('Hermes SDK buildWsUrl is unavailable. The installed SDK has no api.wsUrl method.');
        const url = await build.call(typeof api.buildWsUrl === 'function' ? this.sdk.api : this.sdk, '/api/ws');
        if (settled || generation !== this.generation || !this.wantConnection) return;
        if (typeof url !== 'string' || !['ws:', 'wss:'].includes(new URL(url).protocol)) throw new Error('SDK returned an invalid WebSocket URL');
        const socket = this.options.socketFactory(url);
        this.socket = socket;
        const current = () => generation === this.generation && this.socket === socket;
        socket.addEventListener('open', () => {
          if (!current()) return;
          this.setState('open'); finish();
        });
        socket.addEventListener('message', event => { if (current()) this.receive(event.data); });
        socket.addEventListener('error', () => {
          if (!current()) return;
          const error = new Error('WebSocket connection failed'); finish(error); this.fail(error, 'error');
        });
        socket.addEventListener('close', event => {
          if (!current()) return;
          const error = new Error(`WebSocket closed (${event.code})`); finish(error); this.fail(error, 'closed');
        });
      })().catch(error => finish(errorOf(error)));
    });
  }
  disconnect(): void {
    this.wantConnection = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.fail(new Error('Workbench disconnected'), 'closed');
  }
  private fail(error: Error, state: ConnectionState): void {
    ++this.generation;
    const socket = this.socket; this.socket = null;
    this.cancelConnect?.(error); this.cancelConnect = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.earlyEvents = [];
    this.resuming.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.setState(state);
    if (state === 'error') this.emit({ type: 'error', error: error.message });
    try { socket?.close(); } catch { /* already failed */ }
    if (this.wantConnection && this.options.autoReconnect && !this.reconnectTimer) {
      const delay = Math.min(30_000, this.options.reconnectDelayMs * 2 ** Math.min(this.reconnectAttempts++, 5));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect().catch(() => { /* surfaced by fail */ });
      }, delay);
    }
  }
  private rpc<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = this.options.requestTimeoutMs): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || this.connectionState !== 'open') return Promise.reject(new Error('Gateway not connected'));
    const id = `workbench-${++this.serial}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // Delivery is ambiguous. Retire the socket and never retry a mutation.
        this.fail(new WorkbenchRpcError(`Request timed out: ${method}. Delivery may be uncertain; do not resend blindly.`, { method }), 'error');
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); }
      catch (error) { this.fail(errorOf(error), 'error'); }
    });
  }
  private receive(raw: unknown): void {
    let frame: Record<string, unknown>;
    try { frame = object(JSON.parse(typeof raw === 'string' ? raw : String(raw))); }
    catch { this.fail(new Error('Invalid JSON received from gateway'), 'error'); return; }
    // Native interactive requests are event notifications, not RPC calls.
    // Never mistake an unexpected server RPC request's id for our pending id.
    if (typeof frame.method === 'string' && frame.id !== undefined && frame.id !== null) {
      try { this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Workbench handles native request events only' } })); }
      catch (error) { this.fail(errorOf(error), 'error'); }
      return;
    }
    if ((typeof frame.id === 'string' || typeof frame.id === 'number') && !frame.method) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id); clearTimeout(pending.timer);
      if (frame.error) {
        const error = object(frame.error);
        pending.reject(new WorkbenchRpcError(string(error.message) || 'Hermes RPC failed', { code: typeof error.code === 'number' ? error.code : undefined, data: error.data }));
      } else if ('result' in frame) pending.resolve(frame.result);
      else pending.reject(new WorkbenchRpcError('Malformed JSON-RPC response'));
      return;
    }
    const params = object(frame.params);
    if (frame.method !== 'event' || typeof params.type !== 'string') return;
    const event: GatewayEvent = { type: params.type,
      ...(typeof params.session_id === 'string' ? { session_id: params.session_id } : {}),
      ...(typeof params.seq === 'number' ? { seq: params.seq } : {}), payload: object(params.payload),
    };
    if (event.type === 'gateway.ready' && event.payload?.heartbeat === true) this.startHeartbeat();
    if (event.type === 'session.reclaimed') {
      for (const [id, r] of this.remembered) {
        if (id === event.payload?.session_id || r.storedId === event.payload?.stored_session_id) this.revoke(id, 'Session reclaimed by the gateway');
      }
    }
    if (event.session_id && this.resuming.has(event.session_id)) {
      this.earlyEvents.push(event);
      return;
    }
    if (event.session_id && !this.current.threads[event.session_id]) {
      this.earlyEvents.push(event); if (this.earlyEvents.length > 256) this.earlyEvents.shift();
    }
    this.deliverEvent(event);
  }
  private startHeartbeat(): void {
    if (this.heartbeatTimer || this.options.heartbeatIntervalMs <= 0) return;
    let inflight = false;
    this.heartbeatTimer = setInterval(() => {
      if (inflight) return;
      inflight = true;
      void this.rpc('gateway.ping', {}, this.options.heartbeatDeadlineMs).catch(() => {}).finally(() => { inflight = false; });
    }, this.options.heartbeatIntervalMs);
  }
  private deliverEvent(event: GatewayEvent): void {
    const sid = event.session_id;
    const priorSeq = sid ? this.current.threads[sid]?.lastSeq : undefined;
    if (typeof event.seq === 'number' && priorSeq !== undefined && event.seq <= priorSeq) return;
    this.emit({ type: 'event', event });
    if (sid && event.type === 'session.info') {
      const remembered = this.remembered.get(sid);
      const key = string(event.payload?.stored_session_id);
      if (remembered && key) remembered.storedId = key;
      this.persistRemembered();
    }
    notify(this.events, event);
    if (sid && event.type.endsWith('.request') && typeof event.payload?.request_id === 'string') {
      notify(this.requests, { type: event.type, session_id: sid, request_id: event.payload.request_id, payload: event.payload });
    }
  }
  private requireOwned(sessionId: string): NativeSession {
    const session = this.current.threads[sessionId]?.session;
    if (!session || !this.owned.has(sessionId) || this.connectionState !== 'open') throw new OwnershipError();
    return session;
  }
  private revoke(sessionId: string, error: string): void {
    this.owned.delete(sessionId); this.remembered.delete(sessionId);
    this.emit({ type: 'session.revoked', sessionId, error });
    this.persistRemembered();
  }
  private async controlled<T>(sessionId: string, method: string, extra: Record<string, unknown> = {}): Promise<T> {
    this.requireOwned(sessionId);
    try { return await this.rpc<T>(method, { ...extra, session_id: sessionId, profile: 'default' }); }
    catch (error) {
      if (error instanceof WorkbenchRpcError && [4001, 4007, 4090, 4122].includes(error.code ?? 0)) this.revoke(sessionId, error.message);
      this.emit({ type: 'error', sessionId, error: errorOf(error).message }); throw error;
    }
  }
  private bind(raw: unknown, previousSessionId?: string, activate = true): NativeSession {
    const data = object(raw);
    const sid = string(data.session_id);
    const info = object(data.info);
    const stored = string(data.stored_session_id) || string(data.session_key) || string(data.resumed) || string(info.stored_session_id);
    if (!sid || !stored || !Array.isArray(data.messages)) throw new Error('Gateway returned an incomplete session identity or transcript');
    // Older launch-profile responses use an empty profile_name. Explicit other profiles are refused.
    if (info.profile_name && info.profile_name !== 'default') throw new OwnershipError('Gateway returned a session outside the default profile');
    const session = { ...data, session_id: sid, stored_session_id: stored, messages: data.messages, info } as NativeSession;
    if (previousSessionId && previousSessionId !== sid) { this.owned.delete(previousSessionId); this.remembered.delete(previousSessionId); }
    this.owned.add(sid); this.remembered.set(sid, { liveId: sid, storedId: stored });
    this.emit({ type: 'session.bound', session, previousSessionId, activate });
    this.persistRemembered();
    for (const request of this.current.threads[sid]?.requests ?? []) notify(this.requests, request);
    const buffered = this.earlyEvents.filter(e => e.session_id === sid);
    this.earlyEvents = this.earlyEvents.filter(e => e.session_id !== sid);
    for (const event of buffered) this.deliverEvent(event);
    return session;
  }
  async createSession(options: CreateSessionOptions = {}): Promise<NativeSession> {
    // Pick only declared fields so JS callers cannot override profile/source/safety flags.
    const params: Record<string, unknown> = { profile: 'default', source: 'dashboard', close_on_disconnect: false, hidden: false };
    for (const key of ['title', 'cwd', 'model', 'provider', 'reasoning_effort', 'fast'] as const) if (options[key] !== undefined) params[key] = options[key];
    return this.bind(await this.rpc('session.create', params));
  }
  async resumeSession(storedSessionId: string): Promise<NativeSession> {
    validText(storedSessionId, 'Stored session ID');
    const known = [...this.remembered.values()].find(r => r.storedId === storedSessionId);
    return this.bindResume(storedSessionId, known?.liveId, true);
  }
  private async bindResume(storedSessionId: string, previousSessionId?: string, activate = true): Promise<NativeSession> {
    // session.resume can redirect a compression ancestor and bind its transport
    // before returning. Refuse non-leaf history instead of checking too late.
    const api = object(this.sdk.api);
    if (typeof api.getSessionLatestDescendant !== 'function') throw new OwnershipError('This dashboard cannot verify session lineage. Resume is disabled.');
    const lineage = object(await api.getSessionLatestDescendant(storedSessionId, 'default'));
    if (lineage.session_id !== storedSessionId || lineage.changed === true) throw new OwnershipError('This session has a newer continuation. Open the latest session from the list rather than its ancestor.');
    const live = await this.rpc<{ sessions: Array<{ id: string; session_key: string }> }>('session.active_list', { profile: 'default' });
    if (!Array.isArray(live.sessions)) throw new OwnershipError('Cannot verify live session ownership');
    const foreign = live.sessions.find(s => s.session_key === storedSessionId && s.id !== previousSessionId);
    if (foreign) throw new OwnershipError('This session is already live outside this Workbench client. No take-control operation is available.');
    if (previousSessionId) this.resuming.add(previousSessionId);
    try {
    const raw = await this.rpc('session.resume', {
      session_id: storedSessionId, profile: 'default', source: 'dashboard', close_on_disconnect: false,
      lazy: false, defer_history: false, omit_messages: false,
    });
    const data = object(raw);
    // Compression can resolve to a different stored key. Check the returned live
    // identity against the preflight too, not only the originally requested key.
    if (live.sessions.some(s => s.id === data.session_id && s.id !== previousSessionId)) throw new OwnershipError('Resume resolved to an already-live foreign session; control denied');
    const session = this.bind(raw, previousSessionId, activate);
    try { await this.refreshApprovals(session.session_id); }
    catch (error) { this.emit({ type: 'error', sessionId: session.session_id, error: `Pending approval refresh failed: ${errorOf(error).message}` }); }
    return session;
    } finally {
      if (previousSessionId) {
        this.resuming.delete(previousSessionId);
        const remaining = this.earlyEvents.filter(e => e.session_id === previousSessionId);
        this.earlyEvents = this.earlyEvents.filter(e => e.session_id !== previousSessionId);
        for (const event of remaining) this.deliverEvent(event);
      }
    }
  }
  async listSessions(limit = 200): Promise<SessionSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Session limit must be an integer from 1 to 1000');
    const result = await this.rpc<{ sessions: SessionSummary[] }>('session.list', { profile: 'default', limit, include_hidden: false });
    if (!Array.isArray(result.sessions)) throw new Error('Invalid session list response');
    this.emit({ type: 'sessions', sessions: result.sessions }); return result.sessions;
  }
  async history(sessionId: string): Promise<NativeMessage[]> {
    const result = await this.controlled<{ messages: NativeMessage[] }>(sessionId, 'session.history');
    if (!Array.isArray(result.messages)) throw new Error('Invalid session history response');
    this.emit({ type: 'history', sessionId, messages: result.messages }); return result.messages;
  }
  submit(sessionId: string, text: string): Promise<PromptResult> { return this.sendPrompt(sessionId, text, 'submit'); }
  queue(sessionId: string, text: string): Promise<PromptResult> { return this.sendPrompt(sessionId, text, 'queue'); }
  steer(sessionId: string, text: string): Promise<PromptResult> { return this.sendPrompt(sessionId, text, 'steer'); }
  private async sendPrompt(sessionId: string, text: string, mode: 'submit' | 'queue' | 'steer'): Promise<PromptResult> {
    this.requireOwned(sessionId); validText(text);
    const clientId = `input-${++this.serial}`;
    this.emit({ type: 'prompt.pending', sessionId, clientId, text, mode });
    try {
      const result = await this.controlled<PromptResult>(sessionId, mode === 'steer' ? 'session.steer' : 'prompt.submit', mode === 'steer' ? { text } : { text, queued: mode === 'queue' });
      this.emit({ type: 'prompt.result', sessionId, clientId, status: result.voice_stopped ? 'voice_stopped' : result.status ?? 'accepted' });
      return result;
    } catch (error) {
      this.emit({ type: 'prompt.result', sessionId, clientId, status: error instanceof WorkbenchRpcError && error.code !== undefined ? 'rejected' : 'uncertain' }); throw error;
    }
  }
  stop(sessionId: string): Promise<{ status: string; interrupted?: boolean }> { return this.controlled(sessionId, 'session.interrupt'); }
  async rename(sessionId: string, title: string): Promise<{ title: string; pending?: boolean }> {
    validText(title, 'Title');
    const result = await this.controlled<{ title: string; pending?: boolean }>(sessionId, 'session.title', { title });
    // Read back exact target, including the native lazy-title persistence state.
    const confirmed = await this.controlled<{ title: string }>(sessionId, 'session.title');
    if (confirmed.title !== result.title) throw new Error('Session title verification failed');
    this.emit({ type: 'session.title', sessionId, title: confirmed.title }); return result;
  }
  async fork(sessionId: string, options: { name?: string; count?: number } = {}): Promise<NativeSession> {
    if (options.count !== undefined && (!Number.isInteger(options.count) || options.count <= 0)) throw new Error('Branch count must be a positive integer');
    const params: Record<string, unknown> = {};
    if (options.name !== undefined) params.name = validText(options.name, 'Branch name');
    if (options.count !== undefined) params.count = options.count;
    return this.bind(await this.controlled(sessionId, 'session.branch', params));
  }
  async listAgents(sessionId: string): Promise<Subagent[]> {
    const session = this.requireOwned(sessionId);
    const result = await this.controlled<{ active: Subagent[] }>(sessionId, 'delegation.status');
    if (!Array.isArray(result.active)) throw new Error('Invalid delegation status response');
    // Global endpoint: exact durable owner match only. Missing evidence means hidden.
    const agents = result.active.filter(a => a.owner_agent_session_id === session.stored_session_id && typeof a.subagent_id === 'string');
    this.emit({ type: 'agents', sessionId, agents }); return agents;
  }
  private async requireAgent(sessionId: string, agentId: string): Promise<void> {
    validText(agentId, 'Subagent ID');
    const agents = await this.listAgents(sessionId);
    if (!agents.some(a => a.subagent_id === agentId)) throw new OwnershipError('Subagent ownership is not verified for this session');
    this.requireOwned(sessionId);
  }
  async steerAgent(sessionId: string, agentId: string, text: string): Promise<PromptResult> {
    validText(text); await this.requireAgent(sessionId, agentId);
    return this.controlled(sessionId, 'subagent.steer', { subagent_id: agentId, text });
  }
  async stopAgent(sessionId: string, agentId: string): Promise<{ found: boolean; subagent_id: string }> {
    await this.requireAgent(sessionId, agentId);
    return this.controlled(sessionId, 'subagent.interrupt', { subagent_id: agentId });
  }
  async refreshApprovals(sessionId: string): Promise<Approval[]> {
    const result = await this.controlled<{ approvals: Approval[] }>(sessionId, 'approval.pending');
    if (!Array.isArray(result.approvals)) throw new Error('Invalid pending approval response');
    const approvals = result.approvals.filter(a => typeof a.request_id === 'string' && a.request_id);
    this.emit({ type: 'approvals', sessionId, approvals }); return approvals;
  }
  async respondApproval(sessionId: string, requestId: string, choice: ApprovalDecision): Promise<{ resolved: number }> {
    if (!['once', 'session', 'always', 'deny'].includes(choice)) throw new Error('Invalid approval choice');
    const approval = (await this.refreshApprovals(sessionId)).find(a => a.request_id === requestId);
    if (!approval) throw new OwnershipError('Approval is no longer pending for this session');
    const choices = approval.choices ?? (approval.smart_denied || approval.allow_session === false ? ['once', 'deny'] : approval.allow_permanent === false ? ['once', 'session', 'deny'] : ['once', 'session', 'always', 'deny']);
    if (!choices.includes(choice)) throw new Error('Approval choice is not permitted by this request');
    const result = await this.controlled<{ resolved: number }>(sessionId, 'approval.respond', { request_id: requestId, choice, all: false });
    await this.refreshApprovals(sessionId);
    return result;
  }
  async respondClarification(sessionId: string, requestId: string, answer: string, questionId?: string): Promise<{ status: string; remaining?: string[] }> {
    this.requireOwned(sessionId);
    const request = this.current.threads[sessionId]?.requests.find(r => r.type === 'clarify.request' && r.request_id === requestId);
    if (!request) throw new OwnershipError('Clarification is not pending for this session');
    if (typeof answer !== 'string') throw new Error('Clarification answer must be text');
    const params: Record<string, unknown> = { request_id: requestId, answer };
    if (questionId !== undefined) params.question_id = validText(questionId, 'Question ID');
    const result = await this.controlled<{ status: string; remaining?: string[] }>(sessionId, 'clarify.respond', params);
    if (!result.remaining?.length) this.emit({ type: 'request.resolved', sessionId, requestId });
    return result;
  }
}
