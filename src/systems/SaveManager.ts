import { HEROES, type HeroId } from '../data/players';
import {
  defaultUnlockedStages,
  isStageId,
  type StageId,
} from '../data/stages';
import type { RolledItem } from '../data/loot/types';
import { Inventory, type EquipSlot } from './Inventory';

/** localStorage key for the v1 profile (hero, gold, bag, equipped gear, unlocks). */
export const SAVE_STORAGE_KEY = 'shining-soul-2-save-v1';

export const SAVE_VERSION = 1;

export type SaveData = {
  version: 1;
  heroId: HeroId;
  gold: number;
  bag: RolledItem[];
  equipped: Partial<Record<EquipSlot, RolledItem>>;
  /** Permanently unlocked stage ids. Always includes 1. Missing on old saves → [1]. */
  unlockedStages: StageId[];
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

/** True only when a v1 save with a known hero can be loaded. */
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

function parseSave(value: unknown): SaveData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== SAVE_VERSION) return null;
  if (!isHeroId(raw.heroId)) return null;

  const inv = Inventory.fromJSON({ bag: raw.bag, equipped: raw.equipped });
  const snap = inv.toJSON();
  return {
    version: 1,
    heroId: raw.heroId,
    gold: sanitizeGold(raw.gold),
    bag: snap.bag,
    equipped: snap.equipped,
    unlockedStages: sanitizeUnlocked(raw.unlockedStages),
  };
}
