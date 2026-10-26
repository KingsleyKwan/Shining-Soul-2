import { ITEM_BASES } from './bases';
import { PREFIXES, SUFFIXES } from './affixes';
import {
  amplifyMods,
  emptyMods,
  mergeMods,
  rarityTagZh,
  type AffixDef,
  type ItemBaseDef,
  type ItemRarity,
  type RolledItem,
} from './types';

export type RollOptions = {
  /** Prefer weapon types the hero can use when rolling weapons. */
  allowedWeaponTypes?: string[];
  /** Force weapon-only rolls (chests). */
  preferWeapon?: boolean;
  /** Slightly better rarity weights (chests). */
  betterRarity?: boolean;
};

let uidSeq = 0;

function pickWeighted<T extends { weight: number }>(list: T[], rng: () => number): T {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const item of list) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return list[list.length - 1]!;
}

/**
 * Normal ~50/32/13/5  普／優／稀／傳
 * Chest (better) ~35/35/20/10
 */
function rollRarity(rng: () => number, better?: boolean): ItemRarity {
  const r = rng();
  if (better) {
    if (r < 0.35) return 'common';
    if (r < 0.7) return 'magic';
    if (r < 0.9) return 'rare';
    return 'legendary';
  }
  if (r < 0.5) return 'common';
  if (r < 0.82) return 'magic';
  if (r < 0.95) return 'rare';
  return 'legendary';
}

function filterBases(opts?: RollOptions): ItemBaseDef[] {
  let pool = ITEM_BASES;
  if (opts?.preferWeapon) {
    const weapons = pool.filter((b) => b.slot === 'weapon');
    if (weapons.length) pool = weapons;
  }
  if (opts?.allowedWeaponTypes?.length) {
    const allowed = new Set(opts.allowedWeaponTypes);
    const preferred = pool.filter(
      (b) => b.slot !== 'weapon' || (b.weaponType && allowed.has(b.weaponType)),
    );
    if (preferred.length) pool = preferred;
  }
  return pool;
}

/**
 * Roll a Diablo-like item:
 * common = base only; magic = prefix OR suffix; rare = both;
 * legendary = both + ~1.5× mod amplify.
 */
export function rollItem(rng: () => number = Math.random, opts?: RollOptions): RolledItem {
  const base = pickWeighted(filterBases(opts), rng);
  const rarity = rollRarity(rng, opts?.betterRarity);

  let prefix: AffixDef | undefined;
  let suffix: AffixDef | undefined;
  if (rarity === 'magic') {
    if (rng() < 0.5) prefix = pickWeighted(PREFIXES, rng);
    else suffix = pickWeighted(SUFFIXES, rng);
  } else if (rarity === 'rare' || rarity === 'legendary') {
    prefix = pickWeighted(PREFIXES, rng);
    suffix = pickWeighted(SUFFIXES, rng);
  }

  let mods = mergeMods(base.mods, prefix?.mods, suffix?.mods);
  if (rarity === 'legendary') {
    mods = amplifyMods(mods, 1.5);
  }

  const nameEn = [prefix?.nameEn, base.nameEn, suffix?.nameEn].filter(Boolean).join(' ');
  // 香港繁體：「鋒利鐵劍」／「鐵劍之力量」／「鋒利鐵劍之力量」
  let nameZh: string;
  if (prefix && suffix) nameZh = `${prefix.nameZh}${base.nameZh}之${suffix.nameZh}`;
  else if (prefix) nameZh = `${prefix.nameZh}${base.nameZh}`;
  else if (suffix) nameZh = `${base.nameZh}之${suffix.nameZh}`;
  else nameZh = base.nameZh;

  uidSeq += 1;
  return {
    uid: `item-${Date.now()}-${uidSeq}`,
    baseId: base.id,
    slot: base.slot,
    weaponType: base.weaponType,
    rarity,
    nameEn,
    nameZh,
    prefixId: prefix?.id,
    suffixId: suffix?.id,
    mods: mods.damage || mods.speed || mods.str || mods.maxHp ? mods : emptyMods(),
  };
}

export function formatItemToast(item: RolledItem): string {
  // HK 繁中 only — 【普】／【優】／【稀】／【傳】 + name.
  return `${rarityTagZh(item.rarity)}${item.nameZh}`;
}
