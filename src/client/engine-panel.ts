/**
 * The Dev "Game Engine" panel — a live editor for everything the server lets a Developer change.
 * Three tabs:
 *   • Content — every editable DB table (areas, spells, items, monsters, npcs, quests, loot, vendor
 *     stock, sprite tints, themes…): pick a table, pick a row, edit any column with a widget typed
 *     by the server's column spec. Saves apply live (the server reloads + re-skins all clients).
 *   • Config  — the runtime-tunable gameplay knobs (difficulty, drops, economy, density, …). Edits
 *     mutate the live server config and take effect immediately.
 *   • Actions — privileged world tools: reload, spawn/clear bots, give items/gold/XP, set level,
 *     spawn monsters, set weather, teleport, heal, set an account's access.
 *
 * Everything is gated server-side on Developer access; this UI is just a front-end to that gated
 * protocol (it can't do anything the server wouldn't already let this connection do). The whole
 * panel is hidden unless the server has granted Developer access.
 */
import type { EngineColumnSpec, EngineConfigGroup, EngineSchema } from '../shared/protocol.js';
import type { EngineReply, Net } from './net.js';

const ACCESS_DEV = 4;

export interface EnginePanel {
  toggle(): void;
  isOpen(): boolean;
  contains(node: Node | null): boolean;
  /** Show/hide the launcher button against the current access level. */
  refreshAccess(): void;
}

const STYLE = `
#engine-btn {
  position: fixed; top: 10px; right: 58px; z-index: 30; height: 38px; padding: 0 12px;
  background: rgba(20,8,8,0.85); color: #f2c14e; border: 1px solid #b5532b; border-radius: 8px;
  cursor: pointer; font-family: system-ui, sans-serif; font-size: 13px; font-weight: 600;
}
#engine-btn:hover { background: rgba(40,16,12,0.95); }
#engine-panel { position: fixed; inset: 4vh 4vw; z-index: 40; display: flex; flex-direction: column;
  background: rgba(8,9,13,0.97); border: 1px solid #b5532b; border-radius: 12px; color: #cfd3da;
  font-family: system-ui, sans-serif; font-size: 13px; box-shadow: 0 12px 50px rgba(0,0,0,0.6); }
#engine-panel.hidden { display: none; }
#engine-panel .head { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid rgba(181,83,43,0.4); }
#engine-panel .head h2 { margin: 0; font-size: 16px; color: #f2c14e; flex: 0 0 auto; }
#engine-panel .tabs { display: flex; gap: 6px; flex: 1; }
#engine-panel .tab { background: none; border: 1px solid #565b64; color: #cfd3da; border-radius: 6px;
  padding: 5px 12px; cursor: pointer; font-size: 13px; }
#engine-panel .tab.active { border-color: #f2c14e; color: #f2c14e; background: rgba(242,193,78,0.08); }
#engine-panel .x { background: none; border: 1px solid #565b64; color: #cfd3da; border-radius: 6px;
  padding: 5px 10px; cursor: pointer; }
#engine-panel .body { flex: 1; overflow-y: auto; padding: 14px 16px; }
#engine-panel .pane { display: none; }
#engine-panel .pane.active { display: block; }
#engine-panel label { color: #aeb4be; }
#engine-panel select, #engine-panel input { background: #15171d; color: #e7e9ee; border: 1px solid #3a3f49;
  border-radius: 5px; padding: 5px 7px; font-size: 13px; font-family: inherit; }
#engine-panel input[type=range] { padding: 0; accent-color: #f2c14e; }
#engine-panel .field { display: grid; grid-template-columns: 200px 1fr 70px; gap: 10px; align-items: center;
  margin: 7px 0; }
#engine-panel .field .meta { color: #7d828c; font-size: 11px; }
#engine-panel .grp { margin: 6px 0 14px; }
#engine-panel .grp h3 { margin: 10px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
  color: #f2c14e; border-top: 1px solid rgba(181,83,43,0.25); padding-top: 10px; }
#engine-panel .picker { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
#engine-panel .act { display: grid; grid-template-columns: 150px 1fr auto; gap: 10px; align-items: center;
  margin: 8px 0; max-width: 620px; }
#engine-panel .act button, #engine-panel .picker button, #engine-panel .field button {
  background: #2a1c14; color: #f2c14e; border: 1px solid #b5532b; border-radius: 6px; padding: 6px 12px;
  cursor: pointer; font-size: 13px; }
#engine-panel .act button:hover { background: #3a2418; }
#engine-panel .status { padding: 8px 16px; border-top: 1px solid rgba(181,83,43,0.4); color: #9fe6a0;
  font-family: ui-monospace, Menlo, monospace; font-size: 12px; min-height: 18px; }
#engine-panel .status.err { color: #ff9a9a; }
#engine-panel .inline { display: flex; gap: 8px; }
#engine-panel .note { margin-top: 8px; }
`;

/** Tiny element builder. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
}

export function createEnginePanel(opts: { net: Net; getAccess: () => number }): EnginePanel {
  const { net, getAccess } = opts;
  document.head.appendChild(h('style', { textContent: STYLE }));

  const btn = h('button', { id: 'engine-btn', type: 'button', textContent: 'Engine' });
  const panel = h('div', { id: 'engine-panel', class: 'hidden' });
  btn.style.display = 'none';

  const status = h('div', { class: 'status' });
  function say(reply: EngineReply, fallback = 'done'): void {
    status.classList.toggle('err', !reply.ok);
    status.textContent = reply.message ?? (reply.ok ? fallback : 'failed');
  }

  // --- tabs ------------------------------------------------------------------------------
  const paneContent = h('div', { class: 'pane active' });
  const paneConfig = h('div', { class: 'pane' });
  const paneActions = h('div', { class: 'pane' });
  const tabDefs: { label: string; pane: HTMLDivElement }[] = [
    { label: 'Content', pane: paneContent },
    { label: 'Config', pane: paneConfig },
    { label: 'Actions', pane: paneActions },
  ];
  const tabs = h('div', { class: 'tabs' });
  const tabBtns: HTMLButtonElement[] = [];
  tabDefs.forEach((t, idx) => {
    const tb = h('button', {
      class: idx === 0 ? 'tab active' : 'tab',
      type: 'button',
      textContent: t.label,
    });
    tb.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabDefs.forEach((d) => d.pane.classList.remove('active'));
      tb.classList.add('active');
      t.pane.classList.add('active');
    });
    tabBtns.push(tb);
    tabs.append(tb);
  });

  const closeBtn = h('button', { class: 'x', type: 'button', textContent: 'Close' });
  panel.append(
    h('div', { class: 'head' }, h('h2', { textContent: 'Game Engine' }), tabs, closeBtn),
    h('div', { class: 'body' }, paneContent, paneConfig, paneActions),
    status,
  );
  document.body.append(btn, panel);

  // --- schema (fetched once) -------------------------------------------------------------
  let schema: EngineSchema | null = null;
  const rowsCache: Record<string, Record<string, string | number | null>[]> = {};

  async function ensureSchema(): Promise<void> {
    if (schema) return;
    const reply = await net.sendEngine({ kind: 'schema' });
    if (reply.ok && reply.data?.kind === 'schema') {
      schema = reply.data.schema;
      buildContent();
      buildConfig();
      buildActions();
    } else {
      say(reply, 'no schema');
    }
  }

  // --- helpers for typed inputs ----------------------------------------------------------
  function widget(
    spec: EngineColumnSpec,
    value: string | number | null,
  ): HTMLInputElement | HTMLSelectElement {
    if (spec.type === 'enum' || spec.type === 'bool') {
      const sel = h('select');
      const options = spec.type === 'bool' ? ['true', 'false'] : [...(spec.values ?? [])];
      if (spec.nullable) options.push('null');
      for (const o of options) sel.append(h('option', { value: o, textContent: o }));
      sel.value = value === null ? 'null' : String(value);
      return sel;
    }
    const input = h('input');
    if (spec.type === 'int' || spec.type === 'real') {
      input.type = 'number';
      if (spec.min !== undefined) input.min = String(spec.min);
      if (spec.max !== undefined) input.max = String(spec.max);
      input.step = spec.type === 'int' ? '1' : 'any';
    } else {
      input.type = 'text';
    }
    input.value = value === null ? '' : String(value);
    return input;
  }

  // --- Content tab (DB editor) -----------------------------------------------------------
  const tableSel = h('select');
  const rowSel = h('select');
  const fieldsBox = h('div');

  function buildContent(): void {
    if (!schema) return;
    tableSel.replaceChildren(h('option', { value: '', textContent: '— table —' }));
    for (const [name, spec] of Object.entries(schema.tables)) {
      tableSel.append(h('option', { value: name, textContent: `${name} (${spec.label})` }));
    }
    paneContent.replaceChildren(
      h(
        'div',
        { class: 'picker' },
        h('label', { textContent: 'Table' }),
        tableSel,
        h('label', { textContent: 'Row' }),
        rowSel,
      ),
      fieldsBox,
    );
    tableSel.addEventListener('change', () => void loadRows(tableSel.value));
    rowSel.addEventListener('change', () => showRow(tableSel.value, rowSel.value));
  }

  async function loadRows(table: string): Promise<void> {
    fieldsBox.replaceChildren();
    rowSel.replaceChildren(h('option', { value: '', textContent: '— row —' }));
    if (!table || !schema) return;
    const reply = await net.sendEngine({ kind: 'rows', table });
    if (!reply.ok || reply.data?.kind !== 'rows') return say(reply, 'no rows');
    const pk = schema.tables[table]!.pk;
    rowsCache[table] = reply.data.rows;
    for (const row of reply.data.rows) {
      const id = String(row[pk] ?? '');
      rowSel.append(h('option', { value: id, textContent: id }));
    }
    say({ ok: true, message: `${reply.data.rows.length} ${table} row(s) — pick one to edit` });
  }

  function showRow(table: string, id: string): void {
    fieldsBox.replaceChildren();
    if (!table || !id || !schema) return;
    const spec = schema.tables[table]!;
    const row = (rowsCache[table] ?? []).find((r) => String(r[spec.pk] ?? '') === id);
    if (!row) return;
    for (const [col, cspec] of Object.entries(spec.columns)) {
      const input = widget(cspec, row[col] ?? null);
      const apply = (): void => {
        let raw = 'value' in input ? input.value : '';
        if (raw.trim() === '' && cspec.nullable) raw = 'null';
        void net.sendEngine({ kind: 'edit', table, id, column: col, value: raw }).then((rep) => {
          say(rep);
          if (rep.ok) row[col] = raw === 'null' ? null : raw;
        });
      };
      input.addEventListener('change', apply);
      const meta = describe(cspec);
      fieldsBox.append(
        h(
          'div',
          { class: 'field' },
          h('label', { textContent: col }),
          input,
          h('span', { class: 'meta', textContent: meta }),
        ),
      );
    }
    if (spec.note)
      fieldsBox.append(h('div', { class: 'meta note', textContent: `note: ${spec.note}` }));
  }

  function describe(spec: EngineColumnSpec): string {
    if (spec.type === 'enum') return `enum${spec.nullable ? '?' : ''}`;
    if (spec.min !== undefined || spec.max !== undefined) {
      return `${spec.type}[${spec.min ?? ''}..${spec.max ?? ''}]${spec.nullable ? '?' : ''}`;
    }
    return `${spec.type}${spec.nullable ? '?' : ''}`;
  }

  // --- Config tab ------------------------------------------------------------------------
  function buildConfig(): void {
    if (!schema) return;
    paneConfig.replaceChildren();
    for (const group of schema.config) configGroup(group);
  }

  function configGroup(group: EngineConfigGroup): void {
    const box = h('div', { class: 'grp' }, h('h3', { textContent: group.label }));
    for (const f of group.fields) {
      const num = h('input', { type: 'number', value: String(f.value) });
      num.min = String(f.min);
      num.max = String(f.max);
      num.step = String(f.step);
      const rng = h('input', { type: 'range', value: String(f.value) });
      rng.min = String(f.min);
      rng.max = String(f.max);
      rng.step = String(f.step);
      const push = (v: string): void => {
        const value = Number(v);
        if (!Number.isFinite(value)) return;
        num.value = v;
        rng.value = v;
        void net.sendEngine({ kind: 'config', path: f.path, value }).then((rep) => say(rep));
      };
      num.addEventListener('change', () => push(num.value));
      rng.addEventListener('input', () => {
        num.value = rng.value;
      });
      rng.addEventListener('change', () => push(rng.value));
      box.append(h('div', { class: 'field' }, h('label', { textContent: f.label }), rng, num));
    }
    paneConfig.append(box);
  }

  // --- Actions tab -----------------------------------------------------------------------
  function buildActions(): void {
    if (!schema) return;
    paneActions.replaceChildren();
    const items = h('select');
    for (const it of schema.items)
      items.append(h('option', { value: it.id, textContent: `${it.name} (${it.id})` }));
    const templates = h('select');
    for (const t of schema.templates)
      templates.append(h('option', { value: t.id, textContent: `${t.name} (${t.id})` }));
    const areas = h('select');
    for (const a of schema.areas) areas.append(h('option', { value: a.id, textContent: a.name }));
    const weathers = h('select');
    for (const w of schema.weathers) weathers.append(h('option', { value: w, textContent: w }));
    const access = h('select');
    for (const a of schema.access)
      access.append(h('option', { value: String(a.value), textContent: `${a.value} ${a.name}` }));

    const num = (val: number, min = 0): HTMLInputElement => {
      const n = h('input', { type: 'number', value: String(val) });
      n.min = String(min);
      n.style.maxWidth = '110px';
      return n;
    };
    const text = (placeholder: string): HTMLInputElement =>
      h('input', { type: 'text', placeholder });

    const run = (op: Parameters<Net['sendEngine']>[0]): void => {
      void net.sendEngine(op).then((rep) => say(rep));
    };
    const act = (label: string, control: Node | null, onClick: () => void): HTMLDivElement => {
      const b = h('button', { type: 'button', textContent: label });
      b.addEventListener('click', onClick);
      return h(
        'div',
        { class: 'act' },
        h('label', { textContent: label }),
        control ?? h('span'),
        b,
      );
    };

    const botCount = num(50, 0);
    const giveQty = num(1, 1);
    const xpAmt = num(1000, 0);
    const lvl = num(20, 1);
    const mobCount = num(5, 1);
    const accUser = text('username');

    paneActions.append(
      act('Reload content', null, () => run({ kind: 'reload' })),
      act('Spawn bots', botCount, () =>
        run({ kind: 'spawn_bots', count: Number(botCount.value) || 0 }),
      ),
      act('Clear bots', null, () => run({ kind: 'clear_bots' })),
      act('Give item', wrap(items, giveQty), () =>
        run({ kind: 'give', itemId: items.value, qty: Number(giveQty.value) || 1 }),
      ),
      act('Grant XP', xpAmt, () => run({ kind: 'add_xp', amount: Number(xpAmt.value) || 0 })),
      act('Set level', lvl, () => run({ kind: 'set_level', level: Number(lvl.value) || 1 })),
      act('Spawn mob', wrap(templates, mobCount), () =>
        run({ kind: 'spawn_mob', templateId: templates.value, count: Number(mobCount.value) || 1 }),
      ),
      act('Set weather', weathers, () => run({ kind: 'weather', weather: weathers.value })),
      act('Teleport', areas, () => run({ kind: 'teleport', areaId: areas.value })),
      act('Heal me', null, () => run({ kind: 'heal' })),
      act('Set access', wrap(accUser, access), () =>
        run({
          kind: 'set_access',
          username: accUser.value.trim(),
          level: Number(access.value) || 0,
        }),
      ),
    );
  }

  function wrap(a: Node, b: Node): HTMLDivElement {
    return h('div', { class: 'inline' }, a, b);
  }

  // --- open/close/access -----------------------------------------------------------------
  function open(): void {
    if (getAccess() < ACCESS_DEV) return;
    panel.classList.remove('hidden');
    void ensureSchema();
  }
  function close(): void {
    panel.classList.add('hidden');
  }
  function toggle(): void {
    if (panel.classList.contains('hidden')) open();
    else close();
  }
  function refreshAccess(): void {
    const dev = getAccess() >= ACCESS_DEV;
    btn.style.display = dev ? '' : 'none';
    if (!dev) close();
  }

  btn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);
  for (const el of [btn, panel]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerup', (e) => e.stopPropagation());
  }
  refreshAccess();

  return {
    toggle,
    isOpen: () => !panel.classList.contains('hidden'),
    contains: (node) => panel.contains(node) || btn.contains(node),
    refreshAccess,
  };
}
