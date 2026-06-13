/**
 * In-game settings panel — a small DOM overlay (a gear button + a drawer) for the player-tunable
 * CLIENT options in `settings.ts`. DOM rather than the Canvas2D HUD because native range/checkbox
 * controls are the right tool for a settings form and match the existing DOM chat/topbar.
 *
 * The panel only WRITES to the SettingsStore; consumers (audio/renderer/HUD in main.ts) subscribe
 * and apply. GM-only rows are hidden unless the server has granted GM+ access (`getAccess`), and
 * re-revealed live via `syncAccess()` when a `/login` raises the level. This is a UX gate, not a
 * security boundary — the client can't grant itself anything the server doesn't already allow.
 */
import { ACCESS_GM, ZOOM_BOUNDS, type Settings, type SettingsStore } from './settings.js';

export interface SettingsPanel {
  toggle(): void;
  isOpen(): boolean;
  /** Re-evaluate GM-row visibility against the current access level. */
  syncAccess(): void;
  /** Whether a DOM node lives inside the panel/button (so the game can ignore its input). */
  contains(node: Node | null): boolean;
}

const STYLE = `
#settings-btn {
  position: fixed; top: 10px; right: 12px; z-index: 30;
  width: 38px; height: 38px; padding: 0; line-height: 38px; font-size: 19px;
  background: rgba(8,9,13,0.82); color: #e7d9b0;
  border: 1px solid #c9a24b; border-radius: 8px; cursor: pointer;
  font-family: system-ui, sans-serif;
}
#settings-btn:hover { background: rgba(30,28,20,0.92); }
#settings-panel {
  position: fixed; top: 56px; right: 12px; z-index: 30; width: 280px; max-width: calc(100vw - 24px);
  max-height: calc(100vh - 72px); overflow-y: auto;
  background: rgba(8,9,13,0.95); border: 1px solid #c9a24b; border-radius: 10px;
  padding: 14px 16px; color: #cfd3da; font-family: system-ui, sans-serif; font-size: 13px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.5);
}
#settings-panel.hidden { display: none; }
#settings-panel h2 { margin: 0 0 10px; font-size: 15px; color: #e7d9b0; }
#settings-panel .sec { margin: 12px 0 4px; font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: #8a8f99; border-top: 1px solid rgba(201,162,75,0.25); padding-top: 10px; }
#settings-panel .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 9px 0; }
#settings-panel .row label { flex: 1; }
#settings-panel .row .val { color: #c9a24b; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
#settings-panel input[type=range] { width: 116px; accent-color: #c9a24b; }
#settings-panel input[type=checkbox] { width: 16px; height: 16px; accent-color: #c9a24b; }
#settings-panel .gm-only .sec { color: #f2c14e; }
#settings-panel .foot { display: flex; justify-content: space-between; margin-top: 14px; }
#settings-panel button.txt { background: none; border: 1px solid #565b64; color: #cfd3da;
  border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
#settings-panel button.txt:hover { border-color: #c9a24b; color: #e7d9b0; }
`;

export function createSettingsPanel(opts: {
  store: SettingsStore;
  getAccess: () => number;
}): SettingsPanel {
  const { store, getAccess } = opts;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'settings-btn';
  btn.type = 'button';
  btn.textContent = '⚙';
  btn.title = 'Settings';
  btn.setAttribute('aria-label', 'Settings');

  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.classList.add('hidden');

  // --- control builders -----------------------------------------------------------------
  function rangeRow(
    labelText: string,
    key: keyof Settings,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
  ): { row: HTMLDivElement; input: HTMLInputElement; valEl: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(store.get(key) as number);
    const valEl = document.createElement('span');
    valEl.className = 'val';
    valEl.textContent = fmt(store.get(key) as number);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      store.set(key, v as Settings[typeof key]);
      valEl.textContent = fmt(v);
    });
    row.append(label, input, valEl);
    return { row, input, valEl };
  }

  function checkRow(labelText: string, key: keyof Settings): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = store.get(key) as boolean;
    input.addEventListener('change', () => store.set(key, input.checked as Settings[typeof key]));
    row.append(label, input);
    return row;
  }

  // --- general section ------------------------------------------------------------------
  const title = document.createElement('h2');
  title.textContent = 'Settings';

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const volume = rangeRow('Volume', 'volume', 0, 1, 0.05, pct);
  const muted = checkRow('Mute', 'muted');
  const zoom = rangeRow(
    'Camera zoom',
    'zoom',
    ZOOM_BOUNDS.normal.min,
    ZOOM_BOUNDS.normal.max,
    0.05,
    pct,
  );
  const showFps = checkRow('Show FPS', 'showFps');
  const reduceEffects = checkRow('Reduce effects', 'reduceEffects');

  panel.append(title, volume.row, muted, zoom.row, showFps, reduceEffects);

  // --- GM-only section ------------------------------------------------------------------
  const gmWrap = document.createElement('div');
  gmWrap.className = 'gm-only';
  const gmHead = document.createElement('div');
  gmHead.className = 'sec';
  gmHead.textContent = 'GM tools';
  const debugOverlay = checkRow('Debug overlay', 'debugOverlay');
  const extendedZoom = checkRow('Extended zoom range', 'extendedZoom');
  gmWrap.append(gmHead, debugOverlay, extendedZoom);
  panel.append(gmWrap);

  // Toggling extended zoom rewidens the slider bounds and re-clamps the current value so the
  // slider, the stored setting, and the renderer all agree.
  (extendedZoom.querySelector('input') as HTMLInputElement).addEventListener('change', () => {
    const b = store.get('extendedZoom') ? ZOOM_BOUNDS.extended : ZOOM_BOUNDS.normal;
    zoom.input.min = String(b.min);
    zoom.input.max = String(b.max);
    const clamped = Math.max(b.min, Math.min(b.max, store.get('zoom')));
    store.set('zoom', clamped);
    zoom.input.value = String(clamped);
    zoom.valEl.textContent = pct(clamped);
  });

  // --- footer ---------------------------------------------------------------------------
  const foot = document.createElement('div');
  foot.className = 'foot';
  const reset = document.createElement('button');
  reset.className = 'txt';
  reset.type = 'button';
  reset.textContent = 'Reset';
  const close = document.createElement('button');
  close.className = 'txt';
  close.type = 'button';
  close.textContent = 'Close';
  foot.append(reset, close);
  panel.append(foot);

  document.body.append(btn, panel);

  // --- behavior -------------------------------------------------------------------------
  function applyZoomBounds(): void {
    const b = store.get('extendedZoom') ? ZOOM_BOUNDS.extended : ZOOM_BOUNDS.normal;
    zoom.input.min = String(b.min);
    zoom.input.max = String(b.max);
  }

  function syncAccess(): void {
    gmWrap.style.display = getAccess() >= ACCESS_GM ? '' : 'none';
  }

  function open(): void {
    // Refresh controls from the store in case keys (e.g. zoom via +/-) changed elsewhere.
    volume.input.value = String(store.get('volume'));
    volume.valEl.textContent = pct(store.get('volume'));
    applyZoomBounds();
    zoom.input.value = String(store.get('zoom'));
    zoom.valEl.textContent = pct(store.get('zoom'));
    syncAccess();
    panel.classList.remove('hidden');
  }
  function closePanel(): void {
    panel.classList.add('hidden');
  }
  function toggle(): void {
    if (panel.classList.contains('hidden')) open();
    else closePanel();
  }

  btn.addEventListener('click', toggle);
  close.addEventListener('click', closePanel);
  reset.addEventListener('click', () => {
    store.set('volume', 0.8);
    store.set('muted', false);
    store.set('zoom', 1.15);
    store.set('showFps', false);
    store.set('reduceEffects', false);
    store.set('debugOverlay', false);
    store.set('extendedZoom', false);
    closePanel();
    open(); // re-read every control from the defaults
  });

  // Swallow pointer events so clicks on the panel never fall through to the game's window-level
  // click handlers (which would otherwise hit a HUD region sitting beneath the drawer).
  for (const el of [btn, panel]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerup', (e) => e.stopPropagation());
  }

  applyZoomBounds();
  syncAccess();

  return {
    toggle,
    isOpen: () => !panel.classList.contains('hidden'),
    syncAccess,
    contains: (node) => panel.contains(node) || btn.contains(node),
  };
}
