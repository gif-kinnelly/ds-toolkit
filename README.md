# ds-toolkit

Free, open-source tools for people who maintain design systems in Figma. All of
them share one core: a format-neutral **snapshot** of variables, styles and
components, and a **diff** that says what a change will do and what it could
break.

| Tool | Status |
|---|---|
| [Import Preview](#import-preview-figma-plugin) (Figma plugin + CLI) | ✅ |
| [Brand Inheritance](#brand-inheritance-figma-plugin) (Figma plugin) | ✅ |
| [Token Rebinder](#token-rebinder-figma-plugin) (Figma plugin) | ✅ |
| [Drift report](#drift-report-github-action) (GitHub Action) | ✅ |
| [System Inventory](#system-inventory-figma-plugin) (Figma plugin) | ✅ |
| [Component Docs](#component-docs-figma-plugin) (Figma plugin) | ✅ |
| [Slot Audit](#slot-audit-figma-plugin) (Figma plugin) | ✅ |
| [Agent Context](#agent-context-figma-plugin--cli) (Figma plugin + CLI) | ✅ |

## What it reads

| Format | Example |
|---|---|
| W3C Design Tokens (DTCG), including 2025.10 color/dimension objects | `tokens/*.json` |
| Figma's native **Export variables** output (one file per mode) | `Theme/Light.tokens.json` |
| Figma REST API `GET /v1/files/:key/variables/local` | `variables.json` |
| Component spec (the "UI Components Sync" format: tokens + auto-layout variants) | `spec.json` |
| A snapshot exported by the Import Preview plugin | `figma-snapshot.json` |

DTCG files map to Figma like this: the **folder** is the collection, the **file
name** is the mode (`Theme/Dark.tokens.json` → collection *Theme*, mode *Dark*).
Single files can also keep modes inline in `$extensions.mode`. Typography and
shadow tokens become text and effect styles.

## Import Preview (Figma plugin)

Before you import tokens or a component spec into a Figma file, drop the files
on the plugin and it tells you what the import will do, ranked by what it can
break, with how many layers or instances each change touches:

- **Will break things**: a variable whose type changes (Figma deletes and
  recreates it, so every binding is lost); a variable or variant that was
  renamed (name-matching importers create a new one and leave the old one's
  layers and instances behind); deleting a mode, or deleting something still in use.
- **Worth a look**: value changes that will look different (aliases are resolved
  on both sides, so `#4f46e5` → `{palette/indigo/600}` with the same color is
  *not* flagged); changed property defaults; removed layers (instance overrides
  on them are lost); a renamed default mode.
- **Safe**: additions, and things the importer will leave alone.

It assumes your importer matches by name, like Figma's own variable import and
most sync plugins. Set "Things in Figma but not in the files" to match whether
your importer deletes leftovers.

Share the result with **Copy as Markdown** (for a PR or Slack) or **Download
report** (a standalone HTML page).

**Export this file as a snapshot** writes the file's variables, styles,
components and usage to JSON. Commit it and you can diff against it in CI
without a Figma Enterprise plan (the REST variables API needs Enterprise).

### Install (development)

```sh
npm install
npm run build
```

In Figma: **Plugins → Development → Import plugin from manifest…** and pick
`dist/import-preview/manifest.json`.

## Brand Inheritance (Figma plugin)

Figma's extended collections (a brand inherits from a core system and stores
only its overrides) need an Enterprise plan. On other plans, brands are usually
modes in one collection, and modes don't inherit: every new token and every
base change has to be copied into each brand by hand.

This plugin adds inheritance on top of ordinary modes:

- Pick a parent for each brand mode (brands can inherit from brands:
  *Acme Kids* → *Acme* → *Base*). Linking a mode marks values that already
  match the parent as **inherited** and the rest as **overrides**.
- **Sync brands** copies parent values into every inherited value, so a base
  change or a new token reaches every brand, grandchildren included, in one pass.
- Overrides are never written. A value someone edits by hand in Figma after a
  sync is noticed and becomes an override instead of being overwritten.
- Everything is previewed first: tick a pending change to keep it as an
  override, or tick an override to go back to inheriting.
- **Add brand** creates a mode that starts as a full copy of its parent.

The setup is stored on the collection and variables as shared plugin data,
so everyone editing the file sees the same parents and overrides. Aliases
inherit as aliases.

## Token Rebinder (Figma plugin)

Moving a product onto tokens usually means finding thousands of hardcoded
colors and sizes and binding each one by hand. The rebinder scans a
selection, a page or the whole file and groups raw values into rows like
*"#ffffff · fill · 31 layers → color/surface"*, which you approve and bind in
one go.

- **Scopes decide the token.** The same hex on a frame, a text layer and a
  stroke gets `color/surface`, `color/on-primary` and `color/border`, because
  each variable's Figma scopes say where it may be used.
- **Semantic over primitive.** Aliased tokens rank above the palette values
  they point to; variables hidden from publishing aren't suggested unless you
  ask for them.
- **Modes are respected.** A layer in dark mode is compared with each token's
  dark value. A light color painted on a dark-mode frame matches nothing, which
  is usually a bug worth seeing.
- **Near matches are opt-in.** Colors within a barely visible distance (OKLab
  ΔE ≤ 2) are offered but not ticked; numbers match exactly unless you allow
  ±1 or ±2px.
- A paint at 50% black matches a token like `color/scrim` (#00000080), and the
  paint's opacity becomes 100% so nothing changes visually.
- Gap and padding share spacing rows. Layers inside instances are skipped by
  default (binding there creates overrides). Values using a style are left alone.
- **Show** selects the layers in a row. One **Bind** is one undo step, and
  layers that changed since the scan are skipped, not overwritten.
- Library variables can be suggested too (More options).

## Drift report (GitHub Action)

On every PR, compares the tokens or specs in your repo with Figma and posts
one sticky comment (updated, never duplicated) plus a job summary: what's
different, ranked by what a sync would break, with how many layers use each
token.

```yaml
# .github/workflows/design-drift.yml
name: Design drift
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: gif-kinnelly/ds-toolkit@main
        with:
          source: tokens/                         # DTCG, Figma export, or a component spec
          figma-snapshot: design/figma-snapshot.json
          fail-on: breaking                       # or "review", or "never" (default)
```

**Any Figma plan:** in the Import Preview plugin, click *Export this file as a
snapshot* and commit the JSON. The snapshot includes usage counts, so the
report can say "37 layers bound to it". Re-export when the Figma file changes.

**Enterprise:** compare with the live file instead:

```yaml
      - uses: gif-kinnelly/ds-toolkit@main
        env:
          FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}  # needs file_variables:read
        with:
          source: tokens/
          figma-file-key: AbC123xyz
```

Outputs: `breaking`, `review`, `safe`, `changes`. Other inputs: `missing`
(keep/remove), `whole-file`, `collection`, `comment`, `title`. Fork PRs that
can't comment still get the job summary.

This repo's own CI runs the Action on `examples/`, so every run shows a sample
report.

## System Inventory (Figma plugin)

For products built before there was a system: scans screens and proposes the
token set they already imply.

- **Colors** that look the same (OKLab ΔE ≤ 2 by default) merge into the most
  used one, and are named by hue family and a 50–950 step from their lightness
  (`palette/indigo/700`, `palette/gray/200`). Pale tints join the family of a
  nearby strong color, so a badge's `#dcfce7` background sits with its
  `#15803d` text under *green*. Names are suggestions; rename freely.
- **Spacing** snaps to a 4px (or 8px) grid with Tailwind-style names
  (`space/4` = 16px, `space/0.5` = 2px). Values off the grid are listed, not
  tokenized: they're usually mistakes worth fixing in the designs.
- **Radii** and **font sizes** are named around the most used value (`md`),
  and `radius/full` for pills.
- **Text styles** come from the font/weight/size/line-height combinations
  actually used, with a role guess (heading, title, body, label, caption).

**Download tokens (DTCG)** gives one file for Figma's import or Import
Preview. **Create variables + text styles** makes an *Inventory* collection
with scopes set (spacing → gap, radius → corner radius…) and text styles bound
to the font-size variables, in one undo step. Then run **Token Rebinder** with
near colors and ±1px numbers to bind the screens to them, near-duplicates
included.

## Component Docs (Figma plugin)

Writes a doc frame next to each component, read from the component itself,
so it can't go stale: run it again after a change and the same frames update.

- Description, variant count and instances in the file.
- **Properties**: variant axes with every option (default marked), text,
  boolean and instance-swap properties with their defaults.
- **Tokens**: each variable the component uses and where, collected across
  all variants (so a token only the *danger* tone uses is listed), with
  repeated fields collapsed ("padding", not four sides).
- **Styles** in use, and a **Not tokenized** note listing raw values left in
  the component.

The same docs download as Markdown (this page or every page) for
`docs/components.md` in the repo.

## Slot Audit (Figma plugin)

Figma's slots carry their own rules (preferred components, min/max children,
"preferred only") and flag a broken rule on the slot itself. What's missing
is the view across a file. Slot Audit scans every instance and shows, per
component slot:

- every **broken limit** (too few, too many, non-preferred content), with
  **Show** to select those slots;
- slots with **no rules** at all;
- **what people actually put in it**: each component's share, and raw layers
  that aren't components;
- **Set preferred** from that usage (components used in ≥10% of slots, the
  threshold is adjustable), optionally "only these", keeping the slot's
  min/max. Library components are flagged for change in the library file.

## Agent Context (Figma plugin + CLI)

Writes the design system as context for coding agents: `design-system.md`
to include from `CLAUDE.md` or `AGENTS.md`, and `design-system.json` for
tools. Generated UI then uses your tokens and components instead of
plausible-looking hex values.

- **Rules derived from the data**, not boilerplate: which collections are
  semantic and which are lower tiers not to use directly (a collection whose
  tokens are mostly alias targets, like a Brand tier between palette and
  Theme, counts as a lower tier); which modes exist and that tokens, not
  per-mode values, must be referenced; text styles over loose font settings.
- **Tokens** with a "use for" column from Figma scopes, or inferred from
  names when there are none (`*-bg` → backgrounds, `text` → text color), and
  values per mode, resolved through aliases. Lower tiers are summarized.
- **Components** with variants, properties and the tokens they use.

From the repo, in CI:

```sh
npx ds-toolkit agent tokens/ figma-plugin/spec.json --title "Acme" --out design-system.md --json design-system.json
```

## CLI

```sh
npx ds-toolkit agent tokens/ --out design-system.md
npx ds-toolkit diff tokens/ --against figma-snapshot.json
npx ds-toolkit diff new-spec.json --against old-spec.json --format md --fail-on breaking
```

Paths can be files or folders. `--format text|md|html`, `--out <file>`,
`--missing keep|remove`, `--whole-file`, `--fail-on breaking|review`.

## Using the core in your own importer

```ts
import { load } from 'ds-toolkit/src/adapters/load';
import { readFigmaFile } from 'ds-toolkit/src/figma/read-file';
import { diff } from 'ds-toolkit/src/core/diff';

const result = diff(load(files), await readFigmaFile({ scope: 'file' }));
if (result.counts.breaking) { /* show it before applying */ }
```

## Development

```sh
npm run check   # typecheck, unit tests, build
npm run e2e     # runs the built plugin in Chrome against a mock Figma file
```

`test/mock-figma.ts` is a strict, in-memory stand-in for the parts of the
Plugin API this kit uses: calling anything it doesn't model throws, so new API
use shows up in tests first.

## License

MIT
