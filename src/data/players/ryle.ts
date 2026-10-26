import type { PlayerData } from '../types';

/** Archer — ranged basic, clearable HP. Atlas: recolored Claire Starsword sheet. */
export const RYLE_DATA: PlayerData = {
  id: 'ryle',
  label: '萊爾',
  subtitle: '弓箭手 · 遠攻',
  stats: { maxHp: 4, str: 3, speed: 125 },
  weapons: { allowedTypes: ['bow'] },
  basicAttack: 'bow',
  activeSkill: {
    id: 'rain_of_arrows',
    labelZh: '箭雨',
    cooldownMs: 2600,
    kind: 'rain_of_arrows',
  },
  anim: {
    atlas: 'ryle',
    prefix: 'ryle',
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
