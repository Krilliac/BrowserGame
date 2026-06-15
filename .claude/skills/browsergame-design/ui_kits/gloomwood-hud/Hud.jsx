/* Hud — the chrome overlay: topbar (area + pop), minimap, the player orbs, the
   potion belt + ability hotbar, the XP strip, and the chat log. Driven entirely
   by props from index.html so it stays a pure view. */
const HudNS = window.BrowserGameARPGDesignSystem_aa965c;
const { OrbGauge, AbilitySlot, IconSlot, ResourceBar, Badge } = HudNS;
const FX = (n) => `../../assets/fx/${n}.png`;

function Chip({ children, style = {} }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 11px',
        background: 'var(--surface-inset)',
        border: '1px solid var(--border-accent)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-body)',
        backdropFilter: 'blur(2px)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Hud({ player, abilities, onCast, belt, onDrink, chat, onOpenInventory, onOpenMerchant }) {
  return (
    <>
      {/* Topbar */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 8, zIndex: 10 }}>
        <Chip>
          <span style={{ fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-display)' }}>
            Gloomwood
          </span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--ok)' }}>● 4</span>
        </Chip>
        <Chip style={{ borderColor: 'var(--border-subtle)' }}>
          <span style={{ color: 'var(--coin)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>◈ {player.gold}</span>
        </Chip>
      </div>

      {/* Minimap */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
        <div
          style={{
            width: 132,
            height: 132,
            background: 'var(--surface-panel)',
            border: '2px solid var(--border-accent)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, #233019, #0d130b)', opacity: 0.9 }} />
          <div style={{ position: 'absolute', left: '50%', top: '52%', width: 7, height: 7, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'var(--essence)', boxShadow: '0 0 6px var(--essence)' }} />
          {[[34, 40], [66, 30], [70, 64], [44, 70]].map(([x, y], i) => (
            <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 4, height: 4, borderRadius: '50%', background: 'var(--danger)' }} />
          ))}
          <div style={{ position: 'absolute', right: 6, top: '40%', width: 6, height: 6, borderRadius: '50%', background: 'var(--fx-arcane)', boxShadow: '0 0 6px var(--fx-arcane)' }} />
          <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-500)' }}>
            Gloomwood
          </div>
        </div>
      </div>

      {/* Right-side menu buttons */}
      <div style={{ position: 'absolute', top: 154, right: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>
        <button onClick={onOpenInventory} style={menuBtn}>▣<span style={menuKey}>I</span></button>
        <button onClick={onOpenMerchant} style={menuBtn}>◈<span style={menuKey}>M</span></button>
      </div>

      {/* Orbs */}
      <div style={{ position: 'absolute', bottom: 18, left: 18, zIndex: 10 }}>
        <OrbGauge type="health" value={player.hp} max={player.maxHp} />
      </div>
      <div style={{ position: 'absolute', bottom: 18, right: 18, zIndex: 10 }}>
        <OrbGauge type="mana" value={player.mp} max={player.maxMp} />
      </div>

      {/* Action bar: belt + hotbar */}
      <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'flex-end', gap: 12, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <PotionSlot color="var(--hp)" highlight="var(--hp-glow)" count={belt.health} hotkey="Q" onClick={() => onDrink('health')} />
          <PotionSlot color="var(--mana)" highlight="var(--mana-glow)" count={belt.mana} hotkey="E" onClick={() => onDrink('mana')} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {abilities.map((a, i) => (
            <AbilitySlot
              key={i}
              src={FX(a.icon)}
              hotkey={a.key}
              cooldown={a.cd}
              cooldownText={a.cd > 0 ? a.cdText : null}
              disabled={a.disabled}
              onClick={() => onCast(i)}
            />
          ))}
        </div>
      </div>

      {/* XP strip */}
      <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', width: 'min(620px, 60vw)', zIndex: 9 }}>
        <ResourceBar kind="xp" value={player.xp} max={player.xpMax} height={6} />
      </div>

      {/* Chat */}
      <div style={{ position: 'absolute', bottom: 96, left: 14, width: 'min(330px, 40vw)', zIndex: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', lineHeight: 1.4 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ color: c.color || 'var(--text-body)' }}>
              {c.who && <span style={{ color: 'var(--gold-500)', fontWeight: 600 }}>{c.who}: </span>}
              {c.text}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const menuBtn = {
  width: 38,
  height: 38,
  position: 'relative',
  background: 'var(--surface-inset)',
  border: '1px solid var(--border-accent)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--gold-300)',
  fontSize: 16,
  cursor: 'pointer',
};
const menuKey = { position: 'absolute', bottom: 1, right: 3, fontSize: 8, color: 'var(--gold-600)', fontFamily: 'var(--font-body)', fontWeight: 700 };

function PotionSlot({ color, highlight, count, hotkey, onClick }) {
  return (
    <div onClick={onClick} style={{ position: 'relative', width: 44, height: 44, background: 'var(--surface-panel)', border: '1.5px solid var(--gold-500)', borderRadius: 'var(--radius-slot)', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: count > 0 ? 1 : 0.4 }}>
      <div style={{ width: 18, height: 24, borderRadius: '40% 40% 50% 50%', background: `radial-gradient(circle at 38% 30%, ${highlight}, ${color})`, border: '1px solid rgba(0,0,0,0.5)', boxShadow: `0 0 7px ${color}` }} />
      <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 9, fontWeight: 700, color: 'var(--gold-500)' }}>{hotkey}</span>
      <span style={{ position: 'absolute', bottom: 1, right: 4, fontSize: 11, fontWeight: 700, color: 'var(--gold-300)' }}>{count}</span>
    </div>
  );
}

window.GloomHud = Hud;
