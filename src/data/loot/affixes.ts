import type { AffixDef } from './types';

/** Prefixes (before base name). Names are 香港繁體. */
export const PREFIXES: AffixDef[] = [
  { id: 'sharp', slot: 'prefix', nameEn: 'Sharp', nameZh: '鋒利', mods: { damage: 1 }, weight: 10 },
  { id: 'brutal', slot: 'prefix', nameEn: 'Brutal', nameZh: '殘暴', mods: { damage: 2, str: 1 }, weight: 5 },
  { id: 'keen', slot: 'prefix', nameEn: 'Keen', nameZh: '敏銳', mods: { damage: 1, str: 1 }, weight: 7 },
  { id: 'swift', slot: 'prefix', nameEn: 'Swift', nameZh: '迅捷', mods: { speed: 12 }, weight: 9 },
  { id: 'nimble', slot: 'prefix', nameEn: 'Nimble', nameZh: '靈巧', mods: { speed: 18 }, weight: 5 },
  { id: 'sturdy', slot: 'prefix', nameEn: 'Sturdy', nameZh: '堅固', mods: { maxHp: 1 }, weight: 8 },
  { id: 'vital', slot: 'prefix', nameEn: 'Vital', nameZh: '活力', mods: { maxHp: 2 }, weight: 4 },
  { id: 'mighty', slot: 'prefix', nameEn: 'Mighty', nameZh: '強力', mods: { str: 2 }, weight: 4 },
];

/** Suffixes (after base name). */
export const SUFFIXES: AffixDef[] = [
  { id: 'of_power', slot: 'suffix', nameEn: 'of Power', nameZh: '力量', mods: { str: 1, damage: 1 }, weight: 8 },
  { id: 'of_speed', slot: 'suffix', nameEn: 'of Speed', nameZh: '速度', mods: { speed: 15 }, weight: 8 },
  { id: 'of_the_bear', slot: 'suffix', nameEn: 'of the Bear', nameZh: '巨熊', mods: { maxHp: 1, str: 1 }, weight: 5 },
  { id: 'of_flame', slot: 'suffix', nameEn: 'of Flame', nameZh: '火焰', mods: { damage: 2 }, weight: 6 },
  { id: 'of_wind', slot: 'suffix', nameEn: 'of Wind', nameZh: '疾風', mods: { speed: 10, damage: 1 }, weight: 6 },
  { id: 'of_life', slot: 'suffix', nameEn: 'of Life', nameZh: '生命', mods: { maxHp: 2 }, weight: 5 },
  { id: 'of_ruin', slot: 'suffix', nameEn: 'of Ruin', nameZh: '毀滅', mods: { damage: 3 }, weight: 3 },
];
