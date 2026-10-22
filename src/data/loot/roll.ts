import { ITEM_BASES } from './bases';
import { PREFIXES, SUFFIXES } from './affixes';
import {
  emptyMods,
  mergeMods,
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

function rollRarity(rng: () => number): ItemRarity {
  const r = rng();
  if (r < 0.55) return 'common';
  if (r < 0.9) return 'magic';
  return 'rare';
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
 * Roll a Diablo-like item: common = base only; magic = prefix OR suffix;
 * rare = prefix AND suffix.
 */
export function rollItem(rng: () => number = Math.random, opts?: RollOptions): RolledItem {
  const base = pickWeighted(filterBases(opts), rng);
  const rarity = rollRarity(rng);

  let prefix: AffixDef | undefined;
  let suffix: AffixDef | undefined;
  if (rarity === 'magic') {
    if (rng() < 0.5) prefix = pickWeighted(PREFIXES, rng);
    else suffix = pickWeighted(SUFFIXES, rng);
  } else if (rarity === 'rare') {
    prefix = pickWeighted(PREFIXES, rng);
    suffix = pickWeighted(SUFFIXES, rng);
  }

  const mods = mergeMods(base.mods, prefix?.mods, suffix?.mods);

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
  const tag =
    item.rarity === 'rare' ? '★' : item.rarity === 'magic' ? '◆' : '·';
  return `${tag} ${item.nameEn} / ${item.nameZh}`;
}
