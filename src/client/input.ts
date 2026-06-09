import type { InputState } from '../shared/protocol.js';

/** On-screen joystick state, exposed so the renderer can draw it. */
export interface Joystick {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  dx: number; // -1..1
  dy: number; // -1..1
}

const JOYSTICK_RADIUS = 60;
const DEAD_ZONE = 0.25;

/**
 * Player input from two sources merged into one `InputState`:
 *  - keyboard (WASD / arrows) for desktop, and
 *  - a drag-anywhere virtual joystick for touch (phones).
 *
 * Keyboard events are ignored while the player is typing in a text field, so chatting
 * never moves your character.
 */
export class Input {
  private readonly down = new Set<string>();
  readonly joystick: Joystick = {
    active: false,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    dx: 0,
    dy: 0,
  };
  private pointerId: number | null = null;
  /** Screen rect of the bottom HUD; pointerdowns here drive UI, not the joystick. */
  hudRect: { x: number; y: number; w: number; h: number } | null = null;

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (!isTyping(e.target)) this.down.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.clearKeys());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // desktop uses keyboard + click-to-cast
      if (this.inHud(e.clientX, e.clientY)) return; // let the HUD handle this tap
      this.pointerId = e.pointerId;
      this.joystick.active = true;
      this.joystick.baseX = e.clientX;
      this.joystick.baseY = e.clientY;
      this.updateJoystick(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.joystick.active && e.pointerId === this.pointerId) {
        this.updateJoystick(e.clientX, e.clientY);
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.joystick.active = false;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.pointerId = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** Forget held keys — call when focus moves to a text field. */
  clearKeys(): void {
    this.down.clear();
  }

  private inHud(x: number, y: number): boolean {
    const r = this.hudRect;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  sample(): InputState {
    const j = this.joystick;
    return {
      up: this.held('w', 'arrowup') || j.dy < -DEAD_ZONE,
      down: this.held('s', 'arrowdown') || j.dy > DEAD_ZONE,
      left: this.held('a', 'arrowleft') || j.dx < -DEAD_ZONE,
      right: this.held('d', 'arrowright') || j.dx > DEAD_ZONE,
    };
  }

  private updateJoystick(x: number, y: number): void {
    let dx = x - this.joystick.baseX;
    let dy = y - this.joystick.baseY;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    this.joystick.knobX = this.joystick.baseX + dx;
    this.joystick.knobY = this.joystick.baseY + dy;
    this.joystick.dx = dx / JOYSTICK_RADIUS;
    this.joystick.dy = dy / JOYSTICK_RADIUS;
  }

  private held(...keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
