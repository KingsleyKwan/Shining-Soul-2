import { HEROES, type HeroId } from '../data/players';
import {
  defaultUnlockedStages,
  isStageId,
  type StageId,
} from '../data/stages';
import type { RolledItem } from '../data/loot/types';
import { Inventory, type EquipSlot } from './Inventory';
import { MAX_LEVEL, expToNext } from './Progression';

/**
 * localStorage key. The name stays on v1 so older profiles still load.
 * The payload version inside may be 1 or 2; missing level fields become Lv1 / 0.
 */
export const SAVE_STORAGE_KEY = 'shining-soul-2-save-v1';

export const SAVE_VERSION = 2;

/** v1 profiles have no level fields. Both versions stay readable. */
const ACCEPTED_SAVE_VERSIONS = new Set([1, 2]);

export type StoryFlags = {
  /** Intro / Deatharte / King cards already shown. */
  seenIntro: boolean;
  /** Stage 1 哥布林要塞 cleared (Captain Gully defeated + exit). */
  goblinCleared: boolean;
  /** Player has visited the village hub at least once. */
  villageVisited: boolean;
};

export type SaveData = {
  version: 2;
  heroId: HeroId;
  gold: number;
  bag: RolledItem[];
  equipped: Partial<Record<EquipSlot, RolledItem>>;
  /** Permanently unlocked stage ids. Always includes 1. Missing on old saves → [1]. */
  unlockedStages: StageId[];
  seenIntro: boolean;
  goblinCleared: boolean;
  villageVisited: boolean;
  /** Persistent run level. Death does not reset it. New game is 1. */
  level: number;
  /** EXP toward the next level, not a lifetime total. */
  exp: number;
};

export function isHeroId(value: unknown): value is HeroId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HEROES, value);
}

/**
 * Read the profile. Missing, unreadable, unknown-version, or invalid-hero
 * saves return null. Bad items are dropped; missing gold / bag / gear / unlocks default.
 */
export function load(): SaveData | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    return parseSave(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Write the profile. Swallows private-mode / quota failures. */
export function save(data: SaveData): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const parsed = parseSave(data);
    if (!parsed) return;
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* private mode, quota, or storage disabled */
  }
}

export function clear(): void {
  try {
    getStorage()?.removeItem(SAVE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** True only when a readable save with a known hero can be loaded. */
export function hasSave(): boolean {
  return load() !== null;
}

export function getUnlockedStages(data: SaveData | null | undefined): StageId[] {
  if (!data) return defaultUnlockedStages();
  return sanitizeUnlocked(data.unlockedStages);
}

export function isStageUnlocked(
  data: SaveData | null | undefined,
  id: StageId,
): boolean {
  return getUnlockedStages(data).includes(id);
}

/** Return a copy with `stageId` permanently unlocked (idempotent). */
export function unlockStage(data: SaveData, stageId: StageId): SaveData {
  const unlocked = new Set(getUnlockedStages(data));
  unlocked.add(stageId);
  return {
    ...data,
    unlockedStages: sanitizeUnlocked([...unlocked]),
  };
}

export function getFlags(data: SaveData | null | undefined): StoryFlags {
  return {
    seenIntro: !!data?.seenIntro,
    goblinCleared: !!data?.goblinCleared,
    villageVisited: !!data?.villageVisited,
  };
}

/** Merge story flags onto a save (idempotent for true flags when patching true). */
export function withFlags(data: SaveData, patch: Partial<StoryFlags>): SaveData {
  return {
    ...data,
    seenIntro: patch.seenIntro ?? data.seenIntro,
    goblinCleared: patch.goblinCleared ?? data.goblinCleared,
    villageVisited: patch.villageVisited ?? data.villageVisited,
  };
}

/** Build a fresh profile for a hero (new game). Level starts at 1 / 0 經驗. */
export function makeFreshSave(heroId: HeroId, flags?: Partial<StoryFlags>): SaveData {
  return {
    version: SAVE_VERSION,
    heroId,
    gold: 0,
    bag: [],
    equipped: {},
    unlockedStages: defaultUnlockedStages(),
    seenIntro: !!flags?.seenIntro,
    goblinCleared: !!flags?.goblinCleared,
    villageVisited: !!flags?.villageVisited,
    level: 1,
    exp: 0,
  };
}

/**
 * Merge gold/gear/hero onto the existing profile while keeping unlocks + story flags
 * unless `patch` overrides them.
 */
export function mergeProfile(
  existing: SaveData | null | undefined,
  patch: {
    heroId: HeroId;
    gold?: number;
    bag?: RolledItem[];
    equipped?: Partial<Record<EquipSlot, RolledItem>>;
    unlockedStages?: StageId[];
    level?: number;
    exp?: number;
  } & Partial<StoryFlags>,
): SaveData {
  const base = existing ?? makeFreshSave(patch.heroId);
  const level = sanitizeLevel(patch.level ?? base.level);
  return {
    version: SAVE_VERSION,
    heroId: patch.heroId,
    gold: patch.gold ?? base.gold,
    bag: patch.bag ?? base.bag,
    equipped: patch.equipped ?? base.equipped,
    unlockedStages: sanitizeUnlocked(patch.unlockedStages ?? base.unlockedStages),
    seenIntro: patch.seenIntro ?? base.seenIntro,
    goblinCleared: patch.goblinCleared ?? base.goblinCleared,
    villageVisited: patch.villageVisited ?? base.villageVisited,
    level,
    exp: sanitizeExp(patch.exp ?? base.exp, level),
  };
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sanitizeGold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function sanitizeLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(value)));
}

function sanitizeExp(value: unknown, level: number): number {
  const cap = Math.max(1, expToNext(level));
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(cap - 1, Math.floor(value));
}

function sanitizeUnlocked(value: unknown): StageId[] {
  const out = new Set<StageId>([1]);
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isStageId(entry)) {
        out.add(entry);
        continue;
      }
      if (typeof entry === 'string' || typeof entry === 'number') {
        const n = typeof entry === 'number' ? entry : Number(entry);
        if (isStageId(n)) out.add(n);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

function asBool(value: unknown): boolean {
  return value === true;
}

function parseSave(value: unknown): SaveData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !ACCEPTED_SAVE_VERSIONS.has(raw.version)) return null;
  if (!isHeroId(raw.heroId)) return null;

  const inv = Inventory.fromJSON({ bag: raw.bag, equipped: raw.equipped });
  const snap = inv.toJSON();
  const level = sanitizeLevel(raw.level);
  return {
    version: SAVE_VERSION,
    heroId: raw.heroId,
    gold: sanitizeGold(raw.gold),
    bag: snap.bag,
    equipped: snap.equipped,
    unlockedStages: sanitizeUnlocked(raw.unlockedStages),
    seenIntro: asBool(raw.seenIntro),
    goblinCleared: asBool(raw.goblinCleared),
    villageVisited: asBool(raw.villageVisited),
    level,
    exp: sanitizeExp(raw.exp, level),
  };
}
