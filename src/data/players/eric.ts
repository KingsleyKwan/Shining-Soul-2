import type { PlayerData } from '../types';

/** Warrior — balanced HP / speed. Atlas: Claire Starsword @ Spriters Resource. */
export const ERIC_DATA: PlayerData = {
  id: 'eric',
  label: 'Eric',
  subtitle: 'Warrior · balanced',
  stats: { maxHp: 5, str: 3, speed: 110 },
  weapons: { allowedTypes: ['sword'] },
  anim: {
    atlas: 'eric',
    prefix: 'eric',
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
