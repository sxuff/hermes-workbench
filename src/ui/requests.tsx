import type { WorkbenchClient, ServerRequest, ApprovalDecision } from '../client';
import { React, useState, text, pretty, obj, errorText } from '../sdk';
import { Icon } from './icons';

const LABELS: Record<ApprovalDecision, string> = { once: 'Allow once', session: 'Allow for session', always: 'Always allow', deny: 'Deny' };

function approvalChoices(p: Record<string, any>): ApprovalDecision[] {
  const all: ApprovalDecision[] = Array.isArray(p.choices) ? p.choices : p.smart_denied || p.allow_session === false ? ['once', 'deny'] : p.allow_permanent === false ? ['once', 'session', 'deny'] : ['once', 'session', 'always', 'deny'];
  // Right-aligned footer: quiet refusal first, the primary decision last.
  const order: ApprovalDecision[] = ['deny', 'always', 'session', 'once'];
  return order.filter(c => all.includes(c));
}

export function RequestCard({ request, client, enabled }: { request: ServerRequest; client: WorkbenchClient; enabled: boolean }) {
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
  const options = question?.choices ?? question?.options ?? p.choices ?? p.options;
  const prompt = text(question?.question ?? question?.text ?? p.question ?? p.description ?? p.message) || request.type;
  const disabled = !enabled || busy;

  async function respond(choice?: ApprovalDecision, value = answer) {
    if (disabled) return;
    setBusy(true); setError('');
    try {
      if (choice) await client.respondApproval(request.session_id, request.request_id, choice);
      else {
        await client.respondClarification(request.session_id, request.request_id, value, questionId || undefined);
        if (questionId) setAnswered((a: string[]) => [...a, questionId]);
        setAnswer('');
      }
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  if (isApproval) {
    const command = text(p.command) || pretty(p.tool ?? p.args ?? '');
    return <section className="hwb-request is-approval" aria-label="Approval required">
      <div className="hwb-widget">
        <div className="hwb-widget-head"><Icon name="alert" className="hwb-warn"/><span>Approval required</span></div>
        {prompt !== request.type && prompt !== command && <p>{prompt}</p>}
        {command && <pre className="hwb-log">{command}</pre>}
      </div>
      <div className="hwb-request-actions">
        {approvalChoices(p).map(c => <button type="button" key={c} className={`hwb-btn ${c === 'once' ? 'hwb-btn-primary' : c === 'deny' ? 'hwb-btn-text' : 'hwb-btn-secondary'}`} disabled={disabled} onClick={() => void respond(c)}>{LABELS[c]}</button>)}
      </div>
      {error && <div className="hwb-inline-error" role="alert">{error}</div>}
    </section>;
  }

  if (isClarify) {
    const choices = Array.isArray(options) ? options.map((o: unknown) => typeof o === 'string' ? o : text(obj(o).value ?? obj(o).label ?? obj(o).text)).filter(Boolean) : [];
    return <section className="hwb-request" aria-label="Input required">
      <div className="hwb-widget">
        <div className="hwb-widget-head"><Icon name="chat"/><span>Hermes has a question</span>{questions.length > 1 && <span className="hwb-muted">{answered.length + 1} of {questions.length}</span>}</div>
        <p className="hwb-widget-question">{prompt}</p>
        {choices.length > 0 && <div className="hwb-choices">{choices.map((value: string, i: number) =>
          <button type="button" key={i} className="hwb-choice" disabled={disabled} onClick={() => void respond(undefined, value)}>
            <span className="hwb-choice-key">{i + 1}</span><span>{value}</span></button>)}</div>}
        <form className="hwb-widget-input" onSubmit={(e: any) => { e.preventDefault(); if (answer.trim()) void respond(); }}>
          <input aria-label="Clarification answer" placeholder={choices.length ? 'Or type your own answer…' : 'Type your answer…'} value={answer} disabled={disabled} onChange={(e: any) => setAnswer(e.target.value)}/>
          <button type="submit" className="hwb-icon-btn hwb-send-sm" aria-label="Send answer" disabled={disabled || !answer.trim()}><Icon name="arrowUp"/></button>
        </form>
      </div>
      {error && <div className="hwb-inline-error" role="alert">{error}</div>}
    </section>;
  }

  return <section className="hwb-request" aria-label="Secure input required">
    <div className="hwb-widget">
      <div className="hwb-widget-head"><Icon name="alert" className="hwb-warn"/><span>Secure input required</span></div>
      <p>{prompt}</p>
      <p className="hwb-muted">Workbench never collects passwords or secrets. Answer this prompt in the Hermes terminal or desktop app.</p>
    </div>
  </section>;
}
