/**
 * Slot audit: across a file, what goes into each component's slots, where
 * Figma's own slot limits are broken, and which slots have no rules at all.
 * Pure: the plugin gathers occurrences, this summarizes them.
 */

export type Violation = 'BELOW_MIN' | 'ABOVE_MAX' | 'HAS_NON_PREFERRED';

export interface SlotContent {
  /** "instance" of a component, or a "raw" layer (frame, text…) placed directly. */
  kind: 'instance' | 'raw';
  /** Component (or component set) name for instances; layer type for raw. */
  name: string;
  /** Component or component set key, for preferred values. */
  key?: string;
  keyType?: 'COMPONENT' | 'COMPONENT_SET';
}

export interface SlotOccurrence {
  component: string;
  componentId: string;
  /** Whether the main component lives in this file (so its settings can be edited). */
  local: boolean;
  slot: string;
  /** Property key with its #id suffix, for editComponentProperty. */
  propertyKey: string;
  slotNodeId: string;
  instanceName: string;
  children: SlotContent[];
  violations: Violation[];
  settings: { min?: number | null; max?: number | null; preferredOnly?: boolean; preferred: number; description?: string };
}

export interface SlotSummary {
  component: string;
  componentId: string;
  local: boolean;
  slot: string;
  propertyKey: string;
  uses: number;
  /** Rules configured on the slot property. */
  rules: string[];
  violations: Record<Violation, string[]>; // slotNodeIds
  /** What goes in, most used first: name -> count of slots it appears in. */
  content: { name: string; kind: SlotContent['kind']; key?: string; keyType?: SlotContent['keyType']; slots: number }[];
  empty: number;
  /** Instances used in at least `share` of uses: candidates for preferred values. */
  suggestedPreferred: { name: string; key: string; type: 'COMPONENT' | 'COMPONENT_SET' }[];
}

export function describeRules(s: SlotOccurrence['settings']): string[] {
  const out: string[] = [];
  if (s.min != null && s.max != null) out.push(s.min === s.max ? `exactly ${s.min}` : `${s.min}–${s.max} items`);
  else if (s.min != null) out.push(`at least ${s.min}`);
  else if (s.max != null) out.push(`at most ${s.max}`);
  if (s.preferred) out.push(`${s.preferred} preferred${s.preferredOnly ? ' only' : ''}`);
  return out;
}

export function summarize(occ: SlotOccurrence[], opts: { share?: number } = {}): SlotSummary[] {
  const share = opts.share ?? 0.1;
  const groups = new Map<string, SlotOccurrence[]>();
  for (const o of occ) {
    const k = `${o.componentId}|${o.propertyKey}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out: SlotSummary[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const violations: SlotSummary['violations'] = { BELOW_MIN: [], ABOVE_MAX: [], HAS_NON_PREFERRED: [] };
    const content = new Map<string, SlotSummary['content'][number]>();
    let empty = 0;
    for (const o of list) {
      for (const v of o.violations) violations[v].push(o.slotNodeId);
      if (!o.children.length) empty++;
      // Count each kind of content once per slot.
      for (const c of new Map(o.children.map((c) => [`${c.kind}|${c.key ?? c.name}`, c])).values()) {
        const k = `${c.kind}|${c.key ?? c.name}`;
        const e = content.get(k) ?? { name: c.name, kind: c.kind, key: c.key, keyType: c.keyType, slots: 0 };
        e.slots++;
        content.set(k, e);
      }
    }
    const sorted = [...content.values()].sort((a, b) => b.slots - a.slots || a.name.localeCompare(b.name));
    out.push({
      component: first.component, componentId: first.componentId, local: first.local, slot: first.slot, propertyKey: first.propertyKey,
      uses: list.length, rules: describeRules(first.settings), violations, content: sorted, empty,
      suggestedPreferred: sorted.filter((c) => c.kind === 'instance' && c.key && c.slots / list.length >= share)
        .map((c) => ({ name: c.name, key: c.key!, type: c.keyType ?? 'COMPONENT' })),
    });
  }
  const bad = (s: SlotSummary) => Object.values(s.violations).reduce((n, v) => n + v.length, 0);
  return out.sort((a, b) => bad(b) - bad(a) || (a.rules.length ? 1 : 0) - (b.rules.length ? 1 : 0) || b.uses - a.uses);
}
