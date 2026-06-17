/**
 * The in-browser CANVAS MAP EDITOR — a self-contained, dependency-free HTML+JS dev tool served at
 * `GET /editor/map`. It is a 2D top-down view over the already-built, dev-gated server APIs: it loads
 * the world's area list from `/editor/world.json`, then loads one area's scene from
 * `/editor/scene/<areaId>.json` and paints every placeable (decor / spawns / npcs / portals / the
 * spawn point) as a draggable marker on a fitted, pannable, zoomable canvas. Dragging a marker
 * persists its new authored x,y via `POST /editor/place`; editing a selected marker's fields persists
 * via `POST /editor/edit`. The shell carries no secrets; every data call sends the ENGINE_ADMIN_TOKEN
 * the user pastes in (kept in localStorage under 'ed5_token', shared with the table editor at
 * `/editor`), so access is gated server-side exactly like the engine panel.
 *
 * Kept as a single inline string (no build step, works regardless of dev/prod serving). The embedded
 * script avoids backticks and ${} so it nests cleanly inside this TS template literal, and uses plain
 * ES5-ish functions (no optional chaining) to stay robust.
 *
 * NOTE: the "Play" toggle embeds the live game client in an <iframe src="/"> docked as a bottom
 * drawer beside the map, so a dev can run around in the live game without leaving the editor. A
 * fallback "open in new tab" link is kept for when an iframe is undesirable. True play/pause/stop of
 * a local sim wired to the edited area (vs. just embedding the shared live client) is a later slice.
 */
export const EDITOR_CANVAS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BrowserGame — Map Editor</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #14161c; color: #d7dbe3;
    display: flex; flex-direction: column; }
  header { display: flex; gap: 8px; align-items: center; padding: 10px 14px; background: #1b1e27;
    border-bottom: 1px solid #2a2e3a; flex: 0 0 auto; flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0 12px 0 0; color: #e7d9b0; }
  a.navlink { color: #9fb0c0; font-size: 12px; text-decoration: none; border: 1px solid #394052;
    border-radius: 5px; padding: 4px 8px; }
  a.navlink:hover { background: #232733; }
  input, select, button { font: inherit; background: #232733; color: #d7dbe3; border: 1px solid #394052;
    border-radius: 5px; padding: 5px 8px; }
  button { background: #2f3a4d; cursor: pointer; }
  button:hover { background: #3a475e; }
  #status { margin-left: auto; color: #9fb0c0; font-size: 12px; max-width: 40%; text-align: right; }
  .ok { color: #6fd58a; } .err { color: #e0707a; }
  main { flex: 1 1 auto; display: flex; min-height: 0; }
  #stage { position: relative; flex: 1 1 auto; min-width: 0; background: #0d0f14; }
  #cv { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  #cv.dragging { cursor: grabbing; }
  #cv.adding { cursor: crosshair; }
  #legend { position: absolute; left: 10px; top: 10px; background: #1b1e27cc; border: 1px solid #2a2e3a;
    border-radius: 8px; padding: 8px 10px; font-size: 12px; }
  #legend label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  #legend .sw { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
  aside { flex: 0 0 300px; background: #1b1e27; border-left: 1px solid #2a2e3a; padding: 12px 14px;
    overflow: auto; }
  aside h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #9fb0c0;
    margin: 0 0 10px; }
  aside .hint { color: #7d828c; font-size: 12px; }
  table.insp { border-collapse: collapse; width: 100%; font-size: 13px; }
  table.insp th, table.insp td { border: 1px solid #2a2e3a; padding: 3px 6px; text-align: left;
    vertical-align: top; }
  table.insp th { background: #232733; width: 38%; color: #9fb0c0; font-weight: 500; }
  table.insp td input { width: 100%; box-sizing: border-box; padding: 2px 4px; background: #232733;
    color: #d7dbe3; border: 1px solid #394052; border-radius: 4px; }
  .pkrow td { color: #e7d9b0; font-weight: 600; }
  /* Add-palette + debug panel additions */
  #palette { position: absolute; right: 10px; top: 10px; background: #1b1e27cc; border: 1px solid #2a2e3a;
    border-radius: 8px; padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 6px;
    max-width: 220px; }
  #palette .row { display: flex; align-items: center; gap: 6px; }
  #palette select { flex: 1 1 auto; min-width: 0; padding: 3px 5px; }
  #palette.addon { border-color: #6fd58a; }
  #palette .hint { color: #7d828c; }
  .modebtn { padding: 4px 10px; }
  .modebtn.active { background: #2f6f44; border-color: #6fd58a; color: #eafff0; }
  #delBtn { margin-top: 8px; width: 100%; background: #5a2f37; border-color: #7a3a44; }
  #delBtn:hover { background: #6f3a44; }
  details.dbg { margin-top: 16px; border-top: 1px solid #2a2e3a; padding-top: 10px; }
  details.dbg summary { cursor: pointer; font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
    color: #9fb0c0; }
  details.dbg .dbgbody { margin-top: 8px; }
  details.dbg table.insp { margin-bottom: 8px; }
  details.dbg .auditlist { font-size: 12px; margin: 6px 0 0; padding-left: 0; list-style: none; }
  details.dbg .auditlist li { padding: 2px 0; border-bottom: 1px solid #232733; }
  details.dbg .auditlist .sev-error { color: #e0707a; }
  details.dbg .auditlist .sev-warn { color: #e7d9b0; }
  /* Embedded play preview: a bottom drawer docked under the map, hidden until toggled. */
  #stage { display: flex; flex-direction: column; }
  /* Canvas + preview drawer stack vertically; the canvas flexes to fill the space the drawer leaves.
     width/height:auto overrides the base 100% so flex-basis governs the canvas box. */
  #stage > #cv { flex: 1 1 auto; min-height: 0; width: auto; height: auto; }
  #preview { flex: 0 0 40%; min-height: 0; display: none; flex-direction: column;
    border-top: 2px solid #2f6f44; background: #0d0f14; }
  #preview.on { display: flex; }
  #preview .pvbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #1b1e27;
    border-bottom: 1px solid #2a2e3a; flex: 0 0 auto; }
  #preview .pvbar .pvnote { color: #7d828c; font-size: 12px; flex: 1 1 auto; }
  #preview .pvbar a { color: #9fb0c0; font-size: 12px; }
  #preview iframe { flex: 1 1 auto; width: 100%; height: 100%; border: 0; min-height: 0; background: #0d0f14; }
  #play.active { background: #2f6f44; border-color: #6fd58a; color: #eafff0; }
</style>
</head>
<body>
<header>
  <h1>Map Editor</h1>
  <a class="navlink" href="/editor">&larr; Table editor</a>
  <input id="token" type="password" placeholder="ENGINE_ADMIN_TOKEN" size="24" />
  <button id="connect">Connect</button>
  <select id="areaSel"><option value="">— pick an area —</option></select>
  <button id="play" title="Toggle an embedded live-game preview">Play</button>
  <button id="auditBtn" title="Run a content integrity audit">Audit</button>
  <span id="status">Paste your dev token and Connect.</span>
</header>
<main>
  <div id="stage">
    <canvas id="cv"></canvas>
    <div id="legend">
      <label><input type="checkbox" id="lyr_decor" checked /><span class="sw" style="background:#8a909c"></span>decor</label>
      <label><input type="checkbox" id="lyr_spawns" checked /><span class="sw" style="background:#e0707a"></span>spawns</label>
      <label><input type="checkbox" id="lyr_npcs" checked /><span class="sw" style="background:#e7d9b0"></span>npcs</label>
      <label><input type="checkbox" id="lyr_portals" checked /><span class="sw" style="background:#5fd0e0"></span>portals</label>
      <label><input type="checkbox" id="lyr_spawn" checked /><span class="sw" style="background:#6fd58a"></span>spawn-point</label>
    </div>
    <div id="palette">
      <div class="row">
        <button id="modeSelect" class="modebtn active">Select</button>
        <button id="modeAdd" class="modebtn">Add</button>
      </div>
      <div id="paletteFields" style="display:none">
        <div class="row">
          <select id="addType">
            <option value="decor">Decor</option>
            <option value="creature_spawns">Creature spawn</option>
            <option value="npcs">NPC</option>
          </select>
        </div>
        <div class="row">
          <select id="addKind"></select>
        </div>
        <div class="hint">Click the map to place.</div>
      </div>
    </div>
    <div id="preview">
      <div class="pvbar">
        <span class="pvnote" id="pvnote"></span>
        <a id="pvNewTab" href="#">open in new tab &#8599;</a>
      </div>
      <!-- The live game client is served at the site root ("/") by Vite in dev / the node server in
           prod, so the iframe just points there. The iframe is created on first toggle (lazy) so the
           editor does not boot a game session until the dev actually wants one. -->
    </div>
  </div>
  <aside>
    <h2>Inspector</h2>
    <div id="inspector"><p class="hint">Click a marker to inspect &amp; edit it. Drag a marker to move it (saved on drop). Drag empty space to pan, wheel to zoom.</p></div>
    <details class="dbg" id="dbgPanel">
      <summary>Debug &amp; audit</summary>
      <div class="dbgbody">
        <div class="row" style="display:flex; gap:6px; margin-bottom:8px">
          <button id="dbgRefresh">Refresh</button>
        </div>
        <div id="dbgContent"><p class="hint">Refresh to load content counts. Use Audit (top bar) to scan for broken references.</p></div>
      </div>
    </details>
  </aside>
</main>
<script>
(function () {
  // ---- DOM handles -------------------------------------------------------
  var tokenEl = document.getElementById('token');
  var statusEl = document.getElementById('status');
  var areaSel = document.getElementById('areaSel');
  var inspectorEl = document.getElementById('inspector');
  var stage = document.getElementById('stage');
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var modeSelectBtn = document.getElementById('modeSelect');
  var modeAddBtn = document.getElementById('modeAdd');
  var paletteEl = document.getElementById('palette');
  var paletteFields = document.getElementById('paletteFields');
  var addTypeEl = document.getElementById('addType');
  var addKindEl = document.getElementById('addKind');
  var dbgContentEl = document.getElementById('dbgContent');
  var playBtn = document.getElementById('play');
  var previewEl = document.getElementById('preview');
  var pvNoteEl = document.getElementById('pvnote');
  var pvNewTabEl = document.getElementById('pvNewTab');
  tokenEl.value = localStorage.getItem('ed5_token') || '';

  // ---- state -------------------------------------------------------------
  var world = null;            // the loaded /editor/world.json (schema + tables.<name>.rows)
  var addMode = false;         // false = Select (click to inspect); true = Add (click to create)
  var scene = null;            // current AreaScene
  var markers = [];            // flattened placeables: {table,pk,kind,x,y,label,props, _layer}
  var selected = null;         // selected marker (reference into markers)
  // view transform: screen = (authored * scale + offset), where scale combines a base "fit" scale and zoom
  var view = { ox: 0, oy: 0, scale: 1, zoom: 1, fit: 1 };
  var dragging = null;         // { kind:'pan'|'marker', ... }
  var layerOn = { decor: true, spawns: true, npcs: true, portals: true, spawn: true };

  var LAYER_COLOR = {
    decor: '#8a909c', spawns: '#e0707a', npcs: '#e7d9b0',
    portals: '#5fd0e0', spawn: '#6fd58a'
  };

  // ---- helpers -----------------------------------------------------------
  function setStatus(msg, cls) { statusEl.textContent = msg; statusEl.className = cls || ''; }
  function tok() { return encodeURIComponent(tokenEl.value.trim()); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- networking --------------------------------------------------------
  function connect() {
    localStorage.setItem('ed5_token', tokenEl.value.trim());
    setStatus('Loading world…');
    fetch('/editor/world.json?token=' + tok())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (w) {
        world = w;
        populateAddKinds();
        var areas = (w.tables && w.tables.areas && w.tables.areas.rows) || [];
        var opts = '<option value="">— pick an area —</option>';
        for (var i = 0; i < areas.length; i++) {
          var a = areas[i];
          var name = a.name ? (a.id + ' — ' + a.name) : a.id;
          opts += '<option value="' + esc(a.id) + '">' + esc(name) + '</option>';
        }
        areaSel.innerHTML = opts;
        setStatus('Connected — ' + areas.length + ' areas. Pick one.', 'ok');
      })
      .catch(function (e) { setStatus('Connect failed: ' + e.message + ' (token / ENGINE_ADMIN_TOKEN set?)', 'err'); });
  }

  function loadScene(areaId) {
    scene = null; markers = []; selected = null; renderInspector();
    if (!areaId) { draw(); return; }
    setStatus('Loading scene…');
    fetch('/editor/scene/' + encodeURIComponent(areaId) + '.json?token=' + tok())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (s) {
        scene = s;
        flattenScene(s);
        fitView();
        setStatus('Loaded "' + (s.name || s.areaId) + '" (' + markers.length + ' markers).', 'ok');
        draw();
      })
      .catch(function (e) { setStatus('Scene load failed: ' + e.message, 'err'); draw(); });
  }

  // Build the flat marker list from the scene layers. The spawn point is synthesized as its own marker
  // so it shares the same draw/pick/drag code paths (it is not persisted via place/edit here).
  function flattenScene(s) {
    markers = [];
    var layers = s.layers || {};
    var names = ['decor', 'spawns', 'npcs', 'portals'];
    for (var n = 0; n < names.length; n++) {
      var lname = names[n];
      var arr = layers[lname] || [];
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        markers.push({
          table: p.table, pk: p.pk, kind: p.kind, x: p.x, y: p.y,
          label: p.label, props: p.props || {}, _layer: lname
        });
      }
    }
    if (s.spawn && typeof s.spawn.x === 'number') {
      markers.push({
        table: null, pk: null, kind: 'spawn-point', x: s.spawn.x, y: s.spawn.y,
        label: 'spawn', props: {}, _layer: 'spawn'
      });
    }
  }

  function postJson(url, body, onResult) {
    fetch(url + '?token=' + tok(), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        setStatus(res.message || (res.ok ? 'Done.' : 'Failed.'), res.ok ? 'ok' : 'err');
        if (res.ok && onResult) onResult(res);
      })
      .catch(function (e) { setStatus('Failed: ' + e.message, 'err'); });
  }

  // ---- add palette -------------------------------------------------------
  // A short fixed list of NPC kinds (the kinds the game's NPC system understands).
  var NPC_KINDS = ['vendor', 'questgiver', 'healer', 'gambler', 'banker', 'recruiter', 'riftkeeper', 'stable'];
  // A short fixed fallback list of decor kinds, used when the loaded world has no decor rows to derive from.
  var DECOR_KINDS = ['rock', 'tree', 'bush', 'crate', 'barrel', 'torch', 'shrine', 'chest', 'pot'];

  // Build the KIND <select> options for the current TYPE from the loaded world.
  function populateAddKinds() {
    var type = addTypeEl.value;
    var values = [];
    if (type === 'npcs') {
      values = NPC_KINDS.slice();
    } else if (type === 'creature_spawns') {
      // Spawn a creature by its mob_template id.
      var mobs = (world && world.tables && world.tables.mob_templates && world.tables.mob_templates.rows) || [];
      for (var i = 0; i < mobs.length; i++) { if (mobs[i] && mobs[i].id != null) values.push(String(mobs[i].id)); }
    } else {
      // Decor: derive distinct kinds from the loaded decor rows, falling back to the fixed list.
      var seen = {};
      var rows = (world && world.tables && world.tables.decor && world.tables.decor.rows) || [];
      for (var d = 0; d < rows.length; d++) {
        var k = rows[d] && rows[d].kind;
        if (k != null && k !== '' && !seen[k]) { seen[k] = true; values.push(String(k)); }
      }
      if (!values.length) values = DECOR_KINDS.slice();
      else values.sort();
    }
    var opts = '';
    if (!values.length) opts = '<option value="">(none available)</option>';
    for (var v = 0; v < values.length; v++) opts += '<option value="' + esc(values[v]) + '">' + esc(values[v]) + '</option>';
    addKindEl.innerHTML = opts;
  }

  function setMode(add) {
    addMode = !!add;
    if (addMode) {
      modeAddBtn.classList.add('active'); modeSelectBtn.classList.remove('active');
      paletteEl.classList.add('addon'); paletteFields.style.display = ''; cv.classList.add('adding');
    } else {
      modeSelectBtn.classList.add('active'); modeAddBtn.classList.remove('active');
      paletteEl.classList.remove('addon'); paletteFields.style.display = 'none'; cv.classList.remove('adding');
    }
  }

  // Create a new entity at authored coords via the fixed create contract, then reload the scene.
  function createEntity(ax, ay) {
    if (!scene) { setStatus('Pick an area before adding.', 'err'); return; }
    var kind = addKindEl.value;
    if (!kind) { setStatus('No kind selected to add.', 'err'); return; }
    var body = {
      table: addTypeEl.value, areaId: scene.areaId, kind: kind,
      x: Math.round(ax * 100) / 100, y: Math.round(ay * 100) / 100
    };
    postJson('/editor/create', body, function () { loadScene(scene.areaId); });
  }

  // ---- view transform ----------------------------------------------------
  function resizeCanvas() {
    // Match the backing store to the canvas's own displayed CSS box for crisp drawing. We measure the
    // canvas (not #stage) because #stage may also contain the play-preview drawer, which takes part of
    // the stage's height; the canvas flexes to fill whatever is left.
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w < 1) w = 1; if (h < 1) h = 1;
    cv.width = w; cv.height = h;
  }

  // Fit the whole area (0..width, 0..height) into the canvas, preserving aspect, centered.
  function fitView() {
    resizeCanvas();
    if (!scene) return;
    var pad = 24;
    var aw = scene.width || 1, ah = scene.height || 1;
    var sx = (cv.width - pad * 2) / aw;
    var sy = (cv.height - pad * 2) / ah;
    var fit = Math.min(sx, sy);
    if (!isFinite(fit) || fit <= 0) fit = 1;
    view.fit = fit;
    view.zoom = 1;
    view.scale = fit;
    // center
    view.ox = (cv.width - aw * view.scale) / 2;
    view.oy = (cv.height - ah * view.scale) / 2;
  }

  function authoredToScreen(x, y) {
    return { x: x * view.scale + view.ox, y: y * view.scale + view.oy };
  }
  function screenToAuthored(px, py) {
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  // ---- drawing -----------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!scene) {
      ctx.fillStyle = '#5b6270';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Connect, then pick an area to load its map.', 20, 30);
      return;
    }
    drawBounds();
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      if (!layerOn[m._layer]) continue;
      drawMarker(m, m === selected);
    }
  }

  function drawBounds() {
    var tl = authoredToScreen(0, 0);
    var br = authoredToScreen(scene.width, scene.height);
    ctx.fillStyle = '#171a22';
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.fillStyle = '#5b6270';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText((scene.name || scene.areaId) + '  ' + scene.width + ' x ' + scene.height +
      (scene.pvp ? '  [PvP]' : ''), tl.x + 6, tl.y - 6);
  }

  function drawMarker(m, isSel) {
    var color = LAYER_COLOR[m._layer] || '#cccccc';
    var s = authoredToScreen(m.x, m.y);
    if (m._layer === 'portals') {
      // Portals draw as a rectangle sized by authored props.rect_w / rect_h, centered on x,y.
      var rw = (m.props && Number(m.props.rect_w)) || 0;
      var rh = (m.props && Number(m.props.rect_h)) || 0;
      var halfW = (rw * view.scale) / 2, halfH = (rh * view.scale) / 2;
      if (halfW < 6) halfW = 6; if (halfH < 6) halfH = 6;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeRect(s.x - halfW, s.y - halfH, halfW * 2, halfH * 2);
      ctx.fillStyle = color + '22';
      ctx.fillRect(s.x - halfW, s.y - halfH, halfW * 2, halfH * 2);
    } else {
      var r = 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = isSel ? 3 : 1;
      ctx.strokeStyle = isSel ? '#ffffff' : '#0d0f14';
      ctx.stroke();
    }
    if (isSel || m.label) {
      ctx.fillStyle = isSel ? '#ffffff' : '#9fb0c0';
      ctx.font = '11px system-ui, sans-serif';
      var text = m.label != null ? String(m.label) : String(m.kind || '');
      ctx.fillText(text, s.x + 9, s.y - 8);
    }
  }

  // ---- hit testing -------------------------------------------------------
  // Pick the topmost (last drawn) visible marker near a screen point.
  function pickMarker(px, py) {
    for (var i = markers.length - 1; i >= 0; i--) {
      var m = markers[i];
      if (!layerOn[m._layer]) continue;
      var s = authoredToScreen(m.x, m.y);
      if (m._layer === 'portals') {
        var rw = (m.props && Number(m.props.rect_w)) || 0;
        var rh = (m.props && Number(m.props.rect_h)) || 0;
        var halfW = (rw * view.scale) / 2, halfH = (rh * view.scale) / 2;
        if (halfW < 8) halfW = 8; if (halfH < 8) halfH = 8;
        if (px >= s.x - halfW && px <= s.x + halfW && py >= s.y - halfH && py <= s.y + halfH) return m;
      } else {
        var dx = px - s.x, dy = py - s.y;
        if (dx * dx + dy * dy <= 100) return m; // 10px radius
      }
    }
    return null;
  }

  // ---- inspector ---------------------------------------------------------
  function renderInspector() {
    if (!selected) {
      inspectorEl.innerHTML = '<p class="hint">Click a marker to inspect &amp; edit it. Drag a marker to move it (saved on drop). Drag empty space to pan, wheel to zoom.</p>';
      return;
    }
    var m = selected;
    var html = '<table class="insp"><tbody>';
    html += row('table', esc(m.table), false);
    html += '<tr class="pkrow"><th>pk</th><td>' + esc(m.pk) + '</td></tr>';
    html += row('kind', esc(m.kind), false);
    // x / y are editable text fields; committing them saves via /editor/edit (and updates the marker).
    var editableCoords = m.table != null && m.pk != null;
    html += coordRow('x', m.x, editableCoords);
    html += coordRow('y', m.y, editableCoords);
    if (m.label != null) html += row('label', esc(m.label), false);
    var props = m.props || {};
    var keys = [];
    for (var k in props) { if (props.hasOwnProperty(k)) keys.push(k); }
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var editable = m.table != null && m.pk != null;
      html += propRow(key, props[key], editable);
    }
    html += '</tbody></table>';
    if (m.table == null) {
      html += '<p class="hint" style="margin-top:8px">This is the area spawn point — edit it via the areas table in the table editor.</p>';
    } else {
      html += '<p class="hint" style="margin-top:8px">Editing a field saves immediately via /editor/edit.</p>';
      html += '<button id="delBtn">Delete this ' + esc(m.kind || m.table) + '</button>';
    }
    inspectorEl.innerHTML = html;

    var inputs = inspectorEl.querySelectorAll('input[data-col]');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('change', onInspectorEdit);
    }
    var delBtn = document.getElementById('delBtn');
    if (delBtn) delBtn.addEventListener('click', onDeleteSelected);
  }

  // Delete the selected marker (table + pk) via the fixed delete contract, then reload the scene.
  function onDeleteSelected() {
    if (!selected || selected.table == null || selected.pk == null) return;
    var label = selected.kind || selected.table;
    if (!window.confirm('Delete this ' + label + ' (pk ' + selected.pk + ')? This cannot be undone.')) return;
    var areaId = scene ? scene.areaId : '';
    postJson('/editor/delete', { table: selected.table, id: selected.pk }, function () {
      selected = null;
      if (areaId) loadScene(areaId); else { renderInspector(); draw(); }
    });
  }

  function row(label, value, editable) {
    return '<tr><th>' + esc(label) + '</th><td>' + value + '</td></tr>';
  }
  function coordRow(col, value, editable) {
    if (!editable) return '<tr><th>' + esc(col) + '</th><td>' + esc(value) + '</td></tr>';
    return '<tr><th>' + esc(col) + '</th><td><input data-col="' + esc(col) + '" data-coord="1" value="' + esc(value) + '" /></td></tr>';
  }
  function propRow(key, value, editable) {
    if (!editable) return '<tr><th>' + esc(key) + '</th><td>' + esc(value) + '</td></tr>';
    return '<tr><th>' + esc(key) + '</th><td><input data-col="' + esc(key) + '" value="' + esc(value) + '" /></td></tr>';
  }

  function onInspectorEdit(ev) {
    if (!selected || selected.table == null || selected.pk == null) return;
    var input = ev.target;
    var col = input.getAttribute('data-col');
    var value = input.value;
    var body = { table: selected.table, id: selected.pk, column: col, value: value };
    postJson('/editor/edit', body, function () {
      // Reflect committed coordinate edits back into the marker and repaint.
      if (input.getAttribute('data-coord')) {
        var num = Number(value);
        if (isFinite(num)) { selected[col] = num; }
      } else if (selected.props) {
        selected.props[col] = value;
      }
      draw();
    });
  }

  function selectMarker(m) { selected = m; renderInspector(); draw(); }

  // ---- pointer interaction (pan / select / drag-marker) ------------------
  function pointerPos(ev) {
    var rect = cv.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  cv.addEventListener('pointerdown', function (ev) {
    if (!scene) return;
    var p = pointerPos(ev);
    // In Add mode a click on the canvas creates a new entity at the authored point (clamped to bounds).
    if (addMode) {
      var a = screenToAuthored(p.x, p.y);
      if (a.x < 0) a.x = 0; if (a.x > scene.width) a.x = scene.width;
      if (a.y < 0) a.y = 0; if (a.y > scene.height) a.y = scene.height;
      createEntity(a.x, a.y);
      return;
    }
    var hit = pickMarker(p.x, p.y);
    cv.setPointerCapture(ev.pointerId);
    if (hit) {
      selectMarker(hit);
      // Spawn point is movable on-screen but not persisted via place (no table/pk).
      dragging = { kind: 'marker', marker: hit, moved: false, startX: p.x, startY: p.y };
    } else {
      dragging = { kind: 'pan', startX: p.x, startY: p.y, ox: view.ox, oy: view.oy };
      cv.classList.add('dragging');
    }
  });

  cv.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    var p = pointerPos(ev);
    if (dragging.kind === 'pan') {
      view.ox = dragging.ox + (p.x - dragging.startX);
      view.oy = dragging.oy + (p.y - dragging.startY);
      draw();
    } else if (dragging.kind === 'marker') {
      var a = screenToAuthored(p.x, p.y);
      // clamp to area bounds
      if (a.x < 0) a.x = 0; if (a.x > scene.width) a.x = scene.width;
      if (a.y < 0) a.y = 0; if (a.y > scene.height) a.y = scene.height;
      dragging.marker.x = a.x;
      dragging.marker.y = a.y;
      dragging.moved = true;
      draw();
    }
  });

  function endDrag(ev) {
    if (!dragging) return;
    try { cv.releasePointerCapture(ev.pointerId); } catch (e) {}
    cv.classList.remove('dragging');
    if (dragging.kind === 'marker' && dragging.moved) {
      var m = dragging.marker;
      var nx = Math.round(m.x * 100) / 100;
      var ny = Math.round(m.y * 100) / 100;
      m.x = nx; m.y = ny;
      if (m.table != null && m.pk != null) {
        postJson('/editor/place', { table: m.table, id: m.pk, x: nx, y: ny }, function () {
          if (selected === m) renderInspector();
          draw();
        });
      } else {
        setStatus('Spawn point moved on screen only — edit it via the areas table to persist.', '');
        if (selected === m) renderInspector();
      }
    }
    dragging = null;
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  // Wheel zoom, anchored at the cursor so the point under the mouse stays put.
  cv.addEventListener('wheel', function (ev) {
    if (!scene) return;
    ev.preventDefault();
    var p = pointerPos(ev);
    var before = screenToAuthored(p.x, p.y);
    var factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.zoom *= factor;
    if (view.zoom < 0.1) view.zoom = 0.1;
    if (view.zoom > 12) view.zoom = 12;
    view.scale = view.fit * view.zoom;
    // re-anchor: keep "before" under the same screen point
    view.ox = p.x - before.x * view.scale;
    view.oy = p.y - before.y * view.scale;
    draw();
  }, { passive: false });

  // ---- layer toggles -----------------------------------------------------
  function wireLayer(id, key) {
    var el = document.getElementById(id);
    el.addEventListener('change', function () { layerOn[key] = el.checked; draw(); });
  }
  wireLayer('lyr_decor', 'decor');
  wireLayer('lyr_spawns', 'spawns');
  wireLayer('lyr_npcs', 'npcs');
  wireLayer('lyr_portals', 'portals');
  wireLayer('lyr_spawn', 'spawn');

  // ---- debug panel + audit -----------------------------------------------
  function refreshDebug() {
    setStatus('Loading debug info…');
    fetch('/editor/debug.json?token=' + tok())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { renderDebug(d); setStatus('Debug info loaded.', 'ok'); })
      .catch(function (e) { setStatus('Debug load failed: ' + e.message, 'err'); });
  }

  // Render the content-side debug snapshot as a compact table (counts + a few notable lists).
  function renderDebug(d) {
    function listShort(arr, max) {
      arr = arr || [];
      if (!arr.length) return '<span class="hint">none</span>';
      var shown = arr.slice(0, max).map(function (v) { return esc(v); }).join(', ');
      if (arr.length > max) shown += ' <span class="hint">(+' + (arr.length - max) + ' more)</span>';
      return shown;
    }
    var pvp = (d.pvpAreas || []).map(function (a) { return esc(a.areaId) + ':' + esc(a.rule); });
    var html = '<table class="insp"><tbody>';
    html += '<tr><th>areas</th><td>' + esc(d.areas) + '</td></tr>';
    html += '<tr><th>mob templates</th><td>' + esc(d.mobTemplates) + '</td></tr>';
    html += '<tr><th>items</th><td>' + esc(d.items) + '</td></tr>';
    html += '<tr><th>abilities</th><td>' + esc(d.abilities) + '</td></tr>';
    html += '<tr><th>quests</th><td>' + esc(d.quests) + '</td></tr>';
    html += '<tr><th>summonable</th><td>' + listShort(d.summonableCreatures, 8) + '</td></tr>';
    html += '<tr><th>tameable</th><td>' + listShort(d.tameableCreatures, 8) + '</td></tr>';
    html += '<tr><th>pvp areas</th><td>' + listShort(pvp, 8) + '</td></tr>';
    html += '</tbody></table>';
    dbgContentEl.innerHTML = html;
  }

  // Run the content audit; summarize counts in the status line and list the first few issues in the panel.
  function runAudit() {
    setStatus('Auditing content…');
    fetch('/editor/audit.json?token=' + tok())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (a) {
        var issues = (a && a.issues) || [];
        var errors = 0, warns = 0;
        for (var i = 0; i < issues.length; i++) {
          if (issues[i].severity === 'error') errors++; else warns++;
        }
        var msg = 'Audit: ' + errors + ' error' + (errors === 1 ? '' : 's') + ', ' +
          warns + ' warning' + (warns === 1 ? '' : 's') + '.';
        setStatus(msg, errors ? 'err' : 'ok');
        renderAudit(issues);
        // Open the debug panel so the issue list is visible.
        var panel = document.getElementById('dbgPanel');
        if (panel) panel.open = true;
      })
      .catch(function (e) { setStatus('Audit failed: ' + e.message, 'err'); });
  }

  // Append the first few audit issues to the debug panel (does not clear the counts table above it).
  function renderAudit(issues) {
    var base = dbgContentEl.innerHTML;
    var html = '<p class="hint" style="margin-top:8px">Audit issues (' + issues.length + ' total):</p>';
    if (!issues.length) {
      html += '<p class="hint">No issues — content is clean.</p>';
    } else {
      html += '<ul class="auditlist">';
      var max = issues.length < 8 ? issues.length : 8;
      for (var i = 0; i < max; i++) {
        var it = issues[i];
        html += '<li><span class="sev-' + (it.severity === 'error' ? 'error' : 'warn') + '">[' +
          esc(it.severity) + ']</span> ' + esc(it.kind) + ' — ' + esc(it.ref) + ': ' + esc(it.message) + '</li>';
      }
      if (issues.length > max) html += '<li class="hint">(+' + (issues.length - max) + ' more)</li>';
      html += '</ul>';
    }
    dbgContentEl.innerHTML = base + html;
  }

  // ---- header wiring -----------------------------------------------------
  document.getElementById('connect').addEventListener('click', connect);
  modeSelectBtn.addEventListener('click', function () { setMode(false); });
  modeAddBtn.addEventListener('click', function () { setMode(true); });
  addTypeEl.addEventListener('change', populateAddKinds);
  document.getElementById('auditBtn').addEventListener('click', runAudit);
  document.getElementById('dbgRefresh').addEventListener('click', refreshDebug);
  areaSel.addEventListener('change', function () { loadScene(areaSel.value); });
  // ---- embedded play preview --------------------------------------------
  // "Play" toggles a bottom drawer that embeds the live game client (served at "/") in an iframe, so a
  // dev can run around in the live game beside the map. The iframe is created lazily on first open so
  // no game session boots until wanted; on close we leave it in place (a closed drawer is just hidden).
  // FUTURE SLICE: true play/pause/stop of a LOCAL sim wired to the area being edited (vs. embedding the
  // shared live client) — including spinning the edited area into a throwaway instance — is not done
  // here. Today the iframe is the same live game everyone else plays; structural edits show up only on
  // newly created instances, so a reload is needed to see them.
  var previewBuilt = false;
  function ensurePreviewIframe() {
    if (previewBuilt) return;
    var note = 'Live game — edits you make in the map apply to newly created instances; ' +
      'reload the game to see structural changes.';
    pvNoteEl.textContent = note; // textContent, not innerHTML — no markup, safe by construction.
    var frame = document.createElement('iframe');
    frame.id = 'pvFrame';
    frame.setAttribute('src', '/');
    frame.setAttribute('title', 'Live game preview');
    // Allow the embedded client to be interactive (pointer/keyboard) and use audio/fullscreen.
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    previewEl.appendChild(frame);
    previewBuilt = true;
  }
  function togglePreview() {
    var on = !previewEl.classList.contains('on');
    if (on) {
      ensurePreviewIframe();
      previewEl.classList.add('on');
      playBtn.classList.add('active');
    } else {
      previewEl.classList.remove('on');
      playBtn.classList.remove('active');
    }
    // The map canvas shares vertical space with the drawer, so re-fit its backing store either way.
    resizeCanvas();
    if (scene) view.scale = view.fit * view.zoom;
    draw();
  }
  playBtn.addEventListener('click', togglePreview);
  // Fallback for when an embedded iframe is undesirable: open the live game in a new tab.
  pvNewTabEl.addEventListener('click', function (ev) { ev.preventDefault(); window.open('/', '_blank'); });

  window.addEventListener('resize', function () {
    if (scene) {
      // Preserve current zoom on resize; just re-fit the backing store and recenter base offset.
      resizeCanvas();
      view.scale = view.fit * view.zoom;
    } else {
      resizeCanvas();
    }
    draw();
  });

  // ---- boot --------------------------------------------------------------
  resizeCanvas();
  draw();
  if (tokenEl.value) connect();
})();
</script>
</body>
</html>`;
