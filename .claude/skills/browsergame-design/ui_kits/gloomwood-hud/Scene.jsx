/* Scene — the 2.5D world viewport behind the HUD. Procedural-shape entities
   (matching the game's current renderer), scattered pixel-art decor, an edge
   vignette + corruption pall (atmosphere.ts), a torch-lit player, and monsters
   wearing Nameplates. Pure presentation; the parent passes the biome + entities. */
const SceneNS = window.BrowserGameARPGDesignSystem_aa965c;
const { Nameplate: SceneNameplate, RarityName: SceneRarityName } = SceneNS;
const DECOR = (n) => `../../assets/decor/${n}.png`;

function EntityToken({ x, y, color, ring, size = 30, light = 0 }) {
  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}>
      {light > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '55%',
            width: light,
            height: light,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,174,92,0.22), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* shadow */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: `${size * 0.72}px`,
          width: size * 0.9,
          height: size * 0.34,
          transform: 'translate(-50%,-50%)',
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.45)',
          filter: 'blur(2px)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '46% 46% 48% 48% / 60% 60% 40% 40%',
          background: `radial-gradient(circle at 42% 30%, ${color}, #0c0d10 130%)`,
          border: `2px solid ${ring}`,
          boxShadow: `0 0 10px ${ring}66, inset 0 -4px 6px rgba(0,0,0,0.5)`,
        }}
      />
    </div>
  );
}

function Scene({ entities = [], decor = [], loot = [] }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background:
          'radial-gradient(140% 120% at 50% 18%, #28331f 0%, #1b241a 38%, #121a14 70%, #0c100b 100%)',
      }}
    >
      {/* ground speckle texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(rgba(60,80,45,0.5) 1px, transparent 1.4px), radial-gradient(rgba(20,28,16,0.6) 1px, transparent 1.4px)',
          backgroundSize: '22px 22px, 31px 31px',
          backgroundPosition: '0 0, 11px 14px',
          opacity: 0.5,
        }}
      />
      {/* a worn dirt path */}
      <div
        style={{
          position: 'absolute',
          left: '-10%',
          top: '46%',
          width: '120%',
          height: '22%',
          background: 'linear-gradient(180deg, transparent, rgba(54,42,28,0.45) 50%, transparent)',
          transform: 'rotate(-4deg)',
          filter: 'blur(3px)',
        }}
      />

      {/* decor sprites */}
      {decor.map((d, i) => (
        <img
          key={i}
          src={DECOR(d.img)}
          alt=""
          style={{
            position: 'absolute',
            left: `${d.x}%`,
            top: `${d.y}%`,
            transform: `translate(-50%,-100%) scale(${d.scale || 2})`,
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 3px 2px rgba(0,0,0,0.6)) brightness(0.92)',
            zIndex: Math.round(d.y),
          }}
        />
      ))}

      {/* loot drops with rarity beacon */}
      {loot.map((l, i) => (
        <div key={i} style={{ position: 'absolute', left: `${l.x}%`, top: `${l.y}%`, transform: 'translate(-50%,-50%)', textAlign: 'center', zIndex: 500 }}>
          <div
            style={{
              width: 30,
              height: 60,
              margin: '0 auto',
              background: `linear-gradient(180deg, var(--rarity-${l.rarity}), transparent)`,
              opacity: 0.5,
              filter: 'blur(3px)',
            }}
          />
          <div style={{ marginTop: -34, fontSize: 11 }}>
            <SceneRarityName rarity={l.rarity} size="sm">{l.name}</SceneRarityName>
          </div>
        </div>
      ))}

      {/* entities */}
      {entities.map((e, i) => (
        <div key={i} style={{ position: 'absolute', inset: 0, zIndex: Math.round(e.y) + 200, pointerEvents: 'none' }}>
          <EntityToken {...e} />
          {e.plate && (
            <div style={{ position: 'absolute', left: `${e.x}%`, top: `${e.y - 7}%`, transform: 'translate(-50%,-100%)' }}>
              <SceneNameplate {...e.plate} />
            </div>
          )}
        </div>
      ))}

      {/* portal at right edge */}
      <div style={{ position: 'absolute', right: '3%', top: '40%', textAlign: 'center', zIndex: 400 }}>
        <div
          style={{
            width: 54,
            height: 80,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(176,122,232,0.6), rgba(40,12,60,0.2) 70%)',
            border: '2px solid var(--fx-arcane)',
            boxShadow: '0 0 24px var(--fx-arcane)',
          }}
        />
        <div style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fx-arcane)' }}>
          Shadow Crypt ↓
        </div>
      </div>

      {/* vignette + corruption pall */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(120% 100% at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%), radial-gradient(80% 80% at 50% 60%, transparent 60%, rgba(58,8,16,0.25) 100%)',
        }}
      />
    </div>
  );
}

window.GloomScene = Scene;
