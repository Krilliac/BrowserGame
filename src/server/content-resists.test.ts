import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';

/**
 * Elemental damage is content: abilities carry a damage school (seeded as 'physical', then the
 * elemental ones are promoted), and mob templates carry sparse per-element resistances. The World
 * reduces a typed hit by the defender's resistance at the damage site. These tests cover the data
 * wiring; the reduction math itself is unit-tested in combat-formulas.test.ts (resistedDamage).
 */
describe('content elemental schools', () => {
  it('tags elemental abilities and leaves others physical', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.ability('fireball')?.element).toBe('fire');
    expect(c.ability('emberbolt')?.element).toBe('fire');
    expect(c.ability('glacierspike')?.element).toBe('cold');
    expect(c.ability('slash')?.element).toBe('physical'); // untagged → the neutral default
  });

  it('the ability-element tagging preserves a designer DB edit', () => {
    const db = openDatabase(':memory:');
    db.prepare("UPDATE abilities SET element = 'lightning' WHERE id = 'fireball'").run();
    // Re-seeding would re-run ensureAbilityElements, but it only touches rows still 'physical'.
    expect(loadContent(db).ability('fireball')?.element).toBe('lightning');
  });
});

describe('content mob resistances', () => {
  it('exposes the seeded thematic resistances', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.mobResists('cinder_imp')).toEqual({ fire: 0.6, cold: -0.3 });
    expect(c.mobResists('frost_wolf')).toEqual({ cold: 0.5, fire: -0.3 });
  });

  it('returns an empty map for a mob with no resistances', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.mobResists('wolf')).toEqual({});
  });

  it('loads a resistance added only in the DB', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO mob_resists (template_id,element,value) VALUES (?,?,?)').run(
      'wolf',
      'poison',
      0.25,
    );
    expect(loadContent(db).mobResists('wolf')).toEqual({ poison: 0.25 });
  });
});
