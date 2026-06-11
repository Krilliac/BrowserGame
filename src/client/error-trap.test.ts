import { describe, expect, it } from 'vitest';
import { ErrorLog } from './error-trap.js';

describe('ErrorLog (pure ring buffer)', () => {
  it('records errors newest-last with the given clock', () => {
    const log = new ErrorLog();
    log.push('boom', 'a.js:1:1', 100);
    log.push('bang', 'b.js:2:2', 200);
    const recent = log.recent();
    expect(recent.map((e) => e.message)).toEqual(['boom', 'bang']);
    expect(recent[1]?.when).toBe(200);
    expect(log.latest()?.message).toBe('bang');
  });

  it('collapses identical consecutive errors and refreshes the timestamp', () => {
    const log = new ErrorLog();
    log.push('boom', 'a.js:1:1', 100);
    log.push('boom', 'a.js:1:1', 150);
    log.push('boom', 'a.js:1:1', 175);
    expect(log.recent()).toHaveLength(1);
    expect(log.latest()?.when).toBe(175); // bumped to "last seen"
  });

  it('does not collapse when the source differs', () => {
    const log = new ErrorLog();
    log.push('boom', 'a.js:1:1', 100);
    log.push('boom', 'b.js:9:9', 110);
    expect(log.recent()).toHaveLength(2);
  });

  it('treats a non-consecutive repeat as a new entry', () => {
    const log = new ErrorLog();
    log.push('boom', 's', 1);
    log.push('other', 's', 2);
    log.push('boom', 's', 3);
    expect(log.recent().map((e) => e.message)).toEqual(['boom', 'other', 'boom']);
  });

  it('stays bounded to the cap, dropping oldest first', () => {
    const log = new ErrorLog(3);
    for (let i = 0; i < 10; i++) log.push(`e${i}`, 's', i);
    const recent = log.recent();
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.message)).toEqual(['e7', 'e8', 'e9']);
  });

  it('treats a cap below 1 as 1', () => {
    const log = new ErrorLog(0);
    log.push('a', 's', 1);
    log.push('b', 's', 2);
    expect(log.recent()).toHaveLength(1);
    expect(log.latest()?.message).toBe('b');
  });

  it('retains an optional stack and updates it on a collapsed repeat', () => {
    const log = new ErrorLog();
    log.push('boom', 's', 1, 'stack-1');
    expect(log.latest()?.stack).toBe('stack-1');
    log.push('boom', 's', 2, 'stack-2');
    expect(log.recent()).toHaveLength(1);
    expect(log.latest()?.stack).toBe('stack-2');
  });

  it('clears all entries', () => {
    const log = new ErrorLog();
    log.push('a', 's', 1);
    log.clear();
    expect(log.recent()).toHaveLength(0);
    expect(log.latest()).toBeUndefined();
  });
});
