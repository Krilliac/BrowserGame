/**
 * DEV-ONLY inspector overlay — a lightweight, read-only debug panel (pattern vendored from
 * hex-engine's inspector: generic reflective tree, localStorage persistence, freeze-view,
 * "→ window.tempN" console escape hatch — rebuilt here in plain DOM, no framework).
 *
 * The orchestrator (main.ts) dynamically imports this behind `import.meta.env.DEV`, binds F9 to
 * `toggle()`, and skips renderer updates while `frozen` is true. The panel refreshes at ~5Hz via
 * setInterval, and only while visible.
 *
 * Read-only by design: this module never writes into game state. Server inspection stays on the
 * admin channel — this is purely a client-side view of what the client already knows.
 *
 * The pure helpers (value formatting, prop filtering/capping, nearest-entity selection) are
 * exported and unit-tested; everything DOM-touching is guarded so importing under vitest/node
 * is safe.
 */

export interface InspectorEntity {
  kind: string;
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
}

export interface InspectorSnapshot {
  net: { connected: boolean; areaId: string; instanceId: string; players: number };
  you: Record<string, unknown>; // net.you (live ref ok; render-time read)
  entities: InspectorEntity[];
  renderer: Record<string, number>; // layer child counts etc.
  /** World position of the mouse, for the nearest-entity readout. */
  mouseWorld: { x: number; y: number };
}

export interface InspectorHandle {
  /** Toggle visibility (the orchestrator binds F9). */
  toggle(): void;
  /** True while 'freeze view' is checked — main.ts skips renderer updates. */
  readonly frozen: boolean;
}

// --- Pure helpers (unit-tested; no DOM) ------------------------------------------------

/** Cap on properties rendered per tree node (same cap hex-engine uses). */
export const MAX_PROPS_PER_NODE = 50;

/** Entities further than this (world px) from the mouse are not the "nearest" readout. */
export const NEAREST_RANGE = 120;

/** True for values the tree can expand into child rows (non-null objects and arrays). */
export function isExpandable(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** One-line display form of a leaf value. Numbers get 2dp (integers stay whole). */
export function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return 'ƒ()';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}

/**
 * The properties a tree node shows for an object: own enumerable entries, `_`-prefixed keys
 * skipped, capped at MAX_PROPS_PER_NODE. `hidden` is how many visible props the cap cut off.
 */
export function propEntries(value: object): { entries: [string, unknown][]; hidden: number } {
  const all = Object.entries(value).filter(([key]) => !key.startsWith('_'));
  const entries = all.slice(0, MAX_PROPS_PER_NODE);
  return { entries, hidden: all.length - entries.length };
}

/** The single entity nearest to `mouse`, or null if none lies within `range`. */
export function nearestEntity<T extends { x: number; y: number }>(
  entities: readonly T[],
  mouse: { x: number; y: number },
  range: number = NEAREST_RANGE,
): T | null {
  let best: T | null = null;
  let bestD2 = range * range;
  for (const e of entities) {
    const dx = e.x - mouse.x;
    const dy = e.y - mouse.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

/** Entity counts grouped by kind, sorted by kind name for a stable readout. */
export function countByKind(entities: readonly { kind: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// --- Console escape hatch (pattern taken verbatim from hex-engine's inspector) ---------

let nextTempVarNumber = 1;

/** Store a value as `window.tempN` and log it, so it can be poked at from the console. */
function sendToConsole(value: unknown): void {
  const varName = `temp${nextTempVarNumber}`;
  nextTempVarNumber++;
  (window as unknown as Record<string, unknown>)[varName] = value;
  console.log(`${varName} = `, value);
}

// --- localStorage persistence ('bg.inspector.*'; tolerant of private-mode failures) ----

const LS_OPEN = 'bg.inspector.open';
const LS_EXPANDED = 'bg.inspector.expanded';

function loadOpen(): boolean {
  try {
    return window.localStorage.getItem(LS_OPEN) === '1';
  } catch {
    return false;
  }
}

function saveOpen(open: boolean): void {
  try {
    window.localStorage.setItem(LS_OPEN, open ? '1' : '0');
  } catch {
    /* private mode — persistence is best-effort */
  }
}

function loadExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(LS_EXPANDED);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(LS_EXPANDED, JSON.stringify([...expanded]));
  } catch {
    /* best-effort */
  }
}

// --- DOM panel --------------------------------------------------------------------------

const REFRESH_MS = 200; // ~5Hz while visible; the interval is cleared when hidden

function el(tag: string, style: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ROW_STYLE = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
const SECTION_STYLE = 'margin-top:8px;color:#8fa3bf;text-transform:uppercase;font-size:10px;';

/**
 * Create the overlay and return its handle. Safe to call under node/vitest: without a DOM it
 * returns an inert handle so importing the module never explodes in tests.
 */
export function initInspector(snapshot: () => InspectorSnapshot): InspectorHandle {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { toggle() {}, frozen: false };
  }

  let open = loadOpen();
  let frozen = false;
  const expanded = loadExpanded();
  let timer: ReturnType<typeof setInterval> | null = null;

  const panel = el(
    'div',
    'position:fixed;top:0;right:0;width:340px;max-height:100vh;overflow-y:auto;box-sizing:border-box;' +
      'background:rgba(10,12,16,0.92);color:#cfd8e3;border-left:1px solid #2a3344;padding:8px 10px;' +
      "font:11px/1.6 ui-monospace,Menlo,Consolas,'Courier New',monospace;z-index:10000;",
  );

  // Static header (kept out of the 5Hz rebuild so the checkbox never loses its click).
  const header = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:4px;');
  header.appendChild(el('span', 'color:#e8eef7;font-weight:bold;', 'inspector'));
  const freezeLabel = el(
    'label',
    'margin-left:auto;display:flex;align-items:center;gap:4px;cursor:pointer;color:#9fb0c8;',
  );
  const freezeBox = document.createElement('input');
  freezeBox.type = 'checkbox';
  freezeBox.addEventListener('change', () => (frozen = freezeBox.checked));
  freezeLabel.appendChild(freezeBox);
  freezeLabel.appendChild(document.createTextNode('freeze view (render only)'));
  header.appendChild(freezeLabel);
  panel.appendChild(header);
  panel.appendChild(
    el('div', 'color:#5d6b80;font-size:10px;', 'F9 toggles · right-click a row → window.tempN'),
  );

  const body = el('div', '');
  panel.appendChild(body);
  document.body.appendChild(panel);

  function toggleExpanded(path: string): void {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    saveExpanded(expanded);
    render();
  }

  /** One tree row. Expandable values get a toggle arrow + the window.tempN context menu. */
  function renderNode(
    parent: HTMLElement,
    key: string,
    value: unknown,
    path: string,
    depth: number,
    forceExpand: boolean,
  ): void {
    const indent = `padding-left:${depth * 12}px;`;
    if (!isExpandable(value)) {
      parent.appendChild(el('div', ROW_STYLE + indent, `${key}: ${formatValue(value)}`));
      return;
    }

    const isOpen = forceExpand || expanded.has(path);
    const summary = Array.isArray(value) ? `Array(${value.length})` : '{…}';
    const row = el(
      'div',
      ROW_STYLE + indent + 'cursor:pointer;color:#a9c1e8;',
      `${isOpen ? '▾' : '▸'} ${key}: ${summary}`,
    );
    row.title = 'click to expand · right-click → window.tempN';
    if (!forceExpand) row.addEventListener('click', () => toggleExpanded(path));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendToConsole(value);
    });
    parent.appendChild(row);

    if (isOpen) {
      const { entries, hidden } = propEntries(value);
      for (const [childKey, childValue] of entries) {
        renderNode(parent, childKey, childValue, `${path}.${childKey}`, depth + 1, false);
      }
      if (hidden > 0) {
        parent.appendChild(
          el(
            'div',
            ROW_STYLE + `padding-left:${(depth + 1) * 12}px;color:#5d6b80;`,
            `… +${hidden} more`,
          ),
        );
      }
    }
  }

  function render(): void {
    const snap = snapshot();
    const scrollTop = panel.scrollTop; // rebuilds shouldn't yank the scroll position
    body.replaceChildren();

    // Connection line.
    const conn = snap.net.connected ? 'connected' : 'disconnected';
    body.appendChild(
      el(
        'div',
        ROW_STYLE + `color:${snap.net.connected ? '#7fd17f' : '#e07a7a'};`,
        `${conn} · ${snap.net.areaId}/${snap.net.instanceId} · ${snap.net.players} players`,
      ),
    );

    // You — collapsible reflective tree.
    body.appendChild(el('div', SECTION_STYLE, 'you'));
    renderNode(body, 'you', snap.you, 'you', 0, false);

    // Entities — counts by kind, then the nearest one to the mouse fully expanded.
    body.appendChild(el('div', SECTION_STYLE, `entities (${snap.entities.length})`));
    for (const [kind, count] of countByKind(snap.entities)) {
      body.appendChild(el('div', ROW_STYLE, `${kind} ×${count}`));
    }
    const near = nearestEntity(snap.entities, snap.mouseWorld);
    body.appendChild(el('div', SECTION_STYLE, 'nearest to mouse'));
    if (near) {
      renderNode(body, `${near.kind}#${near.id}`, near, 'nearest', 0, true);
    } else {
      body.appendChild(el('div', ROW_STYLE + 'color:#5d6b80;', `(none within ${NEAREST_RANGE}px)`));
    }

    // Renderer counters.
    body.appendChild(el('div', SECTION_STYLE, 'renderer'));
    for (const [key, count] of Object.entries(snap.renderer)) {
      body.appendChild(el('div', ROW_STYLE, `${key}: ${formatValue(count)}`));
    }

    panel.scrollTop = scrollTop;
  }

  function applyOpen(): void {
    panel.style.display = open ? 'block' : 'none';
    if (open && timer === null) {
      render();
      timer = setInterval(render, REFRESH_MS);
    } else if (!open && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
  applyOpen();

  return {
    toggle(): void {
      open = !open;
      saveOpen(open);
      applyOpen();
    },
    get frozen(): boolean {
      return frozen;
    },
  };
}
