import type { AreaDef } from '../shared/areas.js';
import type { Ability, AbilityId } from '../shared/combat.js';
import type { ItemInfo } from '../shared/protocol.js';

/**
 * Client-side mirror of the server's content database. Populated from the `content` packet the
 * server sends on connect, so the client reflects whatever is in the SQLite DB — add an area,
 * spell, or item via SQL and the client renders it without a code change. Starts empty; the game
 * guards against that during the brief moment before the packet arrives.
 */
export class ClientContentStore {
  private areasById = new Map<string, AreaDef>();
  private abilitiesById = new Map<string, Ability>();
  private order: AbilityId[] = [];
  private itemsById = new Map<string, ItemInfo>();
  private tintsByTarget = new Map<string, string>();
  private dungeonIds = new Set<string>();
  loaded = false;

  load(
    areas: AreaDef[],
    abilities: Ability[],
    items: ItemInfo[],
    tints?: Record<string, string>,
    dungeons?: string[],
  ): void {
    this.areasById = new Map(areas.map((a) => [a.id, a]));
    this.abilitiesById = new Map(abilities.map((a) => [a.id, a]));
    // Ability.id is a plain string on the wire; the server only sends real ability ids.
    this.order = abilities.map((a) => a.id) as AbilityId[];
    this.itemsById = new Map(items.map((i) => [i.id, i]));
    this.tintsByTarget = new Map(Object.entries(tints ?? {}));
    this.dungeonIds = new Set(dungeons ?? []);
    this.loaded = true;
  }

  /** True if the area id is a procedural dungeon (per the server's content packet). */
  isDungeon(areaId: string): boolean {
    return this.dungeonIds.has(areaId);
  }

  /** SQL sprite color override for a target key (e.g. 'decor:grave'), or undefined. */
  tint(target: string): string | undefined {
    return this.tintsByTarget.get(target);
  }

  area(id: string): AreaDef | undefined {
    return this.areasById.get(id);
  }

  ability(id: string): Ability | undefined {
    return this.abilitiesById.get(id);
  }

  abilityOrder(): AbilityId[] {
    return this.order;
  }

  item(id: string): ItemInfo | undefined {
    return this.itemsById.get(id);
  }

  isEquip(id: string): boolean {
    return this.itemsById.get(id)?.kind === 'equip';
  }
}
