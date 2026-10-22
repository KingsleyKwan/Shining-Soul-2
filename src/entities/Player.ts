import type Phaser from 'phaser';
import { getHero } from '../data/players';
import type { HeroDef } from '../data/types';
import { PlayerBase, type PlayerInput } from './PlayerBase';

export type { PlayerInput };
export type { Facing } from '../data/types';

/**
 * Playable hero wrapper — Eric / Prim / Raizen via PlayerData.
 * Prefer extending PlayerBase for new hero mechanics; swap sheets with data + atlas.
 */
export class Player extends PlayerBase {
  constructor(scene: Phaser.Scene, x: number, y: number, hero?: HeroDef) {
    super(scene, x, y, hero ?? getHero('eric'));
  }
}
