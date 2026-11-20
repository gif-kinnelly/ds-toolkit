// End-to-end: Agent Context in Chrome against the docs mock file.
import assert from 'node:assert/strict';
import { openPlugin } from './browser.mjs';

const { browser, frame: f, errors } = await openPlugin('agent-context', 'docsFile', { height: 700 });
await f.locator('#build').click();
await f.locator('#out:not([hidden])').waitFor();
const md = await f.locator('#preview').textContent();
console.log(md.split('\n').slice(0, 30).join('\n'));
assert.match(await f.locator('#status').textContent(), /rules, 5 tokens, 2 components/);
assert.match(md, /^# Acme DS: design system/);
assert.match(md, /Never hardcode colors/);
assert.match(md, /\| `color\/on-primary` \| text color \|/);
assert.match(md, /### Button\n\nTriggers an action/);
assert.match(md, /- `size`: `sm` \| `md`/);
assert.match(md, /Uses `color\/danger`, `color\/on-primary`, `color\/primary`, `radius\/md`, `space\/4`\./);
assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
