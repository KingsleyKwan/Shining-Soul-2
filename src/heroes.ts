/**
 * @deprecated Import from `./data/players` instead.
 * Thin re-export so older paths keep compiling during Phase 1.
 */
export {
  HEROES,
  HERO_ORDER,
  SELECTED_HERO_KEY,
  getHero,
  getPlayerData,
  PLAYER_DATA,
  type HeroId,
} from './data/players';
export type { HeroDef, PlayerData } from './data/types';
