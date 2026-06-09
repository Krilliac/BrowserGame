import type { InputState } from '../shared/protocol.js';

/** Keyboard input → InputState. Touch controls are a deliberate TODO for later. */
export class Input {
  private readonly down = new Set<string>();

  attach(): void {
    window.addEventListener('keydown', (e) => this.down.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.down.clear());
  }

  sample(): InputState {
    return {
      up: this.held('w', 'arrowup'),
      down: this.held('s', 'arrowdown'),
      left: this.held('a', 'arrowleft'),
      right: this.held('d', 'arrowright'),
    };
  }

  private held(...keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }
}
