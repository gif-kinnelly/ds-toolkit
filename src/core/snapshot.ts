/**
 * A snapshot is a format-neutral picture of a design system: variables,
 * styles and components. Every adapter (DTCG files, Figma's variables export,
 * the Figma REST API, a live Figma file, a component spec) produces one, and
 * every tool in this kit works on snapshots, never on a source format.
 *
 * Names are Figma-style paths ("color/primary"). Matching is by name, the way
 * Figma's own import and most sync plugins match.
 */

/** The four classic types, plus newer ones Figma adds (e.g. EASING), whose values are kept as JSON strings. */
export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'EASING' | (string & {});

/** A literal value or a reference to another variable by name. */
export type Value =
  | { kind: 'color'; hex: string } // lowercase #rrggbb or #rrggbbaa
  | { kind: 'number'; n: number }
  | { kind: 'string'; s: string }
  | { kind: 'boolean'; b: boolean }
  | { kind: 'alias'; name: string };

export interface Variable {
  name: string;
  type: VariableType;
  /** One entry per mode of the collection, keyed by mode name. */
  values: Record<string, Value>;
  hidden?: boolean;
  description?: string;
  /** Live files only: how many layers or styles bind this variable. */
  usage?: number;
}

export interface Collection {
  name: string;
  /** First is the default mode. */
  modes: string[];
  variables: Variable[];
  /** Name of the collection this one extends (Figma extended collections, or this kit's brand inheritance). */
  extends?: string;
}

export interface Style {
  name: string;
  kind: 'text' | 'effect' | 'paint';
  /** Flat, comparable properties, e.g. { fontFamily: "Inter", fontSize: "var:font-size/sm" }. */
  props: Record<string, string | number>;
  usage?: number;
}

export interface ComponentProperty {
  type: 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP' | 'VARIANT' | 'SLOT';
  default?: string | boolean;
}

export interface Variant {
  /** Figma variant name, "size=md, tone=primary". */
  name: string;
  /** Layer paths inside the variant ("Text/Label"). Overrides on instances are keyed by these. */
  layers?: string[];
  /** Live files only: instances of this variant in the file. */
  instances?: number;
}

export interface Component {
  name: string;
  description?: string;
  properties: Record<string, ComponentProperty>;
  variants: Variant[];
}

export interface Snapshot {
  /** Where it came from, for reports ("tokens/*.json", "Figma: Acme DS"). */
  source: string;
  collections: Collection[];
  styles: Style[];
  components: Component[];
  /** True when this snapshot counted usage (a live Figma file). */
  hasUsage?: boolean;
  /** Things an adapter couldn't read, so a report can say what it skipped. */
  warnings?: string[];
}

export const emptySnapshot = (source: string): Snapshot => ({ source, collections: [], styles: [], components: [] });

/** "size=md, tone=primary" <-> { size: "md", tone: "primary" } */
export function variantProps(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of name.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export const variantName = (props: Record<string, string>) =>
  Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ');
