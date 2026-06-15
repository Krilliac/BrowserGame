/* MerchantView — the vendor window: a stock grid of common gear (vendor rolls are
   always common), a gold balance, buy buttons, and an item tooltip on hover.
   Composes Panel + IconSlot + ItemTooltip + Button + Badge. */
const ShopNS = window.BrowserGameARPGDesignSystem_aa965c;
const { Panel: ShopPanel, IconSlot: ShopSlot, ItemTooltip: ShopTooltip, Button: ShopButton } = ShopNS;
const SICON = (n) => `../../assets/icons/${n}.png`;

function MerchantView({ stock, gold, onClose, onBuy }) {
  const [sel, setSel] = React.useState(0);
  const item = stock[sel];
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <ShopPanel title="Bartholomew" subtitle="Merchant · Aldermere" onClose={onClose} width={300}
        footer={<span><span style={{ color: 'var(--coin)' }}>◈ {gold}g</span> &nbsp;·&nbsp; Common stock refreshes on rest</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
          {stock.map((it, i) => (
            <ShopSlot
              key={i}
              src={SICON(it.icon)}
              rarity={it.rarity}
              size={56}
              selected={i === sel}
              onClick={() => setSel(i)}
            />
          ))}
        </div>
      </ShopPanel>

      {item && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <ShopTooltip {...item.tip} />
          <ShopButton variant="primary" size="sm" block
            disabled={gold < item.price}
            onClick={() => onBuy(item)}>
            Buy · {item.price}g
          </ShopButton>
        </div>
      )}
    </div>
  );
}

window.GloomMerchant = MerchantView;
