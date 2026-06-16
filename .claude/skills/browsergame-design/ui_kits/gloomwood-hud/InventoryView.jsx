/* InventoryView — the character + bag window. An equipment doll (gold slots) on
   the left, the bag grid on the right, and a live ItemTooltip on hover. Composes
   Panel + IconSlot + ItemTooltip + Badge from the design system. */
const InvNS = window.BrowserGameARPGDesignSystem_aa965c;
const { Panel: InvPanel, IconSlot: InvSlot, ItemTooltip: InvTooltip, Badge: InvBadge } = InvNS;
const ICON = (n) => `../../assets/icons/${n}.png`;

const EQUIP_SLOTS = [
  { key: 'head', label: 'Head' },
  { key: 'chest', label: 'Chest' },
  { key: 'mainhand', label: 'Weapon' },
  { key: 'offhand', label: 'Off' },
  { key: 'ring', label: 'Ring' },
  { key: 'feet', label: 'Boots' },
];

function InventoryView({ bag, equipped, onClose }) {
  const [hover, setHover] = React.useState(null);

  return (
    <div style={{ position: 'relative' }}>
      <InvPanel title="Inventory" subtitle={`${bag.length} / 30 · Aldermere`} onClose={onClose} width={460}
        footer="Tap an item to equip · sell at the Merchant to clear space · Esc to close">
        <div style={{ display: 'flex', gap: 16 }}>
          {/* Equipment doll */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-label)', marginBottom: 8 }}>Equipped</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 56px)', gap: 8 }}>
              {EQUIP_SLOTS.map((s) => {
                const it = equipped[s.key];
                return (
                  <div key={s.key} style={{ textAlign: 'center' }}>
                    <InvSlot
                      src={it ? ICON(it.icon) : null}
                      rarity={it ? it.rarity : null}
                      empty={!it}
                      size={56}
                      onMouseEnter={() => it && setHover(it)}
                      onMouseLeave={() => setHover(null)}
                    />
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bag grid */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-label)', marginBottom: 8 }}>Bag</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {bag.map((it, i) => (
                <InvSlot
                  key={i}
                  src={ICON(it.icon)}
                  rarity={it.rarity}
                  count={it.count}
                  size={52}
                  onMouseEnter={() => setHover(it)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
              {Array.from({ length: Math.max(0, 15 - bag.length) }).map((_, i) => (
                <InvSlot key={`e${i}`} empty size={52} />
              ))}
            </div>
          </div>
        </div>
      </InvPanel>

      {/* Floating tooltip */}
      {hover && (
        <div style={{ position: 'absolute', top: 40, left: '100%', marginLeft: 12, zIndex: 70 }}>
          <InvTooltip {...hover.tip} />
        </div>
      )}
    </div>
  );
}

window.GloomInventory = InventoryView;
