/** HUD chrome — obsidian + gold nine-slice panels, bars, buttons (gw_* set). */
const C = require('./core');
const GOLD = '#c9a24b', GOLDHI = '#e7d9b0', GOLDDK = '#6b5226';

function panel(g, w, h, inset) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, inset ? '#070809' : '#15171e'); grd.addColorStop(1, inset ? '#0a0b10' : '#0c0d12');
  C.rr(g, 1, 1, w - 2, h - 2, inset ? 3 : 5); g.fillStyle = grd; g.fill();
  if (inset) {
    g.save(); C.rr(g, 1, 1, w - 2, h - 2, 3); g.clip(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(2, 5); g.lineTo(2, 2); g.lineTo(w - 2, 2); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(201,162,75,0.35)'; g.lineWidth = 1; C.rr(g, 1.5, 1.5, w - 3, h - 3, 3); g.stroke(); return;
  }
  g.strokeStyle = GOLDDK; g.lineWidth = 4; C.rr(g, 3, 3, w - 6, h - 6, 5); g.stroke();
  g.strokeStyle = GOLD; g.lineWidth = 2; C.rr(g, 3, 3, w - 6, h - 6, 5); g.stroke();
  g.strokeStyle = GOLDHI; g.lineWidth = 0.8; C.rr(g, 5, 5, w - 10, h - 10, 4); g.stroke();
  g.fillStyle = GOLD;
  for (const [cx, cy] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]]) { g.beginPath(); g.arc(cx, cy, 2.4, 0, 7); g.fill(); g.fillStyle = GOLDHI; g.beginPath(); g.arc(cx - 0.6, cy - 0.6, 0.9, 0, 7); g.fill(); g.fillStyle = GOLD; }
}
function barTrack(g, w, h) { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#05060a'); grd.addColorStop(0.5, '#16171d'); grd.addColorStop(1, '#1f2128'); g.fillStyle = grd; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1); g.strokeStyle = 'rgba(201,162,75,0.3)'; g.beginPath(); g.moveTo(0, h - 1); g.lineTo(w, h - 1); g.stroke(); }
function barFill(c1, c2, c3) { return (g, w, h) => { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, c2); grd.addColorStop(0.5, c1); grd.addColorStop(1, c3); g.fillStyle = grd; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 1, w, 2); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, h - 2, w, 2); }; }
function button(pressed) {
  return (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    if (pressed) { grd.addColorStop(0, '#0a0b10'); grd.addColorStop(1, '#15171e'); } else { grd.addColorStop(0, '#23262f'); grd.addColorStop(1, '#12141a'); }
    C.rr(g, 2, 2, w - 4, h - 4, 8); g.fillStyle = grd; g.fill();
    g.strokeStyle = GOLDDK; g.lineWidth = 3; C.rr(g, 2.5, 2.5, w - 5, h - 5, 8); g.stroke();
    g.strokeStyle = pressed ? GOLDDK : GOLD; g.lineWidth = 1.5; C.rr(g, 2.5, 2.5, w - 5, h - 5, 8); g.stroke();
    if (!pressed) { g.strokeStyle = 'rgba(231,217,176,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(10, 5); g.lineTo(w - 10, 5); g.stroke(); }
  };
}
function roundButton(g, w, h) { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#23262f'); grd.addColorStop(1, '#12141a'); g.fillStyle = grd; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 3, 0, 7); g.fill(); g.strokeStyle = GOLDDK; g.lineWidth = 3; g.stroke(); g.strokeStyle = GOLD; g.lineWidth = 1.5; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 3, 0, 7); g.stroke(); g.strokeStyle = 'rgba(231,217,176,0.5)'; g.lineWidth = 1; g.beginPath(); g.arc(w / 2, h / 2 - 1, w / 2 - 6, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }

function jobs() {
  const red = barFill('#d23b3b', '#f08a8a', '#6e1414'), blue = barFill('#3b6fd2', '#7fa3ec', '#14306a');
  return [
    { path: 'ui/gw_panel.png', w: 100, h: 100, ss: 3, draw: (g, w, h) => panel(g, w, h, false) },
    { path: 'ui/gw_panel_inset.png', w: 93, h: 94, ss: 3, draw: (g, w, h) => panel(g, w, h, true) },
    { path: 'ui/gw_bar_back_left.png', w: 9, h: 18, ss: 4, draw: barTrack },
    { path: 'ui/gw_bar_back_mid.png', w: 18, h: 18, ss: 4, draw: barTrack },
    { path: 'ui/gw_bar_back_right.png', w: 9, h: 18, ss: 4, draw: barTrack },
    { path: 'ui/gw_bar_red_left.png', w: 9, h: 18, ss: 4, draw: red },
    { path: 'ui/gw_bar_red_mid.png', w: 18, h: 18, ss: 4, draw: red },
    { path: 'ui/gw_bar_red_right.png', w: 9, h: 18, ss: 4, draw: red },
    { path: 'ui/gw_bar_blue_left.png', w: 9, h: 18, ss: 4, draw: blue },
    { path: 'ui/gw_bar_blue_mid.png', w: 18, h: 18, ss: 4, draw: blue },
    { path: 'ui/gw_bar_blue_right.png', w: 9, h: 18, ss: 4, draw: blue },
    { path: 'ui/gw_button.png', w: 190, h: 49, ss: 2, draw: button(false) },
    { path: 'ui/gw_button_pressed.png', w: 190, h: 45, ss: 2, draw: button(true) },
    { path: 'ui/gw_button_round.png', w: 35, h: 38, ss: 3, draw: roundButton },
  ];
}
module.exports = { jobs };
