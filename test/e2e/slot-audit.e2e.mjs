// End-to-end: Slot Audit in Chrome against a mock file of cards and dialogs with slots.
// Run: npm run build && node test/e2e/slot-audit.e2e.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { openPlugin } from './browser.mjs';

const { browser, page, frame: f, errors } = await openPlugin('slot-audit', 'slotFile', { height: 1000 });
await f.locator('#scan').click();
await f.locator('.sum').waitFor();
const sum = await f.locator('.sum').textContent();
const cards = (await f.locator('.slot').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log(sum); for (const c of cards) console.log(' ', c);

assert.equal(sum, '2 slots on 14 instances: 3 broken limits.');
const card = cards.find((c) => c.startsWith('Card › Content'));
assert.match(card, /1–3 items 11 uses · 1 empty/);
assert.match(card, /1 slot: too few items ?Show 1 slot: too many items ?Show/);
assert.match(card, /Text block 10 Media 9 frame \(not a component\) 1 Promo 1/);
assert.match(card, /Prefer Text block, Media only these Set preferred/);
const dialog = cards.find((c) => c.startsWith('Dialog › Body'));
assert.match(dialog, /1 preferred only/);
assert.match(dialog, /1 slot: non-preferred content/);
assert.match(dialog, /From a library/);

// Show selects the broken slots.
await f.locator('.slot', { hasText: 'Card › Content' }).locator('.viol', { hasText: 'too many' }).locator('a').click();
await page.waitForFunction(() => figma.currentPage.selection.length === 1);

const shot = process.argv[2];
if (shot) { await page.locator('iframe').screenshot({ path: shot }); console.log('screenshot:', shot); }

// Set preferred values from usage, preferred only, keeping min/max.
await f.locator('.slot', { hasText: 'Card › Content' }).locator('input[data-only]').check();
await f.locator('.slot', { hasText: 'Card › Content' }).locator('button[data-prefer]').click();
await f.locator('.slot', { hasText: 'Card › Content' }).locator('.tag', { hasText: 'preferred only' }).waitFor();
const def = await page.evaluate(() => window.__card.componentPropertyDefinitions['Content#2:0']);
assert.deepEqual(def.slotSettings, { minChildren: 1, maxChildren: 3, allowPreferredValuesOnly: true });
assert.deepEqual(def.preferredValues.map((p) => p.type), ['COMPONENT', 'COMPONENT_SET'], 'Text block is a component, Media a set');
console.log('after:', (await f.locator('.slot', { hasText: 'Card › Content' }).locator('.hd').innerText()).replace(/\s+/g, ' '));

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e ok');
