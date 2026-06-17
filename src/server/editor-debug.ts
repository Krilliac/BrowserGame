import { getContent, getDb } from './content.js';

/**
 * A static, read-only snapshot of CONTENT-side statistics for the editor's debug panel.
 *
 * This is deliberately limited to data that comes purely from the loaded content database — area /
 * template / item counts, which creatures are summonable or tameable, which areas allow PvP. It is
 * NOT live runtime state: instance population, connected players, tick timing, etc. live in the
 * authoritative host (index.ts) and are owned there, not here. Keeping this provider pure (reads
 * only) means it is safe to call from any read-only diagnostic route.
 */
export interface EditorDebugInfo {
  areas: number;
  mobTemplates: number;
  items: number;
  abilities: number;
  quests: number;
  /** NPC count per area, from getContent().npcs(areaId). */
  npcsByArea: { areaId: string; count: number }[];
  /** Mob template ids flagged `summonable` (raise/minion targets). */
  summonableCreatures: string[];
  /** Mob template ids flagged `tameable` (pet candidates). */
  tameableCreatures: string[];
  /** Areas whose PvP rule is not 'safe' (contested / hostile). */
  pvpAreas: { areaId: string; rule: string }[];
}

/** One mob_templates row, narrowed to just the fields this panel reports on. */
interface MobTemplateFlagsRow {
  id: string;
  summonable: number | null;
  tameable: number | null;
}

/**
 * Build the content-side debug snapshot. Pure reads via the typed content accessors, plus a single
 * direct read of the `mob_templates` table for the full id list (Content exposes mobTemplate(id) but
 * no list accessor, and summonable/tameable live on those rows).
 */
export function editorDebugInfo(): EditorDebugInfo {
  const content = getContent();

  const areas = content.areas();

  const mobRows = getDb()
    .prepare('SELECT id, summonable, tameable FROM mob_templates')
    .all() as MobTemplateFlagsRow[];

  return {
    areas: areas.length,
    mobTemplates: mobRows.length,
    items: content.items().length,
    abilities: content.abilityList().length,
    quests: content.quests().length,
    npcsByArea: areas.map((a) => ({ areaId: a.id, count: content.npcs(a.id).length })),
    summonableCreatures: mobRows.filter((r) => r.summonable).map((r) => r.id),
    tameableCreatures: mobRows.filter((r) => r.tameable).map((r) => r.id),
    pvpAreas: areas
      .filter(
        (a): a is typeof a & { pvp: NonNullable<typeof a.pvp> } => !!a.pvp && a.pvp !== 'safe',
      )
      .map((a) => ({ areaId: a.id, rule: a.pvp })),
  };
}
