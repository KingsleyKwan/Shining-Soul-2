import { playerDataToHeroDef, type HeroDef, type PlayerData } from '../types';
import { ERIC_DATA } from './eric';
import { PRIM_DATA } from './prim';
import { RAIZEN_DATA } from './raizen';

export type HeroId = 'eric' | 'prim' | 'raizen';

export const PLAYER_DATA: Record<HeroId, PlayerData> = {
  eric: ERIC_DATA,
  prim: PRIM_DATA,
  raizen: RAIZEN_DATA,
};

/** Flat HeroDef registry (SelectScene / BootScene / GameScene). */
export const HEROES: Record<HeroId, HeroDef> = {
  eric: playerDataToHeroDef(ERIC_DATA),
  prim: playerDataToHeroDef(PRIM_DATA),
  raizen: playerDataToHeroDef(RAIZEN_DATA),
};

export const HERO_ORDER: HeroId[] = ['eric', 'prim', 'raizen'];

export const SELECTED_HERO_KEY = 'selectedHero';

export function getPlayerData(id: HeroId | string | undefined): PlayerData {
  if (id && id in PLAYER_DATA) return PLAYER_DATA[id as HeroId];
  return PLAYER_DATA.eric;
}

export function getHero(id: HeroId | string | undefined): HeroDef {
  if (id && id in HEROES) return HEROES[id as HeroId];
  return HEROES.eric;
}

export type { PlayerData, HeroDef };
export { ERIC_DATA, PRIM_DATA, RAIZEN_DATA };
