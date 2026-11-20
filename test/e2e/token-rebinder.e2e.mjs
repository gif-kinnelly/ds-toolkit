// End-to-end: Token Rebinder in Chrome against a mock page of hand-built UI.
// Run: npm run build && node test/e2e/token-rebinder.e2e.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { openPlugin } from './browser.mjs';

const { browser, page, frame: f, errors } = await openPlugin('token-rebinder', 'rebindFile', { height: 1500 });

await f.locator('#scan').click();
await f.locator('.sum').waitFor();
const rows = await f.locator('.g').evaluateAll((els) => els.map((el) => ({
  value: el.querySelector('.val').textContent,
  family: el.querySelector('.fam').textContent,
  count: Number(el.querySelector('.n').textContent.match(/\d+/)[0]),
  token: el.querySelector('select').selectedOptions[0].textContent.split(' · ')[0],
  checked: el.querySelector('input').checked,
})));
const row = (value, family) => rows.find((r) => r.value === value && r.family === family);
console.log(await f.locator('.sum').textContent());
for (const r of rows) console.log(`  ${r.checked ? '☑' : '☐'} ${r.value} ${r.family} ×${r.count} → ${r.token}`);

// Scopes pick the semantic token for each use of the same hex.
assert.deepEqual(row('#ffffff', 'fill'), { value: '#ffffff', family: 'fill', count: 3, token: 'color/surface', checked: true }, 'card 3 is in dark mode, where surface is #18181b');
assert.equal(row('#ffffff', 'text').token, 'color/on-primary');
assert.equal(row('#ffffff', 'text').count, 4, 'on-primary is white in both modes');
assert.equal(row('#18181b', 'text').token, 'color/text', 'aliased semantic token, not the hidden primitive');
assert.equal(row('#e4e4e7', 'stroke').token, 'color/border');
// Gap and padding of the same size share a row.
assert.equal(row('12', 'spacing').count, 8, 'gap 12 on 4 cards and padding 12 on 4 buttons... is 8 layers');
assert.equal(row('16', 'spacing').token, 'space/4');
assert.equal(row('8', 'radius').token, 'radius/lg');
assert.equal(row('14', 'font size').count, 8);
// A paint at 50% black matches a token with the alpha built in.
assert.equal(row('#00000080', 'fill').token, 'color/scrim');
// Near match is offered but not ticked.
assert.equal(row('#4f47e6', 'fill').token, 'color/primary');
assert.equal(row('#4f47e6', 'fill').checked, false);
// Nothing to suggest: the off-palette color, and the light colors painted on the dark card.
const none = await f.locator('details.none').textContent();
assert.match(none, /#123456/);
assert.match(none, /#ffffff · fill · 1 layer/);
// The instance's raw fill was skipped.
assert.equal(rows.filter((r) => r.value === '#4f46e5').reduce((n, r) => n + r.count, 0), 2);

const shot = process.argv[2];
if (shot) { await page.locator('iframe').screenshot({ path: shot }); console.log('screenshot:', shot); }

// Bind everything that's ticked.
const applyText = await f.locator('#apply').textContent();
console.log(applyText);
await f.locator('#apply').click();
await f.locator('#status').filter({ hasText: 'Bound' }).waitFor();
await f.locator('#scan:not([disabled])').waitFor();

const state = await page.evaluate(() => {
  const p = window.__page;
  const name = async (a) => a && (await figma.variables.getVariableByIdAsync(a.id)).name;
  const card = p.children[0], button = card.children[2], scrim = p.children[5];
  return Promise.all([
    name(card.fills[0].boundVariables?.color), name(card.strokes[0].boundVariables?.color),
    name(card.boundVariables?.topLeftRadius), name(card.boundVariables?.paddingTop), name(card.boundVariables?.itemSpacing),
    name(button.boundVariables?.paddingLeft), name(button.boundVariables?.paddingTop),
    name(button.children[0].fills[0].boundVariables?.color), name(button.children[0].boundVariables?.fontSize),
    name(scrim.fills[0].boundVariables?.color), scrim.fills[0].opacity,
    p.children[2].children[2].fills[0].boundVariables?.color ?? null, // near match, not ticked
    window.__undo.commits,
  ]);
});
assert.deepEqual(state, ['color/surface', 'color/border', 'radius/lg', 'space/4', 'space/3', 'space/3', 'space/2', 'color/on-primary', 'font-size/sm', 'color/scrim', 1, null, 1]);

// After the rescan, only the near match and the no-match values are left.
const left = await f.locator('.g .val').allTextContents();
assert.deepEqual(left, ['#4f47e6']);
console.log('after:', await f.locator('.sum').textContent());

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
