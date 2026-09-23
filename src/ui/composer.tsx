import { React, useRef, useLayoutEffect, pretty } from '../sdk';
import { Icon } from './icons';

export type SendMode = 'submit' | 'queue' | 'steer';

export interface ComposerProps {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  onStop(): void;
  mode: SendMode;
  onMode(mode: SendMode): void;
  enabled: boolean;
  busy: boolean;
  running: boolean;
  queued: unknown;
  placeholder: string;
}

export function Composer(props: ComposerProps) {
  const { value, onChange, onSend, onStop, mode, onMode, enabled, busy, running, queued, placeholder } = props;
  const area = useRef(null as HTMLTextAreaElement | null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  // While a turn runs, a plain send is not accepted: the user picks queue or steer.
  const effective: SendMode = running && mode === 'submit' ? 'queue' : mode;
  const canSend = enabled && !busy && !!value.trim();
  const queuedText = queued == null ? '' : typeof queued === 'object' ? String((queued as any).user ?? pretty(queued)) : pretty(queued);
  return <div className="hwb-composer-dock">
    {queuedText && <div className="hwb-status-stack"><div className="hwb-status-row"><Icon name="listCheck"/><span className="hwb-status-text">{queuedText}</span><span className="hwb-muted">Queued</span></div></div>}
    <form className={`hwb-composer ${enabled ? '' : 'is-disabled'}`} onSubmit={(e: any) => { e.preventDefault(); if (canSend) onSend(); }}>
      <textarea ref={area} rows={1} aria-label="Message Hermes" placeholder={placeholder} disabled={!enabled} value={value}
        onChange={(e: any) => onChange(e.target.value)}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSend(); } }}/>
      <div className="hwb-composer-bar">
        <div className="hwb-composer-left">
          {running && <div className="hwb-segmented" role="radiogroup" aria-label="While Hermes works">
            {(['queue', 'steer'] as const).map(m => <button type="button" key={m} role="radio" aria-checked={effective === m} disabled={!enabled} onClick={() => onMode(m)}>{m === 'queue' ? 'Queue' : 'Steer'}</button>)}
          </div>}
        </div>
        <div className="hwb-composer-right">
          {running && <button type="button" className="hwb-round-btn is-stop" aria-label="Stop" disabled={!enabled} onClick={onStop}><Icon name="stop" filled/></button>}
          {(!running || value.trim()) && <button type="submit" className="hwb-round-btn" aria-label={effective === 'steer' ? 'Steer' : effective === 'queue' ? 'Queue' : 'Send'} disabled={!canSend}><Icon name="arrowUp"/></button>}
        </div>
      </div>
    </form>
  </div>;
}
