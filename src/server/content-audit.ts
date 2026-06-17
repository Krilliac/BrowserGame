import { getContent, getDb } from './content.js';
import { isDungeon as isCodeDungeon } from '../shared/areas.js';

/**
 * Runtime CONTENT AUDIT — a read-only sweep of the loaded game content for broken cross-references.
 *
 * The game is data-driven (areas/mobs/abilities/items/quests/loot live in SQLite), so a typo — a
 * spawn naming a missing mob template, a portal to nowhere, a quest rewarding a deleted item — does
 * not fail to load; it surfaces later as a silent no-op or a runtime crash. {@link auditContent}
 * turns that class of mistake into an immediate, structured list a designer can read while editing
 * live (e.g. via the in-browser content editor).
 *
 * This mirrors the cross-reference checks in `content-integrity.test.ts`, but as a pure runtime
 * function: it reads {@link getContent} accessors (and a few raw {@link getDb} tables for placements
 * the typed API does not expose by area), never writes, and returns its findings rather than
 * asserting. A clean seeded database returns zero `error` issues.
 */
export interface AuditIssue {
  /** `error` = a dangling reference that breaks gameplay; `warn` = suspect but non-fatal. */
  severity: 'error' | 'warn';
  /** A short machine-readable category, e.g. `'quest.targetMob'` or `'spawn.template'`. */
  kind: string;
  /** The offending record, e.g. `'quest:slay_wolves'` or `'area:forest spawn#7'`. */
  ref: string;
  /** A human-readable description of what is wrong. */
  message: string;
}

/** Minimal shapes for the raw placement tables the typed Content API does not key by area. */
interface CreatureSpawnRow {
  uid: number;
  area_id: string;
  template_id: string;
}
interface AreaMobRow {
  area_id: string;
  template_id: string;
}

/**
 * Scan the currently-loaded content for broken cross-references. Pure-ish: reads only, no writes.
 * Call {@link reloadContent} first if you have just edited the database and want fresh results.
 */
export function auditContent(): { issues: AuditIssue[] } {
  const c = getContent();
  const db = getDb();
  const issues: AuditIssue[] = [];
  const add = (severity: AuditIssue['severity'], kind: string, ref: string, message: string) =>
    issues.push({ severity, kind, ref, message });

  // An area reference is valid if it is a real authored area OR any dungeon id (code- or DB-driven).
  // This mirrors how content-integrity.test.ts resolves portal destinations.
  const areaExists = (id: string): boolean =>
    c.area(id) !== undefined || isCodeDungeon(id) || c.isDungeon(id);

  // --- areas: mob rosters + portals ---------------------------------------------------
  for (const a of c.areas()) {
    for (const entry of c.areaMobs(a.id)) {
      if (c.mobTemplate(entry.templateId) === undefined) {
        add(
          'error',
          'area.roster',
          `area:${a.id}`,
          `mob roster names unknown template "${entry.templateId}"`,
        );
      }
    }
    for (const p of a.portals) {
      if (!areaExists(p.toArea)) {
        add(
          'error',
          'portal.dest',
          `area:${a.id}`,
          `portal "${p.label}" leads to unknown area "${p.toArea}"`,
        );
      }
    }
  }

  // --- creature_spawns: each placed monster instances a real template -----------------
  // Read the raw table because Content keys spawns by area but does not enumerate areas with spawns.
  for (const r of db
    .prepare('SELECT uid, area_id, template_id FROM creature_spawns')
    .all() as CreatureSpawnRow[]) {
    if (c.mobTemplate(r.template_id) === undefined) {
      add(
        'error',
        'spawn.template',
        `area:${r.area_id} spawn#${r.uid}`,
        `creature spawn references unknown mob template "${r.template_id}"`,
      );
    }
    if (!areaExists(r.area_id)) {
      add(
        'error',
        'spawn.area',
        `spawn#${r.uid}`,
        `creature spawn placed in unknown area "${r.area_id}"`,
      );
    }
  }

  // Belt-and-suspenders: area_mobs rows whose area_id is not a real area (c.areaMobs only returns
  // rosters for known areas, so a roster orphaned to a bad area would otherwise go unnoticed).
  for (const r of db.prepare('SELECT area_id, template_id FROM area_mobs').all() as AreaMobRow[]) {
    if (!areaExists(r.area_id)) {
      add(
        'error',
        'roster.area',
        `area:${r.area_id}`,
        `mob roster (template "${r.template_id}") is attached to an unknown area`,
      );
    }
  }

  // --- quests: targetMob / turnInItem / rewardItem / exploreArea / requires -----------
  for (const q of c.quests()) {
    if (q.targetMob !== null && c.mobTemplate(q.targetMob) === undefined) {
      add('error', 'quest.targetMob', `quest:${q.id}`, `targets unknown mob "${q.targetMob}"`);
    }
    if (q.turnInItem !== null && c.item(q.turnInItem) === undefined) {
      add('error', 'quest.turnInItem', `quest:${q.id}`, `turns in unknown item "${q.turnInItem}"`);
    }
    if (q.rewardItem !== null && c.item(q.rewardItem) === undefined) {
      add('error', 'quest.rewardItem', `quest:${q.id}`, `rewards unknown item "${q.rewardItem}"`);
    }
    if (q.exploreArea !== null && !areaExists(q.exploreArea)) {
      add(
        'error',
        'quest.exploreArea',
        `quest:${q.id}`,
        `explores unknown area "${q.exploreArea}"`,
      );
    }
    if (q.requires !== null) {
      if (c.quest(q.requires) === undefined) {
        add('error', 'quest.requires', `quest:${q.id}`, `requires unknown quest "${q.requires}"`);
      }
      if (q.requires === q.id) {
        // A quest gating itself can never unlock — a soft-lock, not a dangling ref.
        add('error', 'quest.requires', `quest:${q.id}`, 'requires itself (would never unlock)');
      }
    }
  }

  // --- npcs: stand in real areas; vendor stock references real items ------------------
  for (const a of c.areas()) {
    for (const npc of c.npcs(a.id)) {
      // The area is real by construction (we iterate c.areas()); the check that matters is vendor
      // shelves pointing at items that exist.
      for (const entry of c.vendorStock(a.id, npc.name)) {
        if (c.item(entry.itemId) === undefined) {
          add(
            'error',
            'vendor.item',
            `area:${a.id} npc:${npc.name}`,
            `vendor sells unknown item "${entry.itemId}"`,
          );
        }
      }
    }
  }

  // Raw vendor_stock sweep: catch shelves whose (area, npc) pairing does not match a placed NPC, or
  // whose area is unknown — c.vendorStock above only reaches NPCs that actually exist in an area.
  for (const r of db.prepare('SELECT DISTINCT area_id, npc_name FROM vendor_stock').all() as {
    area_id: string;
    npc_name: string;
  }[]) {
    if (!areaExists(r.area_id)) {
      add(
        'error',
        'vendor.area',
        `area:${r.area_id} npc:${r.npc_name}`,
        'vendor stock is attached to an unknown area',
      );
      continue;
    }
    const hasNpc = c.npcs(r.area_id).some((n) => n.name === r.npc_name);
    if (!hasNpc) {
      // Orphaned shelf: the items can never be bought because no NPC by that name stands there.
      add(
        'warn',
        'vendor.npc',
        `area:${r.area_id} npc:${r.npc_name}`,
        'vendor stock names an NPC that does not exist in this area',
      );
    }
  }

  // --- abilities: summon behaviors name a summonable creature -------------------------
  for (const ab of c.abilityList()) {
    for (const b of ab.behaviors ?? []) {
      if (b.type !== 'summon') continue;
      const t = c.mobTemplate(b.minion);
      if (t === undefined) {
        add(
          'error',
          'ability.summon',
          `ability:${ab.id}`,
          `summons unknown creature "${b.minion}"`,
        );
      } else if (t.summonable !== true) {
        add(
          'warn',
          'ability.summon',
          `ability:${ab.id}`,
          `summons "${b.minion}" but that template is not flagged summonable`,
        );
      }
    }
  }

  // --- loot: every drop entry resolves to a real item (or gold) -----------------------
  // Read the raw table so we audit the authored drop ids directly rather than RNG-sampling them.
  for (const r of db
    .prepare('SELECT mob_template_id, item_id, is_nothing FROM loot_entry')
    .all() as { mob_template_id: string; item_id: string; is_nothing: number }[]) {
    if (r.is_nothing) continue; // a deliberate "drop nothing" weight has no item to resolve
    if (r.item_id === 'gold' || c.item(r.item_id) !== undefined) continue;
    add(
      'error',
      'loot.item',
      `mob:${r.mob_template_id}`,
      `loot table references unknown item "${r.item_id}"`,
    );
  }

  return { issues };
}
