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
 * NOTE: the "Play here" button just opens the live game in a new tab as a first step toward in-editor
 * play. True embedded play/pause (an iframe'd client wired to the edited area) is a later slice.
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
</style>
</head>
<body>
<header>
  <h1>Map Editor</h1>
  <a class="navlink" href="/editor">&larr; Table editor</a>
  <input id="token" type="password" placeholder="ENGINE_ADMIN_TOKEN" size="24" />
  <button id="connect">Connect</button>
  <select id="areaSel"><option value="">— pick an area —</option></select>
  <button id="play" title="Open the live game in a new tab">Play here</button>
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
  </div>
  <aside>
    <h2>Inspector</h2>
    <div id="inspector"><p class="hint">Click a marker to inspect &amp; edit it. Drag a marker to move it (saved on drop). Drag empty space to pan, wheel to zoom.</p></div>
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
  tokenEl.value = localStorage.getItem('ed5_token') || '';

  // ---- state -------------------------------------------------------------
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

  // ---- view transform ----------------------------------------------------
  function resizeCanvas() {
    // Match the backing store to the displayed CSS size for crisp drawing.
    var w = stage.clientWidth, h = stage.clientHeight;
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
    }
    inspectorEl.innerHTML = html;

    var inputs = inspectorEl.querySelectorAll('input[data-col]');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('change', onInspectorEdit);
    }
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

  // ---- header wiring -----------------------------------------------------
  document.getElementById('connect').addEventListener('click', connect);
  areaSel.addEventListener('change', function () { loadScene(areaSel.value); });
  // "Play here": opens the live game in a new tab. True embedded play/pause (an iframe'd client wired
  // to this area, with edit<->play toggle) is a later slice — this is the first step toward it.
  document.getElementById('play').addEventListener('click', function () { window.open('/', '_blank'); });

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
