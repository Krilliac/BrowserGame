import type { TimedFx } from './draw.js';

/**
 * Sound manager: a looping per-area ambient bed (bundled audio files) plus **procedurally
 * synthesized** one-shot SFX via the Web Audio API — so combat/reward feedback needs no audio
 * assets to ship. Browsers block audio until a user gesture, so call `unlock()` on the first
 * interaction. Each FX event plays at most once (we only react to events newer than the last tick).
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
  private ctx: AudioContext | undefined;

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
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
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
      switch (ev.kind) {
        case 'cast':
          if (ev.abilityId === 'arrow') this.play('arrow', 0.5);
          else if (ev.abilityId === 'fireball' || ev.abilityId === 'frost') this.play('cast', 0.4);
          else this.blip(180, 120, 0.12, 'sawtooth', 0.08); // a generic whoosh (e.g. enemy shot)
          break;
        case 'hit':
          if (ev.value === 0)
            this.blip(140, 120, 0.05, 'triangle', 0.05); // a miss "tick"
          else if (ev.crit)
            this.chord([540, 760], 0.18, 'sawtooth', 0.16); // crits ring out
          else this.blip(210, 150, 0.07, 'square', 0.09);
          break;
        case 'death':
          this.blip(200, 55, 0.28, 'sawtooth', 0.16);
          break;
        case 'pickup':
          this.blip(620, 900, 0.1, 'triangle', 0.11);
          break;
        case 'coin':
          this.chord([900, 1280], 0.12, 'square', 0.1); // a little ka-ching
          break;
        case 'levelup':
          this.arpeggio([523, 659, 784, 1047], 0.11, 'triangle', 0.14); // C-E-G-C fanfare
          break;
        case 'slam':
          this.blip(95, 40, 0.32, 'sawtooth', 0.22); // a heavy boom
          break;
        default:
          break; // melee/telegraph are silent (visual-only)
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

  /** One synthesized tone with an exponential pitch glide + decay envelope. */
  private blip(
    freqStart: number,
    freqEnd: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  /** Several tones at once (a small chord/stab). */
  private chord(freqs: number[], dur: number, type: OscillatorType, gain: number): void {
    for (const f of freqs) this.blip(f, f, dur, type, gain / freqs.length + 0.04);
  }

  /** Tones in quick succession (a rising fanfare). */
  private arpeggio(freqs: number[], step: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked) return;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.4);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + step * 1.4);
    });
  }

  private resumeAmbient(): void {
    if (this.unlocked && this.ambient) void this.ambient.play().catch(() => {});
  }
}
