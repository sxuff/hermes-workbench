import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { React, useMemo } from '../sdk';

const COPY_ICON = '<svg class="hwb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/></svg>';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderMarkdown(value: string): string {
  const clean = DOMPurify.sanitize(marked.parse(value, { async: false, gfm: true }) as string, {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'button'], FORBID_ATTR: ['style'],
  }) as string;
  // Wrap sanitized fences with our own chrome. Only the language token (already
  // sanitized, then escaped again) is interpolated.
  return clean.replace(/<pre><code(?: class="language-([^"]*)")?>/g, (_m, lang?: string) =>
    `<div class="hwb-code"><div class="hwb-code-head"><span>${escapeHtml(lang || 'text')}</span><button type="button" class="hwb-code-copy" data-hwb-copy aria-label="Copy code">${COPY_ICON}</button></div><pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>`,
  ).replace(/<\/code><\/pre>/g, '</code></pre></div>')
    .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')
    .replace(/<table>/g, '<div class="hwb-table"><table>').replace(/<\/table>/g, '</table></div>');
}

function onCopyClick(event: any) {
  const button = (event.target as HTMLElement).closest?.('[data-hwb-copy]');
  if (!button) return;
  const code = button.closest('.hwb-code')?.querySelector('code')?.textContent ?? '';
  void navigator.clipboard?.writeText(code).then(() => {
    button.classList.add('is-done');
    setTimeout(() => button.classList.remove('is-done'), 1200);
  }).catch(() => { /* clipboard unavailable */ });
}

export function Markdown({ value, className = '' }: { value: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(value), [value]);
  return <div className={`hwb-prose ${className}`} onClick={onCopyClick} dangerouslySetInnerHTML={{ __html: html }}/>;
}
