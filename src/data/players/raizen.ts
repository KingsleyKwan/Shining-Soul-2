import type { PlayerData } from '../types';

/** Ninja — lower HP, higher speed. Atlas: Claire Starsword @ Spriters Resource. */
export const RAIZEN_DATA: PlayerData = {
  id: 'raizen',
  label: 'Raizen',
  subtitle: 'Ninja · +speed',
  stats: { maxHp: 4, str: 3, speed: 135 },
  weapons: { allowedTypes: ['kunai'] },
  activeSkill: {
    id: 'shadow_flurry',
    labelZh: '影襲連斬',
    cooldownMs: 2500,
    kind: 'shadow_flurry',
  },
  anim: {
    atlas: 'raizen',
    prefix: 'raizen',
    previewFrame: 'walk_down_0',
    idleFrames: {
      down: 'walk_down_0',
      up: 'walk_up_0',
      left: 'walk_left_0',
      right: 'walk_left_0',
    },
    deathLastFrame: 'death_4',
  },
};
