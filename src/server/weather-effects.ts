/**
 * Weather gameplay modifiers — authoritative, pure, deterministic.
 *
 * Weather is not just visual. Because the server owns the simulation, gameplay consequences
 * (slower movement through snow, reduced monster perception in fog/rain) must be computed
 * server-side from the same WeatherKind that drives the client's atmosphere. This module is
 * the single source of truth for those multipliers: `world.ts` reads them each tick, so a
 * player cannot manipulate their speed or avoid aggro by spoofing the renderer's weather state.
 *
 * Design intent (values below):
 *  - rain:  slightly slows perception (water noise, blurred vision) — minor aggro reduction.
 *  - snow:  heavy going underfoot — meaningful movement penalty, perception unaffected.
 *  - fog:   visually opaque — monsters notice you much later, movement unchanged.
 *  - ash:   falling ash chokes the air — minor movement penalty, reduced perception.
 *  - sand:  a sandstorm — slows movement and badly cuts visibility (the strongest aggro drop).
 *  - leaves: purely cosmetic autumn fall — identity, no gameplay effect.
 *  - lightning: a storm — flashes briefly light the field, otherwise rain-like perception drop.
 *  - none:  identity; all multipliers are 1.
 */

import type { WeatherKind } from '../shared/theme.js';

export interface WeatherModifiers {
  /** Multiplier on player movement speed (1 = normal). */
  moveScale: number;
  /** Multiplier on monster aggro range (1 = normal; <1 = harder to be noticed). */
  aggroScale: number;
}

/** Gameplay modifiers for an area's current weather. Pure + total over WeatherKind. */
export function weatherModifiers(weather: WeatherKind): WeatherModifiers {
  switch (weather) {
    case 'none':
      return { moveScale: 1, aggroScale: 1 };
    case 'rain':
      return { moveScale: 0.95, aggroScale: 0.85 };
    case 'snow':
      return { moveScale: 0.82, aggroScale: 1 };
    case 'fog':
      return { moveScale: 1, aggroScale: 0.55 };
    case 'ash':
      return { moveScale: 0.95, aggroScale: 0.8 };
    case 'sand':
      return { moveScale: 0.9, aggroScale: 0.5 };
    case 'leaves':
      return { moveScale: 1, aggroScale: 1 };
    case 'lightning':
      return { moveScale: 0.97, aggroScale: 0.85 };
  }
}
