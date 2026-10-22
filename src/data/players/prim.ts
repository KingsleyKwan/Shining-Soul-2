import type { PlayerData } from '../types';

/** Priestess — higher HP, slightly slower. Atlas: Claire Starsword @ Spriters Resource. */
export const PRIM_DATA: PlayerData = {
  id: 'prim',
  label: 'Prim',
  subtitle: 'Priestess · +HP',
  stats: { maxHp: 7, str: 2, speed: 100 },
  weapons: { allowedTypes: ['staff'] },
  anim: {
    atlas: 'prim',
    prefix: 'prim',
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
