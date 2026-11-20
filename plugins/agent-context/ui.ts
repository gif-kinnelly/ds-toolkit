// Agent Context — UI.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (t: string, err = false) => { const s = $('status'); s.textContent = t; s.className = err ? 'error' : ''; };
let md = '', json = '';
const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
};
onmessage = (e: MessageEvent) => {
  const m = e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'progress') say(m.text);
  if (m.type === 'error') say(m.message, true);
  if (m.type === 'manifest') {
    md = m.markdown; json = m.json;
    $('preview').textContent = md;
    $('out').hidden = false;
    say(`${m.stats.rules} rules, ${m.stats.tokens} tokens, ${m.stats.components} components.`);
  }
};
$('build').onclick = () => parent.postMessage({ pluginMessage: { type: 'build' } }, '*');
$('md').onclick = () => download('design-system.md', md, 'text/markdown');
$('json').onclick = () => download('design-system.json', json, 'application/json');
$('copy').onclick = () => {
  const ta = document.createElement('textarea'); ta.value = md; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove(); say(ok ? 'Copied.' : 'Copy failed; download instead.', !ok);
};
export {};
