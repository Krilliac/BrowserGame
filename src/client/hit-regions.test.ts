import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitRegions, type HitRegion } from './hit-regions.js';

function region(x: number, y: number, w: number, h: number, onClick: () => void): HitRegion {
  return { x, y, w, h, onClick };
}

describe('HitRegions', () => {
  let hits: HitRegions;

  beforeEach(() => {
    hits = new HitRegions();
  });

  it('fires a click on down + up inside the same rect', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));

    expect(hits.down(15, 15)).toBe(true);
    expect(hits.up(40, 25)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('topmost (last-added) region wins where regions overlap', () => {
    const under = vi.fn();
    const over = vi.fn();
    hits.begin();
    hits.add(region(0, 0, 100, 100, under)); // drawn first = underneath
    hits.add(region(20, 20, 30, 30, over)); // drawn last = on top

    hits.down(25, 25);
    hits.up(25, 25);
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();

    // Outside the top region, the underlying one takes the click.
    hits.down(80, 80);
    hits.up(80, 80);
    expect(under).toHaveBeenCalledTimes(1);
    expect(over).toHaveBeenCalledTimes(1);
  });

  it('down outside every region captures nothing', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));

    expect(hits.down(200, 200)).toBe(false);
    // No press in flight, so the up is not consumed either.
    expect(hits.up(15, 15)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('drag-out cancels the click but still consumes the up', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));

    expect(hits.down(15, 15)).toBe(true);
    expect(hits.up(200, 200)).toBe(true); // consumed: the down was captured by the HUD
    expect(onClick).not.toHaveBeenCalled();

    // The press is single-shot: a second up is no longer in flight.
    expect(hits.up(15, 15)).toBe(false);
  });

  it('down on one button, up on another fires neither', () => {
    const left = vi.fn();
    const right = vi.fn();
    hits.begin();
    hits.add(region(0, 0, 40, 40, left));
    hits.add(region(60, 0, 40, 40, right));

    hits.down(20, 20);
    expect(hits.up(80, 20)).toBe(true); // consumed, but no click on either
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('cancel() clears an in-flight press', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));

    hits.down(15, 15);
    hits.cancel();
    expect(hits.up(15, 15)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('completes a click across frames, firing the freshly registered handler', () => {
    const frame1Click = vi.fn();
    const frame2Click = vi.fn();

    hits.begin();
    hits.add(region(10, 10, 50, 20, frame1Click));
    hits.down(15, 15);

    // HUD redraws between down and up: same rect, brand-new region object + closure.
    hits.begin();
    hits.add(region(10, 10, 50, 20, frame2Click));

    expect(hits.up(15, 15)).toBe(true);
    expect(frame2Click).toHaveBeenCalledTimes(1); // current frame's handler, not the stale one
    expect(frame1Click).not.toHaveBeenCalled();
  });

  it('falls back to the down-time handler when the rect is gone but the up is inside it', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));
    hits.down(15, 15);

    // Up arrives mid-frame: begin() ran but the panel has not re-registered yet.
    hits.begin();

    expect(hits.up(15, 15)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a moved rect (relayout) does not fire the stale handler on a missed up', () => {
    const oldClick = vi.fn();
    const newClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, oldClick));
    hits.down(15, 15);

    // The button moved away; the up lands where the button used to be, but nothing is there now.
    hits.begin();
    hits.add(region(200, 200, 50, 20, newClick));

    // Up is outside the remembered rect? No — (15,15) IS inside it, so the fallback fires the
    // handler captured at down time: the press began and ended on the same on-screen spot.
    expect(hits.up(15, 15)).toBe(true);
    expect(oldClick).toHaveBeenCalledTimes(1);
    expect(newClick).not.toHaveBeenCalled();

    // But an up over the button's NEW position never matches the remembered rect.
    hits.begin();
    hits.add(region(200, 200, 50, 20, newClick));
    expect(hits.down(15, 15)).toBe(false); // empty space now
    expect(hits.up(210, 210)).toBe(false);
    expect(newClick).not.toHaveBeenCalled();
  });

  it('containment is half-open: left/top edges hit, right/bottom edges miss', () => {
    const onClick = vi.fn();
    hits.begin();
    hits.add(region(10, 10, 50, 20, onClick));

    expect(hits.down(10, 10)).toBe(true); // top-left corner is inside
    hits.cancel();
    expect(hits.down(60, 30)).toBe(false); // x+w, y+h is outside
  });
});
