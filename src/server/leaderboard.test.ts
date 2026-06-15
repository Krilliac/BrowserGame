import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import {
  recordScore,
  topScores,
  formatLadder,
  isLeaderboardMetric,
  LEADERBOARD_METRICS,
} from './leaderboard.js';

describe('leaderboard', () => {
  it('records a score and reads it back', () => {
    const db = openDatabase(':memory:');
    recordScore(db, 'Conan', 'level', 12, 1000);
    expect(topScores(db, 'level')).toEqual([{ name: 'Conan', value: 12 }]);
  });

  it('keeps the MAX ever seen — a lower (or equal) re-record never lowers a standing', () => {
    const db = openDatabase(':memory:');
    recordScore(db, 'Conan', 'level', 20, 1000);
    recordScore(db, 'Conan', 'level', 15, 2000); // lower → ignored
    recordScore(db, 'Conan', 'level', 20, 3000); // equal → ignored
    expect(topScores(db, 'level')).toEqual([{ name: 'Conan', value: 20 }]);
  });

  it('climbs to a new best when a higher value arrives', () => {
    const db = openDatabase(':memory:');
    recordScore(db, 'Conan', 'gold', 100, 1000);
    recordScore(db, 'Conan', 'gold', 500, 2000);
    expect(topScores(db, 'gold')).toEqual([{ name: 'Conan', value: 500 }]);
  });

  it('ranks highest first, breaking ties by who reached the value earliest', () => {
    const db = openDatabase(':memory:');
    recordScore(db, 'Belit', 'level', 30, 5000); // reached 30 later
    recordScore(db, 'Conan', 'level', 30, 1000); // reached 30 first → ranks above Belit
    recordScore(db, 'Subotai', 'level', 45, 9000);
    expect(topScores(db, 'level', 10)).toEqual([
      { name: 'Subotai', value: 45 },
      { name: 'Conan', value: 30 },
      { name: 'Belit', value: 30 },
    ]);
  });

  it('keeps metrics separate and respects the limit', () => {
    const db = openDatabase(':memory:');
    recordScore(db, 'A', 'level', 10, 1);
    recordScore(db, 'A', 'gold', 999, 1);
    recordScore(db, 'B', 'level', 20, 1);
    expect(topScores(db, 'level', 1)).toEqual([{ name: 'B', value: 20 }]);
    expect(topScores(db, 'gold')).toEqual([{ name: 'A', value: 999 }]);
  });

  it('formats an empty + populated ladder', () => {
    const db = openDatabase(':memory:');
    expect(formatLadder(db, 'level')).toBe('No level ladder entries yet.');
    recordScore(db, 'Conan', 'level', 12, 1);
    expect(formatLadder(db, 'level')).toBe('Top level:\n1. Conan — 12');
  });

  it('validates metric names', () => {
    expect(isLeaderboardMetric('level')).toBe(true);
    expect(isLeaderboardMetric('gold')).toBe(true);
    expect(isLeaderboardMetric('kills')).toBe(true);
    expect(isLeaderboardMetric('streak')).toBe(true);
    expect(isLeaderboardMetric('deaths')).toBe(false);
    expect(LEADERBOARD_METRICS).toEqual(['level', 'gold', 'kills', 'streak']);
  });
});
