/** Figma side of the slot audit. */
import type { SlotContent, SlotOccurrence, Violation } from './audit';

type Owner = ComponentNode | ComponentSetNode;
const ownerOf = (c: ComponentNode): Owner => (c.parent?.type === 'COMPONENT_SET' ? (c.parent as ComponentSetNode) : c);

/** This instance's own slots: don't look inside nested instances, whose slots are theirs. */
function slotsOf(instance: InstanceNode): SlotNode[] {
  const out: SlotNode[] = [];
  const walk = (n: SceneNode) => {
    if (n.type === 'SLOT') { out.push(n); return; }
    if (n.type === 'INSTANCE') return;
    if ('children' in n) for (const c of n.children) walk(c);
  };
  for (const c of instance.children) walk(c);
  return out;
}

async function content(n: SceneNode): Promise<SlotContent> {
  if (n.type !== 'INSTANCE') return { kind: 'raw', name: n.type };
  const mc = await n.getMainComponentAsync();
  if (!mc) return { kind: 'raw', name: 'INSTANCE (missing main component)' };
  const o = ownerOf(mc);
  return { kind: 'instance', name: o.name, key: o.key, keyType: o.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT' };
}

export async function collectSlots(roots: readonly SceneNode[], onProgress?: (n: number) => void): Promise<SlotOccurrence[]> {
  const instances: InstanceNode[] = [];
  const walk = (n: SceneNode) => {
    if (n.type === 'INSTANCE') instances.push(n);
    if ('children' in n) for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);

  const out: SlotOccurrence[] = [];
  let i = 0;
  for (const inst of instances) {
    if (++i % 200 === 0) onProgress?.(i);
    const main = await inst.getMainComponentAsync();
    if (!main) continue;
    const owner = ownerOf(main);
    const slotDefs = Object.entries(owner.componentPropertyDefinitions).filter(([, d]) => d.type === 'SLOT');
    if (!slotDefs.length) continue;
    for (const slot of slotsOf(inst)) {
      // Match the slot to its property: by reference when Figma gives one, else by name, else the only slot.
      const refs = Object.values(slot.componentPropertyReferences ?? {});
      const def = slotDefs.find(([k]) => refs.includes(k)) ?? slotDefs.find(([k]) => k.split('#')[0] === slot.name) ?? (slotDefs.length === 1 ? slotDefs[0] : undefined);
      if (!def) continue;
      const [key, d] = def;
      const s = d.slotSettings ?? {};
      out.push({
        component: owner.name, componentId: owner.id, local: !owner.remote,
        slot: key.split('#')[0], propertyKey: key, slotNodeId: slot.id, instanceName: inst.name,
        children: await Promise.all(slot.children.map(content)),
        violations: [...(slot.limitViolations ?? [])] as Violation[],
        settings: { min: s.minChildren, max: s.maxChildren, preferredOnly: s.allowPreferredValuesOnly, preferred: d.preferredValues?.length ?? 0, ...(d.description ? { description: d.description } : {}) },
      });
    }
  }
  return out;
}
