import { Rectangle, type Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';

export type Quality = 'high' | 'low';

/**
 * Optional post-process bloom for the bright FX/lighting layer. Quality-gated: 'low' removes the
 * filter entirely (phones get zero cost); 'high' adds a half-resolution AdvancedBloom so spells,
 * explosions, and lights glow. The renderer calls update() each frame with the current screen size.
 */
export class PostFx {
  private quality: Quality;
  private filter?: AdvancedBloomFilter;
  // One reusable rect for the layer's filterArea — we mutate width/height, never re-allocate.
  private readonly area = new Rectangle(0, 0, 0, 0);

  constructor(quality: Quality = 'high') {
    this.quality = quality;
  }

  setQuality(q: Quality): void {
    this.quality = q;
  }

  /**
   * Apply/refresh bloom on `layer` for the current screen size. At 'low' quality this ensures the
   * layer has no filters (cheap no-op when already cleared). At 'high' it lazily creates ONE
   * AdvancedBloomFilter (resolution 0.5), keeps the layer's `filterArea` set to the screen rect so
   * Pixi doesn't recompute full content bounds each frame, and assigns it to the layer.
   */
  update(layer: Container, sw: number, sh: number): void {
    if (this.quality === 'low') {
      // Cheap no-op once cleared: only touch `filters` when something is actually set.
      if (layer.filters && (layer.filters as readonly unknown[]).length > 0) layer.filters = [];
      return;
    }

    if (!this.filter) {
      // Tasteful glow, not a white-out: only fairly bright pixels bloom, mild scale/brightness.
      this.filter = new AdvancedBloomFilter({
        threshold: 0.5,
        bloomScale: 1.2,
        brightness: 1.0,
      });
      // Half-resolution bloom is the phone-perf guardrail: a quarter of the fill cost.
      this.filter.resolution = 0.5;
    }

    // Mutate the cached rect in place rather than allocating a Rectangle every frame.
    this.area.width = sw;
    this.area.height = sh;
    layer.filterArea = this.area;

    // Assign only when not already applied — re-assigning each frame is wasteful. In Pixi v8 the
    // getter returns null when unset, an array when many, or a single Filter — normalize defensively.
    const current = layer.filters as unknown;
    const applied = Array.isArray(current) ? current[0] : current;
    if (applied !== this.filter) layer.filters = this.filter;
  }
}
