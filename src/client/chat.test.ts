import { describe, expect, it } from 'vitest';
import { isPinnedToBottom } from './chat.js';

describe('isPinnedToBottom', () => {
  it('is true when scrolled to the exact bottom', () => {
    // scrollTop + clientHeight === scrollHeight
    expect(isPinnedToBottom(200, 300, 100)).toBe(true);
  });

  it('is true within the threshold of the bottom', () => {
    // 10px shy of the bottom, default threshold 24
    expect(isPinnedToBottom(190, 300, 100)).toBe(true);
  });

  it('is false when scrolled up beyond the threshold', () => {
    expect(isPinnedToBottom(100, 300, 100)).toBe(false);
  });

  it('is true for short logs that do not overflow', () => {
    // content shorter than the viewport: there is no "up" to scroll to
    expect(isPinnedToBottom(0, 80, 100)).toBe(true);
  });
});
