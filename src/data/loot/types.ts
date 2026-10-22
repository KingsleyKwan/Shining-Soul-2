/** Diablo-like affix loot — JSON-friendly shapes for Phase 2. */

export type ItemSlot = 'weapon' | 'armor' | 'accessory';
export type ItemRarity = 'common' | 'magic' | 'rare';

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
