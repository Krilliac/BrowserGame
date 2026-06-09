import { describe, expect, it } from 'vitest';
import { initGameDb, reloadContent, getDb } from './content.js';

describe('area theme loading (data-driven environment look)', () => {
  it('seeds and exposes per-area themes on the content packet', () => {
    const c = initGameDb(':memory:');
    const town = c.area('town');
    expect(town?.theme).toBeDefined();
    expect(town?.theme?.groundBase).toMatch(/^#[0-9a-f]+$/i);
    // Crypt shipped as an indoor, foggy area.
    expect(c.area('crypt')?.theme?.outdoor).toBe(false);
    expect(c.area('crypt')?.theme?.weather).toBe('fog');
  });

  it('reflects a DB theme edit after reloadContent (the live-edit path)', () => {
    initGameDb(':memory:');
    getDb()
      .prepare(`UPDATE area_theme SET ground_base = '#ff0000', weather = 'rain' WHERE area_id = ?`)
      .run('town');
    const c = reloadContent();
    expect(c.area('town')?.theme?.groundBase).toBe('#ff0000');
    expect(c.area('town')?.theme?.weather).toBe('rain');
  });
});
