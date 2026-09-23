import type { NativeMessage } from '../client';
import type { ThreadState } from '../state';
import { React, useState, text, pretty, obj } from '../sdk';
import { Icon, toolIcon } from './icons';
import { Markdown } from './markdown';

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** The one-line preview shown beside a tool name: explicit context, else the most telling argument. */
function toolContext(m: NativeMessage): string {
  const args = obj(m.args);
  const raw = text(m.context) || text(m.preview) || text(args.command) || text(args.path) || text(args.file_path)
    || text(args.query) || text(args.url) || text(args.pattern) || text(args.goal) || text(args.question);
  return raw.split('\n')[0].slice(0, 160);
}
function toolResult(m: NativeMessage): string {
  if (m.live) return text(m.result_text) || text(m.summary) || pretty(m.result);
  return text(m.text) || pretty(m.content);
}
const toolFailed = (m: NativeMessage) => !!m.error || m.status === 'error' || m.status === 'failed';

function DiffView({ diff }: { diff: string }) {
  return <pre className="hwb-diff">{diff.split('\n').map((line, i) =>
    <span key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>{line + '\n'}</span>)}</pre>;
}

export function ToolRow({ message }: { message: NativeMessage }) {
  const [open, setOpen] = useState(false);
  const name = text(message.name) || 'tool';
  const running = message.live && message.status !== 'complete';
  const failed = toolFailed(message);
  const context = toolContext(message);
  const result = toolResult(message);
  const diff = text(message.inline_diff);
  const args = message.args && Object.keys(obj(message.args)).length ? pretty(message.args) : '';
  const duration = typeof message.duration_s === 'number' ? `${message.duration_s < 10 ? message.duration_s.toFixed(1) : Math.round(message.duration_s)}s` : '';
  return <div className={`hwb-scaffold hwb-tool ${open ? 'is-open' : ''} ${failed ? 'is-failed' : ''}`}>
    <button type="button" className="hwb-scaffold-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name={toolIcon(name)} className="hwb-scaffold-icon"/>
      <span className="hwb-scaffold-label">{titleCase(name)}</span>
      {context && <span className="hwb-scaffold-meta hwb-mono">{context}</span>}
      <span className="hwb-scaffold-tail">
        {duration && <span className="hwb-scaffold-meta">{duration}</span>}
        {running ? <Icon name="loader" className="hwb-spin"/> : failed ? <Icon name="circleX" className="hwb-danger"/> : null}
        <Icon name="chevronRight" className="hwb-chevron"/>
      </span>
    </button>
    {open && <div className="hwb-scaffold-body">
      {args && <section><span className="hwb-label">Input</span><pre className="hwb-log">{args}</pre></section>}
      {diff && <section><span className="hwb-label">Changes</span><DiffView diff={diff}/></section>}
      {result && <section><span className="hwb-label">{failed ? 'Error' : 'Output'}</span><pre className="hwb-log">{result}</pre></section>}
      {!args && !diff && !result && <p className="hwb-muted">{running ? 'Running…' : 'No output.'}</p>}
    </div>}
  </div>;
}

function ToolGroup({ tools }: { tools: NativeMessage[] }) {
  const [open, setOpen] = useState(false);
  const failed = tools.filter(toolFailed).length;
  const names = [...new Set(tools.map(t => titleCase(text(t.name) || 'tool')))];
  return <div className={`hwb-scaffold hwb-tool-group ${open ? 'is-open' : ''}`}>
    <button type="button" className="hwb-scaffold-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name="tool" className="hwb-scaffold-icon"/>
      <span className="hwb-scaffold-label">Used {tools.length} tools</span>
      <span className="hwb-scaffold-meta">{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</span>
      <span className="hwb-scaffold-tail">{failed ? <span className="hwb-scaffold-meta hwb-danger">{failed} failed</span> : null}<Icon name="chevronRight" className="hwb-chevron"/></span>
    </button>
    {open && <div className="hwb-tool-group-body">{tools.map((t, i) => <ToolRow key={text(t.tool_id) || i} message={t}/>)}</div>}
  </div>;
}

export function Thinking({ value, live = false }: { value: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`hwb-scaffold hwb-thinking ${open ? 'is-open' : ''}`}>
    <button type="button" className="hwb-scaffold-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name="bulb" className="hwb-scaffold-icon"/>
      <span className={`hwb-scaffold-label ${live ? 'hwb-shimmer' : ''}`}>{live ? 'Thinking' : 'Thought'}</span>
      <span className="hwb-scaffold-tail"><Icon name="chevronRight" className="hwb-chevron"/></span>
    </button>
    {open && <div className="hwb-scaffold-body hwb-thinking-body"><Markdown value={value}/></div>}
  </div>;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="hwb-icon-btn hwb-xs" aria-label="Copy message" onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {});
  }}><Icon name={done ? 'check' : 'copy'}/></button>;
}

const DELIVERY_NOTE: Record<string, string> = {
  uncertain: 'Delivery uncertain. Check the reply before resending.',
  rejected: 'Not delivered.',
  voice_stopped: 'Voice playback stopped.',
};

export function Message({ message, streaming = false, turnEnd = true }: { message: NativeMessage; streaming?: boolean; turnEnd?: boolean }) {
  const body = message.text || text(message.content);
  if (message.role === 'tool') return <ToolRow message={message}/>;
  if (message.role === 'user') {
    const note = DELIVERY_NOTE[text(message.delivery)];
    return <div className={`hwb-turn-user ${message.delivery === 'pending' ? 'is-pending' : ''}`}>
      <div className="hwb-bubble">
        {message.mode && message.mode !== 'submit' && <span className="hwb-badge">{text(message.mode) === 'queue' ? 'Queued' : 'Steer'}</span>}
        <div className="hwb-bubble-text">{body}</div>
      </div>
      {note && <div className={`hwb-delivery ${message.delivery === 'rejected' ? 'hwb-danger' : ''}`}><Icon name="alert"/>{note}</div>}
    </div>;
  }
  if (message.role === 'system') return <div className="hwb-system"><Markdown value={body}/></div>;
  const reasoning = text(message.reasoning);
  if (!body.trim() && !reasoning) return null;
  return <div className="hwb-turn-assistant">
    {reasoning && <Thinking value={reasoning}/>}
    {body && <Markdown value={body} className={streaming ? 'is-streaming' : ''}/>}
    {body && !streaming && turnEnd && <div className="hwb-message-actions"><CopyButton value={body}/></div>}
  </div>;
}

type Block = { kind: 'message'; message: NativeMessage; key: string; turnEnd?: boolean } | { kind: 'tools'; tools: NativeMessage[]; key: string };

/** Collapse runs of settled tool rows into one scaffold, as the desktop transcript does. */
export function blocks(messages: NativeMessage[]): Block[] {
  const out: Block[] = [];
  let run: NativeMessage[] = [];
  const flush = () => {
    if (run.length >= 3 && run.every(t => !t.live || t.status === 'complete')) out.push({ kind: 'tools', tools: run, key: `g-${text(run[0].tool_id) || out.length}` });
    else run.forEach((m, i) => out.push({ kind: 'message', message: m, key: text(m.tool_id) || `t-${out.length}-${i}` }));
    run = [];
  };
  messages.forEach((m, i) => {
    if (m.role === 'tool') { run.push(m); return; }
    flush();
    out.push({ kind: 'message', message: m, key: String(m.client_id || m.row_id || `m-${i}`) });
  });
  flush();
  // Message actions belong to the end of a turn: the last block before the next user prompt.
  out.forEach((b, i) => { if (b.kind === 'message') { const next = out[i + 1]; b.turnEnd = !next || (next.kind === 'message' && next.message.role === 'user'); } });
  return out;
}

export function Transcript({ thread }: { thread: ThreadState }) {
  const showTicker = thread.running && !thread.streamingText && !thread.requests.length;
  const items = blocks(thread.messages);
  return <>
    {items.map((b, i) => b.kind === 'tools' ? <ToolGroup key={b.key} tools={b.tools}/>
      : <Message key={b.key} message={b.message} turnEnd={!!b.turnEnd && !(thread.running && i === items.length - 1)}/>)}
    {thread.reasoningText && <Thinking value={thread.reasoningText} live={thread.running}/>}
    {thread.streamingText && <Message message={{ role: 'assistant', text: thread.streamingText }} streaming/>}
    {showTicker && <div className="hwb-ticker" role="status"><span className="hwb-shimmer">{titleCase(thread.status && thread.status !== 'working' ? thread.status : 'Working')}…</span></div>}
  </>;
}
