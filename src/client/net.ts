import { SnapshotBuffer } from './interp.js';
import { ClientContentStore } from './content-store.js';
import type { TimedFx } from './draw.js';
import {
  PROTOCOL_VERSION,
  decodeServer,
  encode,
  type ChatChannel,
  type EngineOp,
  type EngineResData,
  type FriendInfo,
  type InputState,
  type PartyMember,
  type QuestState,
  type ServerMessage,
} from '../shared/protocol.js';

/** Resolved reply to an engine-panel request. */
export interface EngineReply {
  ok: boolean;
  message?: string;
  data?: EngineResData;
}
import type { AbilityId } from '../shared/combat.js';
import {
  applyRarityOverrides,
  applyAffixNameOverrides,
  type AffixName,
  type AffixStat,
  type ItemInstance,
  type Rarity,
  type RarityDef,
} from '../shared/items.js';
import { applyGemOverrides } from '../shared/gems.js';
import { applyItemSetOverrides } from '../shared/item-sets.js';
import { applySkillTreeOverrides } from '../shared/skilltree.js';
import { type AttributeSet, emptyAttributes } from '../shared/attributes.js';

export interface ChatLine {
  from: string;
  text: string;
  channel?: ChatChannel;
}

/** The local player's party view (empty members = solo; inviteFrom set on a pending invite). */
export interface PartyView {
  members: PartyMember[];
  inviteFrom?: string;
}

export interface SelfStats {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dead: boolean;
  level: number;
  xp: number;
  xpInto: number;
  xpNext: number;
  gold: number;
  loot: Record<string, number>;
  gear: ItemInstance[];
  potions: { health: number; mana: number };
  attributes: AttributeSet;
  attrPoints: number;
  skills: string[];
  skillPoints: number;
  respawnIn: number;
  power: number;
  critChance: number;
  equipment: Record<string, ItemInstance | null>;
  known: Record<string, number>;
  quests: QuestState[];
  discovered: string[];
  corruption: number;
  x: number;
  y: number;
  ackSeq: number;
  /** Effective move multiplier — fed to the predictor so prediction matches the server. */
  moveMul: number;
  /** Lifetime monster kills (shown on the character sheet). */
  kills: number;
  /** Lifetime boss-tier kills (hp >= 200). */
  bossKills: number;
  /** Current deathless streak — kills since the last death. */
  deathlessStreak: number;
}

/** A vendor's shop contents, set when a `shop` packet arrives and cleared when the panel closes. */
export interface ShopState {
  vendor: string;
  stock: { itemId: string; price: number }[];
}

const MAX_CHAT_LINES = 50;
const MAX_FX = 150;

/**
 * Thin WebSocket client. Connects to the same origin's /ws (Vite proxies this to the
 * game server in dev; the prod server hosts both on one port). One url to open — works
 * the same on a laptop or a phone.
 */
export class Net {
  private ws: WebSocket | null = null;
  readonly snapshots = new SnapshotBuffer();
  readonly content = new ClientContentStore();
  readonly chat: ChatLine[] = [];
  readonly fx: TimedFx[] = [];
  you: SelfStats = {
    hp: 100,
    maxHp: 100,
    mana: 100,
    maxMana: 100,
    dead: false,
    level: 1,
    xp: 0,
    xpInto: 0,
    xpNext: 100,
    gold: 0,
    loot: {},
    gear: [],
    potions: { health: 0, mana: 0 },
    attributes: emptyAttributes(),
    attrPoints: 0,
    skills: [],
    skillPoints: 0,
    respawnIn: 0,
    power: 0,
    critChance: 0.15,
    equipment: {},
    known: {},
    quests: [],
    discovered: [],
    corruption: 0,
    x: 0,
    y: 0,
    ackSeq: 0,
    moveMul: 1,
    kills: 0,
    bossKills: 0,
    deathlessStreak: 0,
  };
  /** The currently-open vendor shop (null when no shop panel is open). */
  shop: ShopState | null = null;
  /** The local player's party (roster + pending invite). */
  party: PartyView = { members: [] };
  /** The local player's friends list with live presence. */
  friends: FriendInfo[] = [];
  /** Open gambling window (per-pull cost), or null when no gambler panel is open. */
  gamble: { cost: number } | null = null;
  /** Open recruiter hire window (mercenary offers), or null when no hire panel is open. */
  hire: { offers: { type: string; name: string; cost: number }[] } | null = null;
  /** Open Riftkeeper window (tier range + fee), or null when no rift panel is open. */
  rift: { maxTier: number; costBase: number } | null = null;
  /** Open Artificer window (service costs), or null when no artificer panel is open. */
  artificer: { rerollCost: number; unsocketCost: number } | null = null;
  /** Open banker stash (stored items + capacity + next expand cost), or null when closed. */
  stash: { items: ItemInstance[]; cap: number; expandCost: number } | null = null;
  /** Currently-active timed liveops events (for the HUD badge); updated by 'events' packets. */
  activeEvents: { id: string; name: string; xpBonus?: number; goldBonus?: number }[] = [];
  /** Set when the server rejected our protocol version — show "refresh", stop reconnecting. */
  outdated = false;
  /** Bumped whenever a new authoritative 'you' arrives — drives client reconciliation. */
  authRev = 0;
  /** Bumped whenever a content packet arrives — drives a live re-skin (theme edits, hot reload). */
  contentRev = 0;
  selfId = 0;
  connected = false;
  tickRate = 20;
  areaId = 'town';
  instanceId = '';
  /** This connection's access level (0 = Player; raised via /login). Drives GM-only client UI. */
  accessLevel = 0;
  /** Called when the access level changes (so the settings panel can reveal/hide GM options). */
  onAccess: ((level: number) => void) | undefined;
  /** In-flight engine-panel requests, keyed by request id, awaiting their `engine_res`. */
  private engineSeq = 0;
  private readonly engineWaiters = new Map<number, (reply: EngineReply) => void>();

  constructor(private readonly name: string) {}

  connect(): void {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      // Present our saved character token (if any) so the server reloads our progress, and our
      // protocol version so a stale cached bundle gets a clean "refresh" instead of garbage.
      // localStorage can throw (private mode / disabled storage) — degrade to a fresh guest token.
      let token: string | undefined;
      try {
        token = window.localStorage.getItem('bg.token') ?? undefined;
      } catch {
        token = undefined;
      }
      ws.send(
        encode(
          token
            ? { t: 'join', name: this.name, token, v: PROTOCOL_VERSION }
            : { t: 'join', name: this.name, v: PROTOCOL_VERSION },
        ),
      );
    });

    ws.addEventListener('message', (ev) => {
      const msg = decodeServer(String(ev.data));
      if (!msg) return;
      // A well-formed-but-unexpected frame hitting a handler must not throw out of the socket's
      // message pump (which would stop processing all later frames). Contain it per-message.
      try {
        this.handle(msg);
      } catch (err) {
        console.error('[net] message handler failed:', err);
      }
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      // Drop stale world state so the reconnect resumes cleanly (no frozen ghosts) once the
      // server's fresh welcome + snapshots arrive.
      this.snapshots.clear();
      this.fx.length = 0;
      // Naive auto-reconnect — good enough for a dev foundation. An OUTDATED client never
      // retries: the bundle itself is stale, only a refresh fixes it.
      if (!this.outdated) setTimeout(() => this.connect(), 1000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  sendInput(input: InputState, seq: number): void {
    this.send({ t: 'input', input, seq });
  }

  sendChat(text: string): void {
    this.send({ t: 'chat', text });
  }

  sendCast(ability: AbilityId, dx: number, dy: number): void {
    this.send({ t: 'cast', ability, dx, dy });
  }

  sendInteract(): void {
    this.send({ t: 'interact' });
  }

  sendEquip(uid: number): void {
    this.send({ t: 'equip', uid });
  }

  sendSalvage(uid: number): void {
    this.send({ t: 'salvage', uid });
  }

  sendUnequip(slot: string): void {
    this.send({ t: 'unequip', slot });
  }

  sendLearn(itemId: string): void {
    this.send({ t: 'learn', itemId });
  }

  sendAcceptQuest(questId: string): void {
    this.send({ t: 'accept_quest', questId });
  }

  sendPartyInvite(targetName: string): void {
    this.send({ t: 'party_invite', targetName });
  }

  sendPartyAccept(): void {
    this.send({ t: 'party_accept' });
  }

  sendPartyDecline(): void {
    this.send({ t: 'party_decline' });
  }

  sendPartyLeave(): void {
    this.send({ t: 'party_leave' });
  }

  sendFriendAdd(name: string): void {
    this.send({ t: 'friend_add', name });
  }

  sendFriendRemove(name: string): void {
    this.send({ t: 'friend_remove', name });
  }

  sendWhisper(to: string, text: string): void {
    this.send({ t: 'whisper', to, text });
  }

  sendSocketGem(gemId: string): void {
    this.send({ t: 'socket_gem', gemId });
  }

  sendGamble(slot: string): void {
    this.send({ t: 'gamble', slot });
  }

  sendHire(type: string): void {
    this.send({ t: 'hire', type });
  }

  sendOpenRift(tier: number): void {
    this.send({ t: 'open_rift', tier });
  }

  sendWaypoint(areaId: string): void {
    this.send({ t: 'waypoint', areaId });
  }

  sendEnchant(uid: number): void {
    this.send({ t: 'enchant', uid });
  }

  sendUnsocketGem(slot: string, index: number): void {
    this.send({ t: 'unsocket_gem', slot, index });
  }

  sendCombineGems(): void {
    this.send({ t: 'combine_gems' });
  }

  sendStashDeposit(uid: number): void {
    this.send({ t: 'stash_deposit', uid });
  }

  sendStashWithdraw(uid: number): void {
    this.send({ t: 'stash_withdraw', uid });
  }

  sendUsePotion(kind: 'health' | 'mana'): void {
    this.send({ t: 'use_potion', kind });
  }

  sendAllocateAttr(attr: string): void {
    this.send({ t: 'allocate_attr', attr });
  }

  sendAllocateSkill(nodeId: string): void {
    this.send({ t: 'allocate_skill', nodeId });
  }

  sendBuy(itemId: string): void {
    this.send({ t: 'buy', itemId });
  }

  sendSell(): void {
    this.send({ t: 'sell' });
  }

  /** Send a Dev engine-panel request and resolve with the server's reply (or a timeout error). */
  sendEngine(op: EngineOp): Promise<EngineReply> {
    const rid = ++this.engineSeq;
    return new Promise<EngineReply>((resolve) => {
      this.engineWaiters.set(rid, resolve);
      this.send({ t: 'engine_req', rid, op });
      setTimeout(() => {
        if (this.engineWaiters.delete(rid)) resolve({ ok: false, message: 'request timed out' });
      }, 8000);
    });
  }

  private send(msg: Parameters<typeof encode>[0]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'content':
        this.content.load(msg.areas, msg.abilities, msg.items, msg.tints, msg.dungeons);
        // Mirror the server's rarity tuning (weights are server-only, but colors/names drive the UI).
        applyRarityOverrides((msg.rarities ?? {}) as Partial<Record<Rarity, RarityDef>>);
        // Mirror the gem catalog so client icons recognize gems added/edited via SQL.
        if (msg.gems) applyGemOverrides(msg.gems);
        // Mirror affix flavor names so item titles compose from DB data.
        applyAffixNameOverrides((msg.affixNames ?? {}) as Partial<Record<AffixStat, AffixName>>);
        // Mirror the passive skill tree so the panel renders nodes/prereqs from DB data.
        if (msg.skillTree) applySkillTreeOverrides(msg.skillTree);
        // Mirror the item sets so the character panel can show set progress + active bonuses.
        if (msg.itemSets) applyItemSetOverrides(msg.itemSets);
        this.contentRev++;
        break;
      case 'welcome':
        this.selfId = msg.id;
        this.tickRate = msg.tickRate;
        this.areaId = msg.areaId;
        this.instanceId = msg.instanceId;
        // Persist our character token so a reload/reconnect restores this character. Tolerate
        // storage failures (private mode / quota) — we keep the token in memory for this session.
        try {
          window.localStorage.setItem('bg.token', msg.token);
        } catch {
          // No persistence this session; reconnects within the session still reuse the live socket.
        }
        break;
      case 'snapshot': {
        const now = performance.now();
        this.snapshots.push(msg.entities, now);
        for (const ev of msg.fx) this.fx.push({ ev, t0: now });
        if (this.fx.length > MAX_FX) this.fx.splice(0, this.fx.length - MAX_FX);
        break;
      }
      case 'you':
        this.you = {
          hp: msg.hp,
          maxHp: msg.maxHp,
          mana: msg.mana,
          maxMana: msg.maxMana,
          dead: msg.dead,
          level: msg.level,
          xp: msg.xp,
          xpInto: msg.xpInto,
          xpNext: msg.xpNext,
          gold: msg.gold,
          loot: msg.loot,
          gear: msg.gear,
          potions: msg.potions ?? { health: 0, mana: 0 },
          attributes: msg.attributes ?? emptyAttributes(),
          attrPoints: msg.attrPoints ?? 0,
          skills: msg.skills ?? [],
          skillPoints: msg.skillPoints ?? 0,
          respawnIn: msg.respawnIn,
          power: msg.power,
          critChance: msg.critChance,
          equipment: msg.equipment,
          known: msg.known,
          quests: msg.quests,
          discovered: msg.discovered,
          corruption: msg.corruption,
          x: msg.x,
          y: msg.y,
          ackSeq: msg.ackSeq,
          moveMul: msg.moveMul,
          kills: msg.kills,
          bossKills: msg.bossKills,
          deathlessStreak: msg.deathlessStreak,
        };
        this.authRev++;
        break;
      case 'shop':
        // Defensive: never trust the frame's shape. Drop a non-array stock and cap its size so a
        // malformed/hostile 'shop' message can't crash or freeze the renderer.
        if (Array.isArray(msg.stock)) {
          this.shop = { vendor: String(msg.vendor ?? 'Vendor'), stock: msg.stock.slice(0, 60) };
        }
        break;
      case 'events':
        this.activeEvents = Array.isArray(msg.active) ? msg.active.slice(0, 8) : [];
        break;
      case 'stash':
        // Defensive: a malformed/hostile 'stash' message can't crash the panel.
        this.stash = {
          items: Array.isArray(msg.items) ? msg.items.slice(0, 200) : [],
          cap: typeof msg.cap === 'number' ? msg.cap : 0,
          expandCost: typeof msg.expandCost === 'number' ? msg.expandCost : 0,
        };
        break;
      case 'party':
        this.party = Array.isArray(msg.members)
          ? { members: msg.members, ...(msg.inviteFrom ? { inviteFrom: msg.inviteFrom } : {}) }
          : { members: [] };
        break;
      case 'friends':
        this.friends = Array.isArray(msg.list) ? msg.list : [];
        break;
      case 'gamble_open':
        this.gamble = { cost: typeof msg.cost === 'number' ? msg.cost : 0 };
        break;
      case 'hire_open':
        this.hire = { offers: Array.isArray(msg.offers) ? msg.offers.slice(0, 8) : [] };
        break;
      case 'rift_open':
        this.rift = {
          maxTier: typeof msg.maxTier === 'number' ? Math.max(1, Math.min(20, msg.maxTier)) : 1,
          costBase: typeof msg.costBase === 'number' ? msg.costBase : 0,
        };
        break;
      case 'artificer_open':
        this.artificer = {
          rerollCost: typeof msg.rerollCost === 'number' ? msg.rerollCost : 0,
          unsocketCost: typeof msg.unsocketCost === 'number' ? msg.unsocketCost : 0,
        };
        break;
      case 'area_changed':
        this.areaId = msg.areaId;
        this.instanceId = msg.instanceId;
        this.snapshots.clear(); // forget the old area's entities immediately
        this.fx.length = 0;
        this.shop = null; // close any open shop when we leave the area
        this.gamble = null;
        this.hire = null;
        this.rift = null;
        this.artificer = null;
        this.stash = null;
        break;
      case 'chat':
        this.chat.push(
          msg.channel
            ? { from: msg.from, text: msg.text, channel: msg.channel }
            : { from: msg.from, text: msg.text },
        );
        if (this.chat.length > MAX_CHAT_LINES) this.chat.shift();
        break;
      case 'refresh_required':
        this.outdated = true;
        break;
      case 'admin_result':
        console.log('[admin]', msg.ok, msg.message);
        break;
      case 'access':
        this.accessLevel = msg.level;
        this.onAccess?.(msg.level);
        break;
      case 'engine_res': {
        const waiter = this.engineWaiters.get(msg.rid);
        if (waiter) {
          this.engineWaiters.delete(msg.rid);
          const reply: EngineReply = { ok: msg.ok };
          if (msg.message !== undefined) reply.message = msg.message;
          if (msg.data !== undefined) reply.data = msg.data;
          waiter(reply);
        }
        break;
      }
    }
  }
}
