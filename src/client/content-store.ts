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
  loaded = false;

  load(areas: AreaDef[], abilities: Ability[], items: ItemInfo[]): void {
    this.areasById = new Map(areas.map((a) => [a.id, a]));
    this.abilitiesById = new Map(abilities.map((a) => [a.id, a]));
    this.order = abilities.map((a) => a.id);
    this.itemsById = new Map(items.map((i) => [i.id, i]));
    this.loaded = true;
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
