import type { SessionSummary } from '../client';
import { React, useState } from '../sdk';
import { Icon } from './icons';

export interface SidebarSession extends SessionSummary { live?: boolean; running?: boolean }

const SOURCE_LABELS: Record<string, string> = { dashboard: 'Web', webui: 'Web', cli: 'CLI', tui: 'Terminal', desktop: 'Desktop', cron: 'Cron', telegram: 'Telegram', discord: 'Discord', slack: 'Slack', api: 'API' };
const sourceLabel = (s?: string) => SOURCE_LABELS[(s || '').toLowerCase()] || (s ? s[0].toUpperCase() + s.slice(1) : 'Other');
const PAGE = 8;

function Dither() {
  return <svg className="hwb-dither" viewBox="0 0 8 8" aria-hidden="true">{[0, 2, 4, 6].flatMap(y => [0, 2, 4, 6].map(x =>
    <rect key={`${x}${y}`} x={x + (y % 4 ? 1 : 0)} y={y} width="1" height="1"/>))}</svg>;
}

export interface SidebarProps {
  sessions: SidebarSession[];
  activeId: string | null;
  search: string;
  onSearch(value: string): void;
  onOpen(id: string): void;
  onCreate(): void;
  onRefresh(): void;
  cwd: string;
  onCwd(value: string): void;
  connected: boolean;
  busy: boolean;
}

export function Sidebar(props: SidebarProps) {
  const { sessions, activeId, search, onSearch, onOpen, onCreate, onRefresh, cwd, onCwd, connected, busy } = props;
  const [expanded, setExpanded] = useState({} as Record<string, boolean>);
  const [editingCwd, setEditingCwd] = useState(false);
  const groups = new Map<string, SidebarSession[]>();
  for (const s of sessions) {
    const key = sourceLabel(s.source);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return <nav className="hwb-sidebar-inner" aria-label="Sessions">
    <div className="hwb-nav">
      <button type="button" className="hwb-nav-row" disabled={!connected || busy} onClick={onCreate}><Icon name="pencil"/><span>New session</span></button>
    </div>
    <label className="hwb-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions…" value={search} onChange={(e: any) => onSearch(e.target.value)}/></label>
    <div className="hwb-section-head">
      <Dither/><span className="hwb-section-label">Sessions</span><span className="hwb-section-count">{sessions.length}</span>
      <button type="button" className="hwb-icon-btn hwb-xs hwb-push" aria-label="Refresh sessions" disabled={!connected || busy} onClick={onRefresh}><Icon name="loader"/></button>
    </div>
    <div className="hwb-session-scroll">
      {[...groups.entries()].map(([group, items]) => {
        const open = expanded[group] || !!search;
        const visible = open ? items : items.slice(0, PAGE);
        return <div className="hwb-group" key={group}>
          <div className="hwb-group-head"><span className="hwb-group-badge">{group[0]}</span><span>{group}</span><span className="hwb-section-count">{items.length}</span></div>
          {visible.map(s => <button type="button" key={s.id} className="hwb-session" aria-current={s.id === activeId ? 'true' : undefined} disabled={!connected || busy} onClick={() => onOpen(s.id)}>
            <span className={`hwb-bullet ${s.running ? 'is-running' : s.live ? 'is-live' : ''}`}/>
            <span className="hwb-session-title">{s.title || s.preview || 'Untitled session'}</span>
          </button>)}
          {items.length > PAGE && !search && <button type="button" className="hwb-more" onClick={() => setExpanded({ ...expanded, [group]: !open })}>{open ? 'Show less' : `Show ${items.length - PAGE} more`}</button>}
        </div>;
      })}
      {!sessions.length && <p className="hwb-empty-note">{search ? 'No matching sessions.' : connected ? 'No sessions yet.' : 'Connecting…'}</p>}
    </div>
    <div className="hwb-sidebar-foot">
      {editingCwd
        ? <form className="hwb-cwd-edit" onSubmit={(e: any) => { e.preventDefault(); setEditingCwd(false); }}>
            <Icon name="folder"/><input autoFocus aria-label="Workspace directory for new sessions" value={cwd} spellCheck={false} onChange={(e: any) => onCwd(e.target.value)} onBlur={() => setEditingCwd(false)}/>
          </form>
        : <button type="button" className="hwb-nav-row hwb-cwd" aria-label="Workspace for new sessions" onClick={() => setEditingCwd(true)}><Icon name="folder"/><span className="hwb-mono">{cwd || 'Default workspace'}</span></button>}
    </div>
  </nav>;
}
