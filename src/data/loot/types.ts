/** Diablo-like affix loot — JSON-friendly shapes for Phase 2. */

export type ItemSlot = 'weapon' | 'armor' | 'accessory';
/** Internal ids stay English; UI maps magic→優, legendary→傳. */
export type ItemRarity = 'common' | 'magic' | 'rare' | 'legendary';

/** Flat bonuses stacked from prefix + suffix (+ base). */
export type ItemMods = {
  /** Added to slash damage before str formula. */
  damage: number;
  /** Added to move speed (pixels/sec). */
  speed: number;
  /** Added to hero STR for damage formula. */
  str: number;
  /** Bonus max HP (heal on pickup for Phase 2 stub). */
  maxHp: number;
};

export type AffixDef = {
  id: string;
  slot: 'prefix' | 'suffix';
  /** English affix word */
  nameEn: string;
  /** 香港繁體 affix word */
  nameZh: string;
  mods: Partial<ItemMods>;
  /** Higher = more likely on better rolls */
  weight: number;
};

export type ItemBaseDef = {
  id: string;
  slot: ItemSlot;
  /** Matches PlayerData.weapons.allowedTypes when slot=weapon */
  weaponType?: string;
  nameEn: string;
  nameZh: string;
  /** Intrinsic mods before affixes */
  mods: Partial<ItemMods>;
  weight: number;
};

export type RolledItem = {
  uid: string;
  baseId: string;
  slot: ItemSlot;
  weaponType?: string;
  rarity: ItemRarity;
  nameEn: string;
  nameZh: string;
  prefixId?: string;
  suffixId?: string;
  mods: ItemMods;
};

/** HK 繁中 short tier tags for toast / bag. */
export const RARITY_LABEL_ZH: Record<ItemRarity, string> = {
  common: '普',
  magic: '優',
  rare: '稀',
  legendary: '傳',
};

/** Name text colors on dark HUD / inventory. */
export const RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#d8e0e8',
  magic: '#88ccff',
  rare: '#ffd24a',
  legendary: '#ff8c3a',
};

export function isItemRarity(value: string): value is ItemRarity {
  return value === 'common' || value === 'magic' || value === 'rare' || value === 'legendary';
}

export function rarityTagZh(rarity: ItemRarity): string {
  return `【${RARITY_LABEL_ZH[rarity]}】`;
}

export function emptyMods(): ItemMods {
  return { damage: 0, speed: 0, str: 0, maxHp: 0 };
}

export function mergeMods(...parts: Array<Partial<ItemMods> | undefined>): ItemMods {
  const out = emptyMods();
  for (const p of parts) {
    if (!p) continue;
    out.damage += p.damage ?? 0;
    out.speed += p.speed ?? 0;
    out.str += p.str ?? 0;
    out.maxHp += p.maxHp ?? 0;
  }
  return out;
}

/** Scale numeric mods (legendary bump). Rounds to int; zeros stay zero. */
export function amplifyMods(mods: ItemMods, factor: number): ItemMods {
  const scale = (n: number): number => {
    if (!n) return 0;
    const scaled = Math.round(n * factor);
    // Keep at least ±1 if the source was non-zero so amplify never zeroes a bonus.
    if (scaled === 0) return n > 0 ? 1 : -1;
    return scaled;
  };
  return {
    damage: scale(mods.damage),
    speed: scale(mods.speed),
    str: scale(mods.str),
    maxHp: scale(mods.maxHp),
  };
}
