# ds-toolkit

Free, open-source tools for people who maintain design systems in Figma. All of
them share one core: a format-neutral **snapshot** of variables, styles and
components, and a **diff** that says what a change will do and what it could
break.

| Tool | Status |
|---|---|
| [Import Preview](#import-preview-figma-plugin) (Figma plugin + CLI) | ✅ |
| Multi-brand inheritance without Enterprise | planned |
| Hardcoded value → token rebinder | planned |
| Drift report GitHub Action | planned |
| System inventory, docs from spec, slot rules, agent manifest | planned |

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

## CLI

```sh
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
