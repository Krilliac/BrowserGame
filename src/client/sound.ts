import type { TimedFx } from './draw.js';

/**
 * Minimal sound manager: short SFX one-shots (cloned so they can overlap) plus a looping
 * per-area ambient bed. Browsers block audio until a user gesture, so call `unlock()` on the
 * first interaction. Only the license-clean assets we bundle are wired up here.
 */
const SFX: Record<string, string> = {
  arrow: '/assets/audio/shoot_arrow.ogg',
  cast: '/assets/audio/cast_fire.ogg',
};

export class Sound {
  private readonly buffers = new Map<string, HTMLAudioElement>();
  private ambient: HTMLAudioElement | undefined;
  private currentAmbient = '';
  private unlocked = false;
  private lastFxTime = 0;

  load(): void {
    for (const [key, src] of Object.entries(SFX)) {
      const a = new Audio(src);
      a.preload = 'auto';
      this.buffers.set(key, a);
    }
  }

  /** Enable playback (call from the first user gesture). */
  unlock(): void {
    this.unlocked = true;
    this.resumeAmbient();
  }

  /** Switch the ambient loop to match the current area (crypt = dungeon, else forest). */
  setArea(areaId: string): void {
    const src =
      areaId === 'crypt' ? '/assets/audio/ambient_dungeon.ogg' : '/assets/audio/ambient_forest.mp3';
    if (src === this.currentAmbient) return;
    this.currentAmbient = src;
    this.ambient?.pause();
    this.ambient = new Audio(src);
    this.ambient.loop = true;
    this.ambient.volume = 0.3;
    this.resumeAmbient();
  }

  /** Play SFX for any effects newer than the last processed tick. */
  fromFx(fx: TimedFx[]): void {
    let maxT = this.lastFxTime;
    for (const { ev, t0 } of fx) {
      if (t0 <= this.lastFxTime) continue;
      if (t0 > maxT) maxT = t0;
      if (ev.kind === 'cast') {
        if (ev.abilityId === 'arrow') this.play('arrow', 0.5);
        else if (ev.abilityId === 'fireball' || ev.abilityId === 'frost') this.play('cast', 0.4);
      }
    }
    this.lastFxTime = maxT;
  }

  private play(key: string, volume: number): void {
    if (!this.unlocked) return;
    const a = this.buffers.get(key);
    if (!a) return;
    const clone = a.cloneNode() as HTMLAudioElement;
    clone.volume = volume;
    void clone.play().catch(() => {});
  }

  private resumeAmbient(): void {
    if (this.unlocked && this.ambient) void this.ambient.play().catch(() => {});
  }
}
