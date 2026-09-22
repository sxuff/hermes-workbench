import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { WorkbenchClient, type ServerRequest, type ApprovalDecision, type NativeMessage } from './client';
import { initialWorkbenchState, workbenchReducer, type ToolState, type WorkbenchState } from './state';

const SDK = (window as any).__HERMES_PLUGIN_SDK__;
const React = SDK.React;
const { useState, useEffect, useMemo, useReducer, useRef } = React;
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const pretty = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2);
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};

function Icon({ name = 'spark' }: { name?: string }) {
  const paths: Record<string, string> = {
    spark: 'M12 3l2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3z',
    plus: 'M12 5v14M5 12h14', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    chat: 'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4z',
    folder: 'M3 7V4h6l3 3h9v13H3V7z', menu: 'M4 6h16M4 12h16M4 18h16',
    arrow: 'M12 19V5M5 12l7-7 7 7', close: 'M6 6l12 12M6 18L18 6',
    agents: 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a6 6 0 0 1 12 0v3M16 4a4 4 0 0 1 0 8M18 15a5 5 0 0 1 4 5',
    expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark}/></svg>;
}
function Markdown({ value }: { value: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(value, { async: false, gfm: true }) as string, {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'button'], FORBID_ATTR: ['style'],
  }), [value]);
  return <div className="hwb-prose" dangerouslySetInnerHTML={{ __html: html }}/>;
}
function ToolCard({ tool }: { tool: ToolState }) {
  return <details className="hwb-tool"><summary><span className={`hwb-dot ${tool.status === 'complete' ? 'completed' : 'running'}`}/><span className="hwb-tool-name">{tool.name}</span><span>{tool.status}</span></summary><div className="hwb-tool-body">
    {tool.context && <p>{tool.context}</p>}
    {tool.args != null && <section><span className="hwb-eyebrow">Arguments</span><pre>{pretty(tool.args)}</pre></section>}
    {(tool.result != null || tool.summary) && <section><span className="hwb-eyebrow">Result</span><pre>{pretty(tool.result ?? tool.summary)}</pre></section>}
  </div></details>;
}
function Message({ message }: { message: NativeMessage }) {
  if (message.role === 'tool') return <details className="hwb-tool"><summary><span className="hwb-tool-name">{message.name || 'Tool result'}</span></summary><div className="hwb-tool-body"><pre>{message.text || pretty(message.content)}</pre></div></details>;
  return <article className={`hwb-message ${message.role}`}><div className="hwb-message-head"><span className={`hwb-avatar ${message.role}`}>{message.role === 'assistant' ? 'H' : message.role === 'user' ? 'Y' : 'S'}</span><strong>{message.role === 'assistant' ? 'Hermes' : message.role === 'user' ? 'You' : 'System'}</strong>{message.delivery && <span>{message.delivery}</span>}{message.mode && message.mode !== 'submit' ? <span className="hwb-tag">{text(message.mode)}</span> : null}</div>
    {text(message.reasoning) && <details className="hwb-reasoning"><summary>Reasoning</summary><Markdown value={text(message.reasoning)}/></details>}
    <div className="hwb-message-content"><Markdown value={message.text || text(message.content)}/></div>
  </article>;
}
function RequestCard({ request, client, enabled }: { request: ServerRequest; client: WorkbenchClient; enabled: boolean }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answered, setAnswered] = useState([] as string[]);
  const p = request.payload;
  const isApproval = request.type === 'approval.request';
  const isClarify = request.type === 'clarify.request';
  const questions = Array.isArray(p.questions) ? p.questions.map(obj) : [];
  const question = questions.find((q: any) => !answered.includes(String(q.qid ?? q.id ?? q.question_id)));
  const questionId = question ? String(question.qid ?? question.id ?? question.question_id ?? '') : undefined;
  const options = (question?.choices ?? question?.options ?? p.choices ?? p.options);
  const choices: ApprovalDecision[] = Array.isArray(p.choices) ? p.choices as ApprovalDecision[] : p.smart_denied || p.allow_session === false ? ['once', 'deny'] : p.allow_permanent === false ? ['once', 'session', 'deny'] : ['once', 'session', 'always', 'deny'];
  async function respond(choice?: ApprovalDecision) {
    if (busy || !enabled) return;
    setBusy(true); setError('');
    try {
      if (choice) await client.respondApproval(request.session_id, request.request_id, choice);
      else { await client.respondClarification(request.session_id, request.request_id, answer, questionId || undefined); if (questionId) setAnswered((a: string[]) => [...a, questionId]); setAnswer(''); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="hwb-tool" aria-label={isApproval ? 'Approval required' : 'Input required'}><div className="hwb-tool-body"><span className="hwb-eyebrow">{isApproval ? 'Approval required' : isClarify ? 'Clarification needed' : 'Secure input required'}</span>
    <p>{text(question?.question ?? question?.text ?? p.question ?? p.description ?? p.message) || request.type}</p>
    {isApproval && <pre>{pretty(p.command ?? p.tool ?? p)}</pre>}
    {!isApproval && !isClarify && <p>This secure prompt cannot be answered in Workbench. Use the native secure interface. No credentials are collected here.</p>}
    {isClarify && <><div className="hwb-options">{Array.isArray(options) && options.map((option: unknown, i: number) => { const o = obj(option); const value = typeof option === 'string' ? option : text(o.value ?? o.label ?? o.text); return <button type="button" className="hwb-option" key={i} aria-pressed={answer === value} disabled={!enabled || busy} onClick={() => setAnswer(value)}>{value}</button>; })}</div><label className="hwb-workspace">Your answer<input aria-label="Clarification answer" value={answer} disabled={!enabled || busy} onChange={(e: any) => setAnswer(e.target.value)}/></label></>}
    <div className="hwb-modal-actions">{isApproval ? choices.filter(c => ['once', 'session', 'always', 'deny'].includes(c)).map(c => <button type="button" key={c} className={`hwb-btn ${c === 'deny' ? 'hwb-btn-danger' : ''}`} disabled={!enabled || busy} onClick={() => void respond(c)}>{{once: 'Allow once', session: 'Allow for session', always: 'Always allow', deny: 'Deny'}[c]}</button>) : isClarify ? <button type="button" className="hwb-btn hwb-btn-primary" disabled={!enabled || busy || !answer.trim()} onClick={() => void respond()}>Answer</button> : null}</div>
    {error && <div className="hwb-modal-error" role="alert">{error}</div>}
  </div></section>;
}

export function Workbench() {
  const [client] = useState(() => new WorkbenchClient(SDK));
  const [state, dispatch] = useReducer(workbenchReducer, initialWorkbenchState) as [WorkbenchState, (a: any) => void];
  const [search, setSearch] = useState('');
  const [cwd, setCwd] = useState('/opt/data');
  const [drafts, setDrafts] = useState({} as Record<string, string>);
  const [mode, setMode] = useState('submit');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [roster, setRoster] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const root = useRef(null as HTMLDivElement | null);
  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleExpanded = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setError('Fullscreen is unavailable in this browser. The embedded Workbench remains usable.'); }
  };
  const [follow, setFollow] = useState(true);
  const scroller = useRef(null as HTMLDivElement | null);
  const id = state.activeSessionId;
  const thread = id ? state.threads[id] : undefined;
  const connected = state.connection === 'open';
  const controlled = connected && thread?.ownership === 'owned';
  const draft = drafts[id || 'new'] || '';
  const setDraft = (value: string) => setDrafts((old: Record<string, string>) => ({ ...old, [id || 'new']: value }));
  const run = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    let alive = true;
    const unsub = client.subscribe(dispatch);
    void client.connect().then(() => client.listSessions()).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; unsub(); client.disconnect(); };
  }, [client]);
  useEffect(() => { if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [thread?.messages.length, thread?.streamingText, thread?.tools, thread?.requests, follow, id]);
  useEffect(() => { setFollow(true); setMode('submit'); }, [id]);
  useEffect(() => { if (roster && controlled && id) void client.listAgents(id).catch((e: Error) => setError(e.message)); }, [roster, controlled, id]);
  const create = () => run(async () => { await client.createSession({ title: 'New session', cwd: cwd.trim() || '/opt/data' }); setSidebar(false); await client.listSessions(); });
  const open = (storedId: string) => run(async () => {
    const bound = Object.values(state.threads).find(t => t.session.stored_session_id === storedId || t.session.session_id === storedId);
    if (bound?.ownership === 'owned') client.setActiveSession(bound.session.session_id);
    else await client.resumeSession(storedId);
    setSidebar(false);
  });
  const send = () => {
    if (!id || !controlled || !draft.trim() || (thread?.running && mode === 'submit')) return;
    const content = draft, key = id;
    void run(async () => { await client[mode as 'submit' | 'queue' | 'steer'](key, content); setDrafts((old: Record<string, string>) => old[key] === content ? { ...old, [key]: '' } : old); });
  };
  const sessionMap = new Map(state.sessions.map(s => [s.id, s]));
  Object.values(state.threads).forEach(t => { const key = t.session.stored_session_id || t.session.session_id; sessionMap.set(key, { ...sessionMap.get(key), id: key, title: t.session.title || sessionMap.get(key)?.title || 'New session', message_count: t.messages.length }); });
  const sessions = [...sessionMap.values()].filter(s => `${s.title || ''} ${s.preview || ''} ${s.id}`.toLowerCase().includes(search.toLowerCase()));
  const displayError = error || thread?.error || state.error;
  return <div ref={root} className={`hwb ${expanded ? 'hwb-expanded' : ''}`}>
    <header className="hwb-topbar"><button className="hwb-icon-btn hwb-mobile-only" aria-label="Toggle sessions" onClick={() => setSidebar(!sidebar)}><Icon name="menu"/></button><div className="hwb-brand"><strong>Hermes<br/>Agent</strong><small>Workbench</small></div><span className="hwb-title">{thread?.session.title || 'Your agent workspace'}</span><span className="hwb-connection" role="status"><span className={`hwb-dot ${connected ? 'connected' : state.connection === 'connecting' ? 'connecting' : 'disconnected'}`}/>{connected ? 'Connected' : state.connection}</span><button className="hwb-icon-btn" aria-label={expanded ? 'Exit expanded view' : 'Expand workbench'} onClick={() => void toggleExpanded()}><Icon name={expanded ? 'close' : 'expand'}/></button></header>
    <div className="hwb-body">
      {sidebar && <button className="hwb-drawer-backdrop sessions" aria-label="Close sessions" onClick={() => setSidebar(false)}/>}
      <aside className={`hwb-sidebar ${sidebar ? 'is-open' : ''}`} aria-label="Sessions"><div className="hwb-sidebar-head"><button className="hwb-btn" disabled={!connected || busy} onClick={create}>New session<Icon name="plus"/></button><div className="hwb-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions…" value={search} onChange={(e: any) => setSearch(e.target.value)}/></div></div>
        <div className="hwb-session-list"><div className="hwb-list-label"><span className="hwb-eyebrow">Sessions</span><button className="hwb-btn hwb-btn-quiet" disabled={!connected || busy} onClick={() => void run(() => client.listSessions())}>Refresh</button></div>{sessions.map(s => <button className="hwb-session" key={s.id} aria-current={thread?.session.stored_session_id === s.id || id === s.id ? 'true' : undefined} disabled={!connected || busy} onClick={() => void open(s.id)}><Icon name="chat"/><div className="hwb-session-copy"><div className="hwb-session-title">{s.title || s.preview || 'Untitled session'}</div><div className="hwb-session-meta"><span>{s.message_count ?? 0} messages</span><span>{s.source || 'Hermes'}</span></div></div></button>)}{!sessions.length && <p className="hwb-small-empty">{search ? 'No matching sessions.' : 'No sessions loaded. Create a session to begin.'}</p>}</div>
        <div className="hwb-sidebar-foot"><label className="hwb-eyebrow" htmlFor="hwb-cwd">Workspace for new sessions</label><input id="hwb-cwd" aria-label="Workspace directory" value={cwd} onChange={(e: any) => setCwd(e.target.value)} spellCheck={false}/><div className="hwb-profile"><span className="hwb-profile-badge">H</span><span>Default profile · native gateway</span></div></div>
      </aside>
      <main className="hwb-main"><div className="hwb-threadbar"><div className="hwb-thread-meta"><span className="hwb-tag">{thread ? thread.running ? 'Working' : thread.status || 'Ready' : 'No session'}</span><span title={text(thread?.session.info?.cwd)}>{text(thread?.session.info?.model) || 'Configured model'}</span></div><div className="hwb-thread-actions">{thread && <><button className="hwb-btn hwb-btn-quiet" disabled={!controlled || busy} onClick={() => { const title = window.prompt('Session title', thread.session.title || ''); if (title?.trim() && id) void run(() => client.rename(id, title.trim())); }}>Rename</button><button className="hwb-btn hwb-btn-quiet" disabled={!controlled || busy || thread.running} onClick={() => id && void run(() => client.fork(id))}>Fork</button></>}<button className="hwb-btn" aria-pressed={roster} onClick={() => setRoster(!roster)}><Icon name="agents"/>Agents{thread?.agents.length ? ` (${thread.agents.length})` : ''}</button></div></div>
        {!connected && <div className="hwb-banner"><span>Gateway {state.connection}. Sending is disabled until the connection and session binding are restored.</span><button className="hwb-btn" disabled={busy || state.connection === 'connecting'} onClick={() => void run(async () => { await client.connect(); await client.listSessions(); })}>Reconnect</button></div>}
        {thread && connected && !controlled && <div className="hwb-banner"><span>Control is not verified. Resume this session explicitly before sending.</span><button className="hwb-btn" disabled={busy} onClick={() => void open(thread.session.stored_session_id)}>Resume</button></div>}
        {displayError && <div className="hwb-banner error" role="alert"><span>{displayError}</span><button className="hwb-btn" onClick={() => { setError(''); dispatch({ type: 'error', error: null }); if (id) dispatch({ type: 'error', error: null, sessionId: id }); }}>Dismiss</button></div>}
        <div className="hwb-transcript" ref={scroller} onScroll={() => { const el = scroller.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 100); }}><div className="hwb-thread-inner">
          {!thread ? <div className="hwb-empty"><span className="hwb-eyebrow">Hermes Workbench</span><h1>What should we work on?</h1><p>Your Hermes sessions, tools, and agents. Start a session or pick up where you left off.</p><button className="hwb-btn hwb-btn-primary" disabled={!connected || busy} onClick={create}><Icon name="plus"/>Create a session</button><div className="hwb-empty-note"><Icon name="folder"/><span>New sessions run in the workspace selected on the left. Existing sessions are never taken over automatically.</span></div></div> : <>
            {!thread.messages.length && !thread.running && <div className="hwb-small-empty">Session ready. Give Hermes a task below.</div>}
            {thread.messages.map((m, i) => <Message key={m.client_id || m.row_id || i} message={m}/>)}
            {Object.values(thread.tools).map(t => <ToolCard key={t.tool_id} tool={t}/>)}
            {thread.reasoningText && <details className="hwb-reasoning"><summary>Reasoning</summary><Markdown value={thread.reasoningText}/></details>}
            {thread.streamingText && <Message message={{ role: 'assistant', text: thread.streamingText }}/>}
            {thread.running && <div className="hwb-live-label" role="status"><span className="hwb-dot running"/>{thread.status || 'Hermes is working'}</div>}
            {thread.requests.map(r => <RequestCard key={`${id}:${r.request_id}`} request={r} client={client} enabled={!!controlled}/>)}
          </>}
        </div></div>
        {!follow && <button className="hwb-btn hwb-jump" onClick={() => setFollow(true)}>Jump to latest ↓</button>}
        <div className="hwb-composer-wrap">{thread?.queued != null && <div className="hwb-queue"><div className="hwb-queue-item"><span>{pretty(thread.queued)}</span><small>Gateway queue</small></div></div>}<form className="hwb-composer" onSubmit={(e: any) => { e.preventDefault(); send(); }}><textarea aria-label="Message Hermes" placeholder={!thread ? 'Create or resume a session to begin' : thread.running ? 'Queue a follow-up or steer the current task…' : 'What should we work on?'} disabled={!controlled} value={draft} onChange={(e: any) => setDraft(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><div className="hwb-composer-bottom"><div className="hwb-compose-mode"><select aria-label="Message mode" value={mode} onChange={(e: any) => setMode(e.target.value)} disabled={!controlled || busy}><option value="submit">Send message</option><option value="queue">Queue follow-up</option><option value="steer">Steer current task</option></select></div><div className="hwb-compose-actions">{thread?.running && <button type="button" className="hwb-btn hwb-btn-danger" disabled={!controlled} onClick={() => { if (id) void client.stop(id).catch((e: Error) => setError(e.message)); }}>Stop</button>}<button type="submit" className="hwb-btn hwb-btn-primary" disabled={!controlled || busy || !draft.trim() || (!!thread?.running && mode === 'submit')}><Icon name="arrow"/>{busy ? 'Sending…' : mode === 'queue' ? 'Queue' : mode === 'steer' ? 'Steer' : 'Send'}</button></div></div></form><div className="hwb-composer-hint"><span><kbd>Enter</kbd> send · <kbd>Shift Enter</kbd> new line</span><span>{thread?.running && mode === 'submit' ? 'Choose Queue or Steer while Hermes is working.' : 'Approvals stay in your hands.'}</span></div></div>
      </main>
      {roster && <><button className="hwb-drawer-backdrop roster" aria-label="Close agents" onClick={() => setRoster(false)}/><aside className="hwb-roster" aria-label="Subagents"><div className="hwb-roster-head"><span className="hwb-eyebrow">Subagents</span><button className="hwb-icon-btn" aria-label="Close agents" onClick={() => setRoster(false)}><Icon name="close"/></button></div><div className="hwb-roster-list"><button className="hwb-btn" disabled={!controlled || busy} onClick={() => id && void run(() => client.listAgents(id))}>Refresh agents</button>{!thread?.agents.length && <p className="hwb-small-empty">No delegated agents in this session.</p>}{thread?.agents.map(a => <section className="hwb-agent" key={a.subagent_id}><div className="hwb-agent-heading"><span className={`hwb-dot ${a.status === 'running' ? 'running' : 'completed'}`}/><span title={a.subagent_id}>{text(a.name) || a.subagent_id}</span></div><p>{a.goal || text(a.task) || 'Delegated task'}</p><div className="hwb-agent-meta">{a.status || 'Unknown'}{a.model ? ` · ${a.model}` : ''}</div><div className="hwb-agent-controls"><button className="hwb-btn" disabled={!controlled || busy || a.status !== 'running'} onClick={() => { const value = window.prompt('Steer this agent'); if (value?.trim() && id) void run(() => client.steerAgent(id, a.subagent_id, value)); }}>Steer</button><button className="hwb-btn hwb-btn-danger" disabled={!controlled || busy || a.status !== 'running'} onClick={() => id && void run(() => client.stopAgent(id, a.subagent_id))}>Stop</button></div></section>)}</div><div className="hwb-roster-foot">Only agents verified as belonging to this session can be controlled. Refresh queries live delegation status.</div></aside></>}
    </div>
  </div>;
}

(window as any).__HERMES_PLUGINS__.register('hermes-workbench', Workbench);
