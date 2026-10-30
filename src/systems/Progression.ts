/**
 * In-run level curve shared by the dungeon HUD and the save file.
 * A new game starts at Lv 1 / 0 經驗. Dying does not reset it.
 */

export const MAX_LEVEL = 30;

/** Q stays. The second slot (F / 技2) opens at this level. */
export const SECOND_SKILL_LEVEL = 3;

export const EXP_PASTE = 8;
export const EXP_ROOM = 12;
export const EXP_BOSS = 40;

/** EXP still needed to leave `level`. Lv1 → 30, then +16 per level. */
export function expToNext(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return 30 + (lv - 1) * 16;
}

/** +1 max HP for each level above 1. */
export function levelHpBonus(level: number): number {
  return Math.max(0, Math.floor(level) - 1);
}

/** +1 attack every two levels above 1. Added after the slash formula. */
export function levelAtkBonus(level: number): number {
  return Math.floor(levelHpBonus(level) / 2);
}
