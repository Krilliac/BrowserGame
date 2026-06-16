**AbilitySlot** — a spell button on the action hotbar; gold-framed cell with hotkey and a radial cooldown sweep.

```jsx
<AbilitySlot src="assets/fx/spell_fireball.png" hotkey="1" />
<AbilitySlot src={icon} hotkey="2" cooldown={0.45} cooldownText="3" />
<AbilitySlot src={icon} hotkey="3" disabled />   // out of mana / locked
```

`cooldown` is the fraction (0–1) still remaining; pair with `cooldownText` for the seconds count. Lay six across the screen bottom-center at `size={52}`.
