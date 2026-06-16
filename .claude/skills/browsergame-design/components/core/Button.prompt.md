**Button** — the forged, gold-framed action control; use for menu/dialog/vendor actions, never for inline links.

```jsx
<Button variant="primary" size="md" onClick={open}>Enter the Crypt</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger" size="sm">Destroy Item</Button>
```

Variants: `primary` (gold gradient fill, dark text), `secondary` (dark fill, gold outline + gold text), `ghost` (text-only, muted), `danger` (blood-red). Sizes `sm | md | lg`. Pass `block` to fill width, `iconLeft` for a leading glyph. Labels render in engraved uppercase Cinzel automatically — pass plain text.
