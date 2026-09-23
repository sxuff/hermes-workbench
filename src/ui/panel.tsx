import type { Subagent } from '../client';
import type { TodoItem } from '../state';
import { React, useState, text } from '../sdk';
import { Icon } from './icons';

export type PanelTab = 'todos' | 'agents';

function AgentCard({ agent, controllable, onSteer, onStop }: { agent: Subagent; controllable: boolean; onSteer(text: string): Promise<void>; onStop(): void }) {
  const [steering, setSteering] = useState(false);
  const [value, setValue] = useState('');
  const running = agent.status === 'running';
  return <div className="hwb-agent">
    <div className="hwb-agent-head">
      <span className={`hwb-bullet ${running ? 'is-running' : agent.status === 'failed' || agent.status === 'error' ? 'is-failed' : 'is-live'}`}/>
      <span className="hwb-agent-name">{text(agent.name) || agent.goal || agent.subagent_id}</span>
      <span className="hwb-muted">{agent.status || 'unknown'}</span>
    </div>
    {agent.goal && text(agent.name) && <p className="hwb-agent-goal">{agent.goal}</p>}
    {agent.model && <div className="hwb-muted hwb-mono">{agent.model}</div>}
    {running && controllable && (steering
      ? <form className="hwb-widget-input" onSubmit={(e: any) => { e.preventDefault(); if (value.trim()) void onSteer(value.trim()).then(() => { setValue(''); setSteering(false); }); }}>
          <input autoFocus aria-label="Steer this agent" placeholder="Tell this agent…" value={value} onChange={(e: any) => setValue(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Escape') setSteering(false); }}/>
          <button type="submit" className="hwb-icon-btn hwb-send-sm" aria-label="Send steer" disabled={!value.trim()}><Icon name="arrowUp"/></button>
        </form>
      : <div className="hwb-agent-actions">
          <button type="button" className="hwb-btn hwb-btn-secondary hwb-sm" onClick={() => setSteering(true)}>Steer</button>
          <button type="button" className="hwb-btn hwb-btn-text hwb-sm hwb-danger" onClick={onStop}>Stop</button>
        </div>)}
  </div>;
}

export interface PanelProps {
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  onClose(): void;
  todos: TodoItem[];
  agents: Subagent[];
  controllable: boolean;
  onRefreshAgents(): void;
  onSteerAgent(id: string, text: string): Promise<void>;
  onStopAgent(id: string): void;
}

export function SidePanel(props: PanelProps) {
  const { tab, onTab, onClose, todos, agents, controllable, onRefreshAgents, onSteerAgent, onStopAgent } = props;
  const done = todos.filter(t => /done|complete/.test(text(t.status))).length;
  return <aside className="hwb-panel" aria-label="Session details">
    <div className="hwb-panel-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'todos'} onClick={() => onTab('todos')}><Icon name="listCheck"/>Todos{todos.length ? <span className="hwb-section-count">{done}/{todos.length}</span> : null}</button>
      <button type="button" role="tab" aria-selected={tab === 'agents'} onClick={() => onTab('agents')}><Icon name="robot"/>Agents{agents.length ? <span className="hwb-section-count">{agents.length}</span> : null}</button>
      <button type="button" className="hwb-icon-btn hwb-xs hwb-push" aria-label="Close panel" onClick={onClose}><Icon name="x"/></button>
    </div>
    <div className="hwb-panel-body">
      {tab === 'todos' ? (todos.length
        ? <ul className="hwb-todos">{todos.map((t, i) => {
            const status = text(t.status);
            const state = /done|complete/.test(status) ? 'done' : /progress|active|running/.test(status) ? 'active' : /cancel/.test(status) ? 'cancelled' : 'pending';
            return <li key={text(t.id) || i} className={`is-${state}`}>
              {state === 'done' ? <Icon name="circleCheck"/> : state === 'active' ? <Icon name="loader" className="hwb-spin"/> : <span className="hwb-todo-pending"/>}
              <span>{text(t.content) || text(t.title) || text(t.text)}</span>
            </li>;
          })}</ul>
        : <p className="hwb-empty-note">Hermes hasn't made a plan for this session yet.</p>)
      : <>
          <div className="hwb-panel-row"><span className="hwb-muted">Only agents verified as belonging to this session can be controlled.</span>
            <button type="button" className="hwb-btn hwb-btn-text hwb-sm" disabled={!controllable} onClick={onRefreshAgents}>Refresh</button></div>
          {agents.length
            ? agents.map(a => <AgentCard key={a.subagent_id} agent={a} controllable={controllable} onSteer={t => onSteerAgent(a.subagent_id, t)} onStop={() => onStopAgent(a.subagent_id)}/>)
            : <p className="hwb-empty-note">No delegated agents in this session.</p>}
        </>}
    </div>
  </aside>;
}
