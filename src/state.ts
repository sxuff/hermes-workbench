import type {
  Approval, ConnectionState, GatewayEvent, NativeMessage, NativeSession,
  ServerRequest, SessionSummary, Subagent,
} from './client';

export interface ToolState {
  tool_id: string;
  name: string;
  status: 'running' | 'complete';
  context?: string;
  args?: unknown;
  result?: unknown;
  summary?: string;
  [key: string]: unknown;
}
export interface TodoItem { id?: string; content?: string; status?: string; [key: string]: unknown }
export interface ThreadState {
  session: NativeSession;
  messages: NativeMessage[];
  streamingText: string;
  reasoningText: string;
  /** Live tool rows by ID. Each is also placed in `messages` at the point it started. */
  tools: Record<string, ToolState>;
  todos: TodoItem[];
  approvals: Approval[];
  requests: ServerRequest[];
  agents: Subagent[];
  running: boolean;
  ownership: 'owned' | 'unknown';
  error: string | null;
  status: string;
  lastSeq: number;
  usage: Record<string, unknown>;
  queued: unknown;
}
export interface WorkbenchState {
  connection: ConnectionState;
  sessions: SessionSummary[];
  threads: Record<string, ThreadState>;
  activeSessionId: string | null;
  error: string | null;
}
export type WorkbenchAction =
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'session.bound'; session: NativeSession; previousSessionId?: string; activate?: boolean }
  | { type: 'session.select'; sessionId: string }
  | { type: 'session.revoked'; sessionId: string; error?: string }
  | { type: 'session.title'; sessionId: string; title: string }
  | { type: 'history'; sessionId: string; messages: NativeMessage[] }
  | { type: 'approvals'; sessionId: string; approvals: Approval[] }
  | { type: 'agents'; sessionId: string; agents: Subagent[] }
  | { type: 'request.resolved'; sessionId: string; requestId: string }
  | { type: 'prompt.pending'; sessionId: string; clientId: string; text: string; mode: 'submit' | 'queue' | 'steer' }
  | { type: 'prompt.result'; sessionId: string; clientId: string; status: string }
  | { type: 'event'; event: GatewayEvent }
  | { type: 'error'; error: string | null; sessionId?: string };

export function createInitialWorkbenchState(): WorkbenchState {
  return { connection: 'idle', sessions: [], threads: {}, activeSessionId: null, error: null };
}
export const initialWorkbenchState: WorkbenchState = createInitialWorkbenchState();

const text = (v: unknown): string => typeof v === 'string' ? v : '';
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const requestOf = (sessionId: string, type: string, p: Record<string, unknown>): ServerRequest | null =>
  typeof p.request_id === 'string' && p.request_id ? { type, session_id: sessionId, request_id: p.request_id, payload: p } : null;
function replaceThread(state: WorkbenchState, id: string, transform: (t: ThreadState) => ThreadState): WorkbenchState {
  const t = state.threads[id];
  return t ? { ...state, threads: { ...state.threads, [id]: transform(t) } } : state;
}
function todosOf(v: unknown): TodoItem[] | undefined {
  const todos = Array.isArray(v) ? v : record(v).todos;
  return Array.isArray(todos) ? todos.map(record) as TodoItem[] : undefined;
}
/** Seal streamed text and reasoning into their own segment so later rows keep arrival order. */
function sealSegment(t: ThreadState): ThreadState {
  if (!t.streamingText && !t.reasoningText) return t;
  return { ...t, streamingText: '', reasoningText: '',
    messages: [...t.messages, { role: 'assistant', text: t.streamingText, reasoning: t.reasoningText, interim: true }] };
}
function boundThread(session: NativeSession, old?: ThreadState): ThreadState {
  const inflight = record(session.inflight);
  const messages = [...session.messages];
  // Native resume may include an in-flight user already in the display history.
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (text(inflight.user) && lastUser?.text !== inflight.user) {
    messages.push({ role: 'user', text: text(inflight.user), delivery: 'accepted' });
  }
  const requests: ServerRequest[] = [];
  for (const [type, payload] of [['approval.request', session.pending_approval], ['clarify.request', session.pending_clarify]] as const) {
    const req = requestOf(session.session_id, type, record(payload));
    if (req) requests.push(req);
  }
  return {
    session, messages, streamingText: text(inflight.assistant), reasoningText: '', tools: {},
    todos: todosOf(session.todo_state) ?? old?.todos ?? [],
    approvals: session.pending_approval ? [session.pending_approval] : [], requests,
    agents: old?.agents ?? [], running: session.running === true, ownership: 'owned',
    error: text(inflight.error) || null, status: session.status ?? (session.running ? 'working' : 'idle'),
    lastSeq: 0, usage: old?.usage ?? {}, queued: session.queued ?? null,
  };
}

/** Pure UI projection. Unknown-session events never create control authority. */
export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'connection':
      return {
        ...state, connection: action.connection,
        ...(action.connection === 'open' ? { error: null } : {}),
        threads: action.connection === 'open' ? state.threads : Object.fromEntries(
          Object.entries(state.threads).map(([id, t]) => [id, { ...t, ownership: 'unknown' as const }]),
        ),
      };
    case 'sessions': return { ...state, sessions: [...action.sessions] };
    case 'session.select': return state.threads[action.sessionId] ? { ...state, activeSessionId: action.sessionId } : state;
    case 'session.bound': {
      const id = action.session.session_id;
      const previous = action.previousSessionId ?? id;
      const threads = { ...state.threads };
      const old = threads[previous];
      if (previous !== id) delete threads[previous];
      threads[id] = boundThread(action.session, old);
      return { ...state, threads, activeSessionId: action.activate !== false || state.activeSessionId === previous ? id : state.activeSessionId };
    }
    case 'session.revoked': return replaceThread(state, action.sessionId, t => ({ ...t, ownership: 'unknown', error: action.error ?? t.error }));
    case 'session.title': return {
      ...replaceThread(state, action.sessionId, t => ({ ...t, session: { ...t.session, title: action.title } })),
      sessions: state.sessions.map(s => s.id === state.threads[action.sessionId]?.session.stored_session_id ? { ...s, title: action.title } : s),
    };
    case 'history': return replaceThread(state, action.sessionId, t => ({ ...t, messages: [...action.messages] }));
    case 'approvals': return replaceThread(state, action.sessionId, t => ({
      ...t, approvals: [...action.approvals],
      requests: [...t.requests.filter(r => r.type !== 'approval.request'), ...action.approvals.map(a => ({ type: 'approval.request', session_id: action.sessionId, request_id: a.request_id, payload: a }))],
    }));
    case 'agents': return replaceThread(state, action.sessionId, t => ({ ...t, agents: [...action.agents] }));
    case 'request.resolved': return replaceThread(state, action.sessionId, t => ({
      ...t, requests: t.requests.filter(r => r.request_id !== action.requestId), approvals: t.approvals.filter(a => a.request_id !== action.requestId),
    }));
    case 'prompt.pending': return replaceThread(state, action.sessionId, t => ({ ...t, error: null, messages: [
      ...t.messages, { role: 'user', text: action.text, client_id: action.clientId, delivery: 'pending', mode: action.mode },
    ] }));
    case 'prompt.result': return replaceThread(state, action.sessionId, t => ({ ...t,
      messages: t.messages.map(m => m.client_id === action.clientId ? { ...m, delivery: action.status } : m),
    }));
    case 'error': return action.sessionId ? replaceThread(state, action.sessionId, t => ({ ...t, error: action.error })) : { ...state, error: action.error };
    case 'event': return reduceEvent(state, action.event);
  }
}

function reduceEvent(state: WorkbenchState, event: GatewayEvent): WorkbenchState {
  const p = record(event.payload);
  if (event.type === 'session.reclaimed') {
    const live = text(p.session_id);
    const stored = text(p.stored_session_id);
    return { ...state, threads: Object.fromEntries(Object.entries(state.threads).map(([id, t]) => [id,
      id === live || (stored && t.session.stored_session_id === stored) ? { ...t, ownership: 'unknown', running: false, error: 'Session reclaimed by the gateway. Resume explicitly.' } : t,
    ])) };
  }
  const sid = event.session_id;
  if (!sid) return event.type === 'error' ? { ...state, error: text(p.message) || 'Gateway error' } : state;
  return replaceThread(state, sid, previous => {
    if (typeof event.seq === 'number' && event.seq <= previous.lastSeq) return previous;
    const t = { ...previous, lastSeq: typeof event.seq === 'number' ? event.seq : previous.lastSeq };
    switch (event.type) {
      case 'session.info': return { ...t, session: { ...t.session, info: { ...t.session.info, ...p },
        ...(typeof p.stored_session_id === 'string' && p.stored_session_id ? { stored_session_id: p.stored_session_id } : {}),
        ...(typeof p.title === 'string' ? { title: p.title } : {}),
      } };
      case 'session.usage': return { ...t, usage: p };
      case 'message.start': return { ...t, running: true, status: 'working', streamingText: '', reasoningText: '', tools: {}, error: null };
      case 'message.delta': return { ...t, running: true, streamingText: t.streamingText + text(p.text) };
      case 'thinking.delta':
      case 'reasoning.delta': return { ...t, reasoningText: t.reasoningText + text(p.text) };
      case 'message.interim': return { ...t, streamingText: '', reasoningText: '',
        messages: [...t.messages, { role: 'assistant', text: text(p.text) || t.streamingText, reasoning: t.reasoningText, interim: true }] };
      case 'message.complete': {
        const body = typeof p.text === 'string' ? p.text : t.streamingText;
        const last = t.messages[t.messages.length - 1];
        const alreadyInSnapshot = !t.running && last?.role === 'assistant' && last.text === body;
        return { ...t, running: false, status: text(p.status) || 'idle', streamingText: '', reasoningText: '',
          usage: p.usage && typeof p.usage === 'object' ? { ...t.usage, ...record(p.usage) } : t.usage,
          error: p.status === 'error' ? text(p.error) || body || 'Turn failed' : t.error,
          messages: !alreadyInSnapshot && (body || t.reasoningText) ? [...t.messages, { ...p, role: 'assistant', text: body, reasoning: t.reasoningText }] : t.messages,
        };
      }
      case 'status.update': return { ...t, status: text(p.text) || text(p.kind) };
      case 'tool.start':
      case 'tool.progress':
      case 'tool.complete': {
        const id = text(p.tool_id);
        if (!id) return t;
        const known = t.tools[id];
        // A tool row lands where it started; text streamed before it is sealed above it.
        const base = known ? t : sealSegment(t);
        const tool: ToolState = {
          ...known, ...p, tool_id: id, name: text(p.name) || known?.name || 'tool',
          status: event.type === 'tool.complete' ? 'complete' : known?.status ?? 'running',
        };
        const row = { ...tool, role: 'tool' as const, live: true };
        const index = base.messages.findIndex(m => m.role === 'tool' && m.tool_id === id);
        const messages = index < 0 ? [...base.messages, row] : base.messages.map((m, i) => i === index ? row : m);
        const todos = event.type === 'tool.complete' ? todosOf(p.todos) : undefined;
        return { ...base, messages, tools: { ...base.tools, [id]: tool }, ...(todos ? { todos } : {}) };
      }
      case 'todo.updated': return { ...t, todos: todosOf(p.todos) ?? t.todos };
      case 'approval.request':
      case 'clarify.request':
      case 'sudo.request':
      case 'secret.request': {
        const request = requestOf(sid, event.type, p);
        if (!request) return t;
        return { ...t, requests: [...t.requests.filter(r => r.request_id !== request.request_id), request],
          approvals: event.type === 'approval.request' ? [...t.approvals.filter(a => a.request_id !== request.request_id), p as Approval] : t.approvals,
          status: 'waiting',
        };
      }
      case 'clarify.resolved':
      case 'clarify.timeout':
      case 'clarify.expire':
      case 'sudo.expire':
      case 'secret.expire':
      case 'approval.resolved': return { ...t, requests: t.requests.filter(r => r.request_id !== p.request_id), approvals: t.approvals.filter(a => a.request_id !== p.request_id) };
      case 'subagent.start':
      case 'subagent.complete': {
        const id = text(p.subagent_id);
        if (!id) return t;
        const old = t.agents.find(a => a.subagent_id === id);
        const agent: Subagent = { ...old, ...p, subagent_id: id, status: event.type === 'subagent.complete' ? text(p.status) || 'complete' : 'running' };
        return { ...t, agents: [...t.agents.filter(a => a.subagent_id !== id), agent] };
      }
      case 'error': return { ...t, error: text(p.message) || 'Gateway error' };
      default: return t;
    }
  });
}
