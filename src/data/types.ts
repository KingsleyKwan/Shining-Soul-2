/** Shared character / animation types — Phase 1 data-driven layout. */

export type Facing = 'down' | 'up' | 'left' | 'right';

/** High-level anim states driven by facing + input / combat. */
export type AnimState = 'idle' | 'walk' | 'attack' | 'hurt' | 'faint';

export type CharacterStats = {
  maxHp: number;
  /** Stub for Phase 2 combat scaling. */
  str: number;
  speed: number;
};

/** Stub — Phase 2 charge / loot / weapon types. */
export type WeaponPermissions = {
  allowedTypes: string[];
};

/**
 * Atlas + anim key wiring. Shared FourDirAnimController swaps sheets via this.
 * Frame names match extracted atlases (walk_down_0, attack_left_2, death_4, …).
 */
export type AnimSetKeys = {
  /** Phaser texture atlas key */
  atlas: string;
  /** Anim registry prefix, e.g. "eric" → eric-walk-down */
  prefix: string;
  /** Select-screen / spawn preview frame */
  previewFrame: string;
  /** Idle still frames per facing (right often mirrors walk_left_0). */
  idleFrames: Record<Facing, string>;
  /** Final frame held after faint/death anim */
  deathLastFrame: string;
};

export type ActiveSkillKind = 'dash_smash' | 'arc_bolt' | 'shadow_flurry' | 'rain_of_arrows';

export type ActiveSkillDef = {
  id: string;
  /** HK Traditional Chinese label shown on HUD */
  labelZh: string;
  cooldownMs: number;
  kind: ActiveSkillKind;
};

export type PlayerData = {
  id: string;
  label: string;
  subtitle: string;
  stats: CharacterStats;
  weapons: WeaponPermissions;
  anim: AnimSetKeys;
  /** Primary active skill (Q / SKILL). Stub slots can be added later. */
  activeSkill: ActiveSkillDef;
  /**
   * Basic attack shape. Omit or `'melee'` for a contact slash.
   * `'bow'` fires ranged arrows on release (no melee hitbox).
   */
  basicAttack?: 'melee' | 'bow';
};

/**
 * Flat view used by SelectScene / BootScene / HUD.
 * Derived from PlayerData so UI keeps working without rewriting call sites.
 */
export type HeroDef = {
  id: string;
  atlas: string;
  anim: string;
  label: string;
  subtitle: string;
  maxHp: number;
  speed: number;
  previewFrame: string;
  /** Full data module (stats, weapons, anim set). */
  data: PlayerData;
};

export function playerDataToHeroDef(data: PlayerData): HeroDef {
  return {
    id: data.id,
    atlas: data.anim.atlas,
    anim: data.anim.prefix,
    label: data.label,
    subtitle: data.subtitle,
    maxHp: data.stats.maxHp,
    speed: data.stats.speed,
    previewFrame: data.anim.previewFrame,
    data,
  };
}
