/**
 * The in-browser editor page (capstone of the editor epic) — a self-contained, dependency-free
 * HTML+JS dev tool served at `GET /editor`. It is a thin front-end over the already-built, dev-gated
 * server APIs: it loads the whole content model from `/editor/world.json`, edits any whitelisted
 * cell via `POST /editor/edit`, and exports/imports an area's map via the Tiled `.tmj` routes. The
 * shell carries no secrets; every data call sends the ENGINE_ADMIN_TOKEN the user pastes in (kept in
 * localStorage), so access is gated server-side exactly like the engine panel.
 *
 * Kept as a single inline string (no build step, works regardless of dev/prod serving). The embedded
 * script avoids backticks and ${} so it nests cleanly inside this TS template literal.
 */
export const EDITOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BrowserGame — World Editor</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #14161c; color: #d7dbe3; }
  header { display: flex; gap: 8px; align-items: center; padding: 10px 14px; background: #1b1e27;
    border-bottom: 1px solid #2a2e3a; position: sticky; top: 0; }
  header h1 { font-size: 15px; margin: 0 12px 0 0; color: #e7d9b0; }
  input, select, button { font: inherit; background: #232733; color: #d7dbe3; border: 1px solid #39405222;
    border: 1px solid #394052; border-radius: 5px; padding: 5px 8px; }
  button { background: #2f3a4d; cursor: pointer; }
  button:hover { background: #3a475e; }
  main { padding: 14px; display: grid; gap: 18px; grid-template-columns: 1fr; max-width: 1200px; }
  .panel { background: #1b1e27; border: 1px solid #2a2e3a; border-radius: 8px; padding: 12px 14px; }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #9fb0c0;
    margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #2a2e3a; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #232733; position: sticky; top: 52px; }
  td.pk { color: #e7d9b0; font-weight: 600; white-space: nowrap; }
  td input { width: 100%; box-sizing: border-box; padding: 2px 4px; }
  #grid { max-height: 70vh; overflow: auto; }
  #status { margin-left: auto; color: #9fb0c0; font-size: 12px; max-width: 50%; text-align: right; }
  .ok { color: #6fd58a; } .err { color: #e0707a; }
  .row2 { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
<header>
  <h1>World Editor</h1>
  <a href="/editor/map" style="color:#7fc4ff;text-decoration:none">Map editor →</a>
  <input id="token" type="password" placeholder="ENGINE_ADMIN_TOKEN" size="28" />
  <button id="connect">Connect</button>
  <span id="status">Paste your dev token and Connect.</span>
</header>
<main>
  <section class="panel">
    <h2>Content tables</h2>
    <div class="row2">
      <select id="tableSel"><option value="">— pick a table —</option></select>
      <span id="tableNote" style="color:#7d828c"></span>
    </div>
    <div id="grid" style="margin-top:10px"></div>
  </section>
  <section class="panel">
    <h2>Maps (Tiled .tmj — cross-engine)</h2>
    <div class="row2">
      <select id="areaSel"><option value="">— pick an area —</option></select>
      <button id="export">Download .tmj</button>
      <input id="file" type="file" accept=".tmj,.json" />
      <button id="import">Import .tmj</button>
    </div>
    <p style="color:#7d828c;margin:8px 0 0">Export an area, edit it in Tiled / Godot / Unity / GameMaker, then import it back.</p>
  </section>
</main>
<script>
(function () {
  var world = null;
  var tokenEl = document.getElementById('token');
  var statusEl = document.getElementById('status');
  var tableSel = document.getElementById('tableSel');
  var areaSel = document.getElementById('areaSel');
  var grid = document.getElementById('grid');
  var tableNote = document.getElementById('tableNote');
  tokenEl.value = localStorage.getItem('ed5_token') || '';

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = cls || '';
  }
  function tok() { return encodeURIComponent(tokenEl.value.trim()); }

  function connect() {
    localStorage.setItem('ed5_token', tokenEl.value.trim());
    setStatus('Loading world…');
    fetch('/editor/world.json?token=' + tok())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (w) {
        world = w;
        var names = w.schema.tables.map(function (t) { return t.name; }).sort();
        tableSel.innerHTML = '<option value="">— pick a table —</option>' +
          names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
        var areas = (w.tables.areas && w.tables.areas.rows) || [];
        areaSel.innerHTML = '<option value="">— pick an area —</option>' +
          areas.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.id) + '</option>'; }).join('');
        setStatus('Connected — ' + names.length + ' tables.', 'ok');
      })
      .catch(function (e) { setStatus('Connect failed: ' + e.message + ' (token / ENGINE_ADMIN_TOKEN set?)', 'err'); });
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderTable(name) {
    grid.innerHTML = '';
    if (!name || !world) return;
    var spec = world.schema.tables.find(function (t) { return t.name === name; });
    var data = world.tables[name];
    tableNote.textContent = spec && spec.note ? '— ' + spec.note : '';
    if (!data) { grid.textContent = '(no rows / not a physical table)'; return; }
    var editable = {};
    spec.columns.forEach(function (c) { editable[c.name] = true; });
    var html = '<table><thead><tr>';
    data.columns.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
    html += '<th>actions</th></tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var id = row[data.pk];
      html += '<tr>';
      data.columns.forEach(function (c) {
        if (c === data.pk) { html += '<td class="pk">' + esc(id) + '</td>'; return; }
        if (editable[c]) {
          html += '<td><input data-id="' + esc(id) + '" data-col="' + esc(c) + '" value="' + esc(row[c]) + '" /></td>';
        } else {
          html += '<td style="color:#7d828c">' + esc(row[c]) + '</td>';
        }
      });
      html += '<td style="white-space:nowrap"><button class="clone" data-id="' + esc(id) +
        '">Clone</button> <button class="del" data-id="' + esc(id) + '">Delete</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    grid.innerHTML = html;
    var inputs = grid.querySelectorAll('input[data-col]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('change', function (ev) { saveCell(name, ev.target); });
    }
    var clones = grid.querySelectorAll('button.clone');
    for (var j = 0; j < clones.length; j++) {
      clones[j].addEventListener('click', function (ev) { cloneRowUI(name, ev.target.getAttribute('data-id')); });
    }
    var dels = grid.querySelectorAll('button.del');
    for (var k = 0; k < dels.length; k++) {
      dels[k].addEventListener('click', function (ev) { deleteRowUI(name, ev.target.getAttribute('data-id')); });
    }
  }

  function postJson(url, body, onResult) {
    fetch(url + '?token=' + tok(), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        setStatus(res.message || (res.ok ? 'Done.' : 'Failed.'), res.ok ? 'ok' : 'err');
        if (res.ok && onResult) onResult(res);
      })
      .catch(function (e) { setStatus('Failed: ' + e.message, 'err'); });
  }

  function cloneRowUI(table, id) {
    var newId = prompt('New id for the clone of "' + id + '" (leave blank for auto-id tables):', id + '_copy');
    if (newId === null) return;
    postJson('/editor/clone', { table: table, id: id, newId: newId }, function () { connect(); });
  }

  function deleteRowUI(table, id) {
    if (!confirm('Delete ' + table + ' "' + id + '"? This cannot be undone.')) return;
    postJson('/editor/delete', { table: table, id: id }, function () { connect(); });
  }

  function saveCell(table, input) {
    var body = { table: table, id: input.getAttribute('data-id'), column: input.getAttribute('data-col'), value: input.value };
    fetch('/editor/edit?token=' + tok(), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) { setStatus(res.message || (res.ok ? 'Saved.' : 'Failed.'), res.ok ? 'ok' : 'err'); })
      .catch(function (e) { setStatus('Save failed: ' + e.message, 'err'); });
  }

  function exportMap() {
    if (!areaSel.value) { setStatus('Pick an area first.', 'err'); return; }
    window.open('/editor/area/' + encodeURIComponent(areaSel.value) + '.tmj?token=' + tok(), '_blank');
  }

  function importMap() {
    var f = document.getElementById('file').files[0];
    if (!areaSel.value || !f) { setStatus('Pick an area and a .tmj file.', 'err'); return; }
    setStatus('Importing…');
    f.text().then(function (text) {
      return fetch('/editor/area/' + encodeURIComponent(areaSel.value) + '.tmj?token=' + tok(), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: text,
      });
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        setStatus(res.message || (res.ok ? 'Imported.' : 'Import failed.'), res.ok ? 'ok' : 'err');
        if (res.ok) connect(); // refresh the loaded world
      })
      .catch(function (e) { setStatus('Import failed: ' + e.message, 'err'); });
  }

  document.getElementById('connect').addEventListener('click', connect);
  tableSel.addEventListener('change', function () { renderTable(tableSel.value); });
  document.getElementById('export').addEventListener('click', exportMap);
  document.getElementById('import').addEventListener('click', importMap);
  if (tokenEl.value) connect();
})();
</script>
</body>
</html>`;
