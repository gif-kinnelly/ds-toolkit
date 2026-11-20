// Component Docs — UI.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: Record<string, unknown>) => parent.postMessage({ pluginMessage: m }, '*');
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'counts') {
    $('sel').textContent = m.selection ? `Document selection (${m.selection})` : 'Document selection';
    $<HTMLButtonElement>('sel').disabled = !m.selection;
    $('page').textContent = `Document this page (${m.page})`;
    $<HTMLButtonElement>('page').disabled = !m.page;
  }
  if (m.type === 'progress') say(m.text);
  if (m.type === 'done') say(m.text);
  if (m.type === 'error') say(m.message, true);
  if (m.type === 'markdown') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([m.text], { type: 'text/markdown' }));
    a.download = 'components.md';
    document.body.appendChild(a); a.click(); a.remove();
    say(`Downloaded docs for ${plural(m.count, 'component')}.`);
    (window as unknown as { __lastMarkdown: string }).__lastMarkdown = m.text;
  }
};
$('sel').onclick = () => send({ type: 'generate', scope: 'selection' });
$('page').onclick = () => send({ type: 'generate', scope: 'page' });
$('mdPage').onclick = () => send({ type: 'markdown', scope: 'page' });
$('mdFile').onclick = () => send({ type: 'markdown', scope: 'file' });
send({ type: 'init' });

export {};
