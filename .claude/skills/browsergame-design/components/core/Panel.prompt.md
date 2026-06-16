**Panel** — the gold-framed obsidian window every dialog, vendor and inventory screen sits in.

```jsx
<Panel title="Inventory" subtitle="12 / 30" onClose={close} width={420}
       footer="Tap an item to equip · Esc to close">
  …grid…
</Panel>
```

Title renders in engraved uppercase. Pass `onClose` to get the ✕. Use `footer` for the muted hint row. Compose other primitives (IconSlot, Button, ItemTooltip) inside its body.
