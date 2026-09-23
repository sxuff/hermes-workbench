import { WorkbenchClient } from './client';
import { initialWorkbenchState, workbenchReducer, type WorkbenchState } from './state';
import { SDK, React, useState, useEffect, useReducer, useRef, text, errorText, readPref, readText, writePref } from './sdk';
import { Icon } from './ui/icons';
import { Transcript } from './ui/transcript';
import { RequestCard } from './ui/requests';
import { Composer, type SendMode } from './ui/composer';
import { Sidebar, type SidebarSession } from './ui/sidebar';
import { SidePanel, type PanelTab } from './ui/panel';

type ThemeMode = 'auto' | 'light' | 'dark';
const THEME_MODES = ['auto', 'light', 'dark'] as const;

/** The Workbench stands alone, so "auto" follows the OS appearance, as the desktop app does. */
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Profile the page was opened for (`hermes -p work workbench` puts it in the URL). */
function urlProfile(): string {
  return new URLSearchParams(window.location.search).get('profile') || 'default';
}

/**
 * Plugins render inside the dashboard's content column, which is its own stacking
 * context, so a fixed full-window layer would still sit under the dashboard sidebar.
 * Raise each positioned, z-indexed ancestor while app mode is mounted; restore after.
 */
function useLiftAboveHost(root: { current: HTMLElement | null }) {
  useEffect(() => {
    const lifted: Array<[HTMLElement, string]> = [];
    for (let el = root.current?.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') { lifted.push([el, el.style.zIndex]); el.style.zIndex = '60'; }
    }
    return () => { for (const [el, z] of lifted) el.style.zIndex = z; };
  }, []);
}

/** Link back to the regular dashboard, keeping the profile selection. */
function dashboardHref(profile: string): string {
  const base = window.location.pathname.replace(/\/workbench\/?$/, '') || '/';
  return profile === 'default' ? base : `${base}${base.endsWith('/') ? '' : '/'}?profile=${encodeURIComponent(profile)}`;
}

function Wordmark() {
  return <div className="hwb-hero"><h1 className="hwb-wordmark">Hermes Agent</h1>
    <p>Drop an error, a goal, or a whole folder. Hermes picks it up from here.</p></div>;
}

function InlineTitle({ title, editable, onRename }: { title: string; editable: boolean; onRename(title: string): void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => { if (!editing) setValue(title); }, [title, editing]);
  if (!editing) return <button type="button" className="hwb-title" disabled={!editable} onClick={() => setEditing(true)}><span>{title}</span>{editable && <Icon name="pencil" className="hwb-title-edit"/>}</button>;
  const commit = () => { setEditing(false); if (value.trim() && value.trim() !== title) onRename(value.trim()); };
  return <input className="hwb-title-input" autoFocus aria-label="Session title" value={value} onChange={(e: any) => setValue(e.target.value)} onBlur={commit}
    onKeyDown={(e: any) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(title); setEditing(false); } }}/>;
}

export function Workbench({ profile }: { profile: string }) {
  const [client] = useState(() => new WorkbenchClient(SDK, { profile }));
  const [state, dispatch] = useReducer(workbenchReducer, initialWorkbenchState) as [WorkbenchState, (a: any) => void];
  const [search, setSearch] = useState('');
  const [cwd, setCwd] = useState(() => readText('cwd'));
  const [drafts, setDrafts] = useState({} as Record<string, string>);
  const [mode, setMode] = useState('submit' as SendMode);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => readPref('sidebar', 'shown', ['shown', 'hidden'] as const) === 'hidden');
  const [panel, setPanel] = useState(null as PanelTab | null);
  const [themeMode, setThemeMode] = useState(() => readPref('theme', 'auto', THEME_MODES) as ThemeMode);
  const [dark, setDark] = useState(systemDark);
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(true);
  const root = useRef(null as HTMLDivElement | null);
  const scroller = useRef(null as HTMLDivElement | null);
  useLiftAboveHost(root);

  const id = state.activeSessionId;
  const thread = id ? state.threads[id] : undefined;
  const connected = state.connection === 'open';
  const controlled = connected && thread?.ownership === 'owned';
  const draft = drafts[id || 'new'] || '';
  const setDraft = (value: string) => setDrafts((old: Record<string, string>) => ({ ...old, [id || 'new']: value }));
  const isDark = themeMode === 'auto' ? dark : themeMode === 'dark';

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setDark(systemDark());
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    let alive = true;
    const unsub = client.subscribe(dispatch);
    void client.connect().then(() => client.listSessions()).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; unsub(); client.disconnect(); };
  }, [client]);
  useEffect(() => { if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; },
    [thread?.messages, thread?.streamingText, thread?.reasoningText, thread?.requests, follow, id]);
  useEffect(() => { setFollow(true); setMode('submit'); }, [id]);
  useEffect(() => { if (!thread?.running) setMode('submit'); }, [thread?.running]);
  useEffect(() => { if (panel === 'agents' && controlled && id) void client.listAgents(id).catch((e: Error) => setError(e.message)); }, [panel, controlled, id]);

  const run = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await operation(); } catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const toggleExpanded = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setError('Fullscreen is unavailable in this browser.'); }
  };
  const create = () => run(async () => {
    await client.createSession({ title: 'New session', ...(cwd.trim() ? { cwd: cwd.trim() } : {}) });
    setDrawer(false); await client.listSessions();
  });
  const open = (storedId: string) => run(async () => {
    const bound = Object.values(state.threads).find(t => t.session.stored_session_id === storedId || t.session.session_id === storedId);
    if (bound?.ownership === 'owned') client.setActiveSession(bound.session.session_id);
    else await client.resumeSession(storedId);
    setDrawer(false);
  });
  const send = () => {
    if (!draft.trim()) return;
    if (!thread) {
      // As in the desktop, typing on the empty screen starts a session.
      const content = draft;
      void run(async () => {
        const session = await client.createSession({ title: 'New session', ...(cwd.trim() ? { cwd: cwd.trim() } : {}) });
        setDrafts((old: Record<string, string>) => ({ ...old, new: '' }));
        await client.submit(session.session_id, content);
        await client.listSessions();
      });
      return;
    }
    if (!id || !controlled) return;
    const effective: SendMode = thread?.running ? (mode === 'submit' ? 'queue' : mode) : 'submit';
    const content = draft, key = id;
    setFollow(true);
    void run(async () => { await client[effective](key, content); setDrafts((old: Record<string, string>) => old[key] === content ? { ...old, [key]: '' } : old); });
  };
  const setTheme = (next: ThemeMode) => { setThemeMode(next); writePref('theme', next); if (next === 'auto') setDark(systemDark()); };
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 860px)').matches) { setDrawer(!drawer); return; }
    const next = !sidebarHidden; setSidebarHidden(next); writePref('sidebar', next ? 'hidden' : 'shown');
  };
  const updateCwd = (value: string) => { setCwd(value); writePref('cwd', value); };

  const sessionMap = new Map<string, SidebarSession>(state.sessions.map(s => [s.id, s]));
  Object.values(state.threads).forEach(t => {
    const key = t.session.stored_session_id || t.session.session_id;
    const known = sessionMap.get(key);
    sessionMap.set(key, { ...known, id: key, source: known?.source || 'dashboard', title: t.session.title || known?.title || 'New session', live: true, running: t.running });
  });
  const query = search.trim().toLowerCase();
  const sessions = [...sessionMap.values()].filter(s => !query || `${s.title || ''} ${s.preview || ''} ${s.id}`.toLowerCase().includes(query));
  const activeStored = thread?.session.stored_session_id || null;
  const displayError = error || thread?.error || state.error;
  const model = text(thread?.session.info?.model);
  const sessionCwd = text(thread?.session.info?.cwd);
  const clearError = () => { setError(''); dispatch({ type: 'error', error: null }); if (id) dispatch({ type: 'error', error: null, sessionId: id }); };
  const placeholder = !thread ? "What's on your mind?" : !controlled ? 'Resume this session to send' : thread.running ? 'Queue a follow-up or steer the current task…' : "What's on your mind?";

  // App mode: the Workbench owns the whole window, as a standalone app would.
  return <div className="hwb-host">
    <div ref={root} data-theme={isDark ? 'dark' : 'light'}
      className={`hwb is-app ${expanded ? 'is-expanded' : ''} ${sidebarHidden ? 'is-sidebar-hidden' : ''} ${drawer ? 'is-drawer-open' : ''} ${panel ? 'has-panel' : ''}`}>
      <div className="hwb-frame">
        {drawer && <button type="button" className="hwb-backdrop" aria-label="Close sessions" onClick={() => setDrawer(false)}/>}
        <aside className="hwb-sidebar">
          <Sidebar sessions={sessions} activeId={activeStored} search={search} onSearch={setSearch} onOpen={id => void open(id)} onCreate={() => void create()}
            onRefresh={() => void run(() => client.listSessions())} cwd={cwd} onCwd={updateCwd} connected={connected} busy={busy}/>
        </aside>
        <main className="hwb-main">
          <header className="hwb-header">
            <button type="button" className="hwb-icon-btn" aria-label="Toggle sessions sidebar" onClick={toggleSidebar}><Icon name="sidebar"/></button>
            {thread && <InlineTitle title={thread.session.title || text(thread.session.info?.title) || (activeStored && sessionMap.get(activeStored)?.title) || 'New session'} editable={!!controlled && !busy} onRename={title => id && void run(() => client.rename(id, title))}/>}
            <div className="hwb-header-actions">
              {thread && <button type="button" className="hwb-icon-btn" aria-label="Fork session" disabled={!controlled || busy || thread.running} onClick={() => id && void run(() => client.fork(id))}><Icon name="fork"/></button>}
              <button type="button" className="hwb-icon-btn" aria-label={expanded ? 'Exit full screen' : 'Full screen'} onClick={() => void toggleExpanded()}><Icon name={expanded ? 'minimize' : 'maximize'}/></button>
              <button type="button" className="hwb-icon-btn" aria-label="Toggle details panel" aria-pressed={!!panel} onClick={() => setPanel(panel ? null : 'todos')}><Icon name="sidebarRight"/></button>
            </div>
          </header>
          {!connected && <div className="hwb-banner"><Icon name="alert"/><span>Gateway {state.connection}. Sending is paused until the connection is restored.</span>
            <button type="button" className="hwb-btn hwb-btn-text-strong" disabled={busy || state.connection === 'connecting'} onClick={() => void run(async () => { await client.connect(); await client.listSessions(); })}>Reconnect</button></div>}
          {thread && connected && !controlled && <div className="hwb-banner"><Icon name="alert"/><span>This session isn't attached to Workbench yet.</span>
            <button type="button" className="hwb-btn hwb-btn-text-strong" disabled={busy} onClick={() => void open(thread.session.stored_session_id)}>Resume</button></div>}
          {displayError && <div className="hwb-banner is-error" role="alert"><Icon name="alert"/><span>{displayError}</span>
            <button type="button" className="hwb-icon-btn hwb-xs" aria-label="Dismiss" onClick={clearError}><Icon name="x"/></button></div>}
          <div className="hwb-thread" ref={scroller} onScroll={() => { const el = scroller.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 120); }}>
            <div className="hwb-thread-inner">
              {!thread ? <div className="hwb-empty"><Wordmark/></div>
              : <>
                  {!thread.messages.length && !thread.running && <div className="hwb-empty is-compact"><Wordmark/></div>}
                  <Transcript thread={thread}/>
                  {thread.requests.map(r => <RequestCard key={`${id}:${r.request_id}`} request={r} client={client} enabled={!!controlled}/>)}
                </>}
            </div>
          </div>
          {!follow && <button type="button" className="hwb-jump" aria-label="Jump to latest" onClick={() => setFollow(true)}><Icon name="arrowDown"/></button>}
          <Composer value={draft} onChange={setDraft} onSend={send} onStop={() => { if (id) void client.stop(id).catch((e: Error) => setError(e.message)); }}
            mode={mode} onMode={setMode} enabled={thread ? !!controlled : connected} busy={busy} running={!!thread?.running} queued={thread?.queued} placeholder={placeholder}/>
        </main>
        {panel && thread && <SidePanel tab={panel} onTab={setPanel} onClose={() => setPanel(null)} todos={thread.todos} agents={thread.agents} controllable={!!controlled}
          onRefreshAgents={() => id && void run(() => client.listAgents(id))}
          onSteerAgent={async (agentId, value) => { if (id) await run(() => client.steerAgent(id, agentId, value)); }}
          onStopAgent={agentId => id && void run(() => client.stopAgent(id, agentId))}/>}
      </div>
      <footer className="hwb-statusbar">
        <span className="hwb-status-item"><span className={`hwb-bullet ${connected ? 'is-live' : state.connection === 'connecting' ? 'is-running' : 'is-failed'}`}/>{connected ? 'Gateway ready' : `Gateway ${state.connection}`}</span>
        <a className="hwb-status-item" href={dashboardHref(profile)}><Icon name="settings"/>Dashboard</a>
        {thread && <button type="button" className="hwb-status-item" onClick={() => setPanel(panel === 'agents' ? null : 'agents')}><Icon name="robot"/>Agents{thread.agents.length ? ` ${thread.agents.length}` : ''}</button>}
        {thread && <button type="button" className="hwb-status-item" onClick={() => setPanel(panel === 'todos' ? null : 'todos')}><Icon name="listCheck"/>Todos{thread.todos.length ? ` ${thread.todos.filter(t => /done|complete/.test(text(t.status))).length}/${thread.todos.length}` : ''}</button>}
        <span className="hwb-push"/>
        {profile !== 'default' && <span className="hwb-status-item">Profile {profile}</span>}
        {sessionCwd && <span className="hwb-status-item hwb-mono hwb-truncate">{sessionCwd}</span>}
        <span className="hwb-status-item">{model || 'Default model'}</span>
        <button type="button" className="hwb-status-item" aria-label={`Theme: ${themeMode}`} onClick={() => setTheme(themeMode === 'auto' ? (isDark ? 'light' : 'dark') : 'auto')}>
          <Icon name={isDark ? 'moon' : 'sun'}/>{themeMode === 'auto' ? 'Auto' : themeMode === 'dark' ? 'Dark' : 'Light'}</button>
      </footer>
    </div>
  </div>;
}

/** Where `hermes workbench` installs the desktop app's renderer (with the browser shim). */
function desktopUrl(profile: string): string {
  const base = String((window as any).__HERMES_BASE_PATH__ || '').replace(/\/+$/, '');
  return `${base}/dashboard-plugins/hermes-workbench/desktop/index.html${profile === 'default' ? '' : `?profile=${encodeURIComponent(profile)}`}`;
}

/**
 * The Hermes desktop app's own interface in a full-window, same-origin frame. Its Electron
 * bridge is replaced by desktop-web/hermes-web-shim.js, which borrows this page's SDK for auth.
 */
function DesktopFrame({ profile }: { profile: string }) {
  const root = useRef(null as HTMLDivElement | null);
  useLiftAboveHost(root);
  return <div className="hwb-host"><div ref={root} className="hwb-desktop">
    <iframe title="Hermes" src={desktopUrl(profile)} allow="clipboard-read; clipboard-write; microphone"/>
  </div></div>;
}

/** Desktop UI when installed; the built-in UI otherwise, or when `?ui=classic` asks for it. */
function WorkbenchRoot() {
  const [profile, setProfile] = useState(urlProfile);
  const [ui, setUi] = useState(() => new URLSearchParams(window.location.search).get('ui') === 'classic' ? 'classic' : 'checking');
  useEffect(() => {
    // The dashboard may re-point ?profile= after load (sticky active profile); follow it.
    const timer = setInterval(() => setProfile((old: string) => { const next = urlProfile(); return next === old ? old : next; }), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (ui !== 'checking') return;
    let alive = true;
    fetch(desktopUrl('default'), { cache: 'no-store' })
      .then(res => { if (alive) setUi(res.ok ? 'desktop' : 'classic'); }, () => { if (alive) setUi('classic'); });
    return () => { alive = false; };
  }, [ui]);
  if (ui === 'checking') return <div className="hwb-host"><div className="hwb-desktop"/></div>;
  if (ui === 'desktop') return <DesktopFrame key={profile} profile={profile}/>;
  return <Workbench key={profile} profile={profile}/>;
}

(window as any).__HERMES_PLUGINS__.register('hermes-workbench', WorkbenchRoot);
