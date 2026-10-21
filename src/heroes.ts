/** Playable classes — atlases by Claire Starsword (Spriters Resource). */
export type HeroId = 'eric' | 'prim' | 'raizen';

export type HeroDef = {
  id: HeroId;
  /** Phaser atlas key */
  atlas: string;
  /** Animation key prefix, e.g. eric-walk-down */
  anim: string;
  label: string;
  subtitle: string;
  maxHp: number;
  speed: number;
  /** Idle/preview frame in atlas */
  previewFrame: string;
};

export const HEROES: Record<HeroId, HeroDef> = {
  eric: {
    id: 'eric',
    atlas: 'eric',
    anim: 'eric',
    label: 'Eric',
    subtitle: 'Warrior · balanced',
    maxHp: 5,
    speed: 110,
    previewFrame: 'walk_down_0',
  },
  prim: {
    id: 'prim',
    atlas: 'prim',
    anim: 'prim',
    label: 'Prim',
    subtitle: 'Priestess · +HP',
    maxHp: 7,
    speed: 100,
    previewFrame: 'walk_down_0',
  },
  raizen: {
    id: 'raizen',
    atlas: 'raizen',
    anim: 'raizen',
    label: 'Raizen',
    subtitle: 'Ninja · +speed',
    maxHp: 4,
    speed: 135,
    previewFrame: 'walk_down_0',
  },
};

export const HERO_ORDER: HeroId[] = ['eric', 'prim', 'raizen'];

export const SELECTED_HERO_KEY = 'selectedHero';

export function getHero(id: HeroId | string | undefined): HeroDef {
  if (id && id in HEROES) return HEROES[id as HeroId];
  return HEROES.eric;
}
