/** Reads a component (set) in Figma into a DocModel. */
import type { DocModel, DocStyle, DocToken } from './model';
import { rgbaToHex } from '../core/values';

type AnyNode = SceneNode & Record<string, unknown> & { boundVariables?: Record<string, VariableAlias | VariableAlias[] | Record<string, VariableAlias>> };

const STYLE_KEYS: [string, DocStyle['kind']][] = [['textStyleId', 'text'], ['effectStyleId', 'effect'], ['fillStyleId', 'paint'], ['strokeStyleId', 'paint']];

export async function readComponent(node: ComponentSetNode | ComponentNode, opts: { instances?: boolean } = {}): Promise<DocModel> {
  const isSet = node.type === 'COMPONENT_SET';
  const defs = node.componentPropertyDefinitions;
  const axes = Object.entries(defs).filter(([, d]) => d.type === 'VARIANT').map(([k, d]) => ({ name: k, options: [...(d.variantOptions ?? [])], default: String(d.defaultValue) }));
  const properties = Object.entries(defs).filter(([, d]) => d.type !== 'VARIANT').map(([k, d]) => ({
    name: k.split('#')[0], type: d.type,
    default: d.type === 'INSTANCE_SWAP' ? undefined : String(d.defaultValue),
  }));

  const tokens = new Map<string, DocToken>();
  const styles = new Map<string, DocStyle>();
  const raw: DocModel['raw'] = [];
  const varCache = new Map<string, { name: string; collection?: string } | null>();
  const varInfo = async (id: string) => {
    if (!varCache.has(id)) {
      const v = await figma.variables.getVariableByIdAsync(id);
      const c = v ? await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId) : null;
      varCache.set(id, v ? { name: v.name, collection: c?.name } : null);
    }
    return varCache.get(id)!;
  };
  const use = async (id: string, layer: string, field: string) => {
    const info = await varInfo(id);
    if (!info) return;
    const t = tokens.get(info.name) ?? { variable: info.name, collection: info.collection, uses: [] };
    if (!t.uses.some((u) => u.layer === layer && u.field === field)) t.uses.push({ layer, field });
    tokens.set(info.name, t);
  };

  // Variants share structure; read every variant so tokens used by only one (e.g. a danger tone) are listed.
  const members = isSet ? (node.children as ComponentNode[]) : [node as ComponentNode];
  const walk = async (n: AnyNode, path: string) => {
    for (const [field, b] of Object.entries(n.boundVariables ?? {})) {
      if (field === 'fills' || field === 'strokes' || field === 'effects' || field === 'componentProperties') continue; // read from the paints below
      const list = Array.isArray(b) ? b : [b];
      for (const a of list) if (a && typeof a === 'object' && 'id' in a) await use((a as VariableAlias).id, path, field);
    }
    for (const key of ['fills', 'strokes'] as const) {
      const ps = n[key];
      if (!Array.isArray(ps)) continue;
      for (const p of ps as Paint[]) {
        if (p.type !== 'SOLID' || p.visible === false) continue;
        const bound = (p as SolidPaint).boundVariables?.color;
        if (bound) await use(bound.id, path, key === 'fills' ? 'fill' : 'stroke');
        else if (!n[key === 'fills' ? 'fillStyleId' : 'strokeStyleId']) raw.push({ layer: path, field: key === 'fills' ? 'fill' : 'stroke', value: rgbaToHex((p as SolidPaint).color) });
      }
    }
    for (const [k, kind] of STYLE_KEYS) {
      const id = n[k];
      if (typeof id !== 'string' || !id) continue;
      const st = await figma.getStyleByIdAsync(id);
      if (!st) continue;
      const s = styles.get(st.name) ?? { style: st.name, kind, layers: [] };
      s.layers.push(path || 'root');
      styles.set(st.name, s);
    }
    if ('children' in n) for (const c of (n as unknown as ChildrenMixin).children) await walk(c as AnyNode, path ? `${path}/${c.name}` : c.name);
  };
  for (const m of members) await walk(m as unknown as AnyNode, '');

  let instances: number | undefined;
  if (opts.instances) {
    instances = 0;
    for (const m of members) instances += (await m.getInstancesAsync()).length;
  }
  let page: BaseNode | null = node;
  while (page && page.type !== 'PAGE') page = page.parent;

  return {
    id: node.id, name: node.name, description: node.description ?? '',
    axes, properties, variants: members.length,
    tokens: [...tokens.values()].sort((a, b) => a.variable.localeCompare(b.variable)),
    styles: [...styles.values()],
    // De-duplicate raw values per layer+field across variants.
    raw: raw.filter((r, i) => raw.findIndex((x) => x.layer === r.layer && x.field === r.field) === i),
    ...(instances !== undefined ? { instances } : {}),
    ...(page ? { page: page.name } : {}),
  };
}
