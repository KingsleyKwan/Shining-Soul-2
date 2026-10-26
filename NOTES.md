# Stage slice — fuller map + stage clear

## How to clear the stage

1. Start in **Entry · 營地大廳** (west). One weak Paste; the boss is not in this room.
2. Walk into the east door → **Corridor · 戰鬥迴廊** (three Pastes).
3. South door → **Chest · 寶箱房**. Press **E** (or Space while the prompt shows) to open the chest. North door returns to the corridor.
4. East door from the corridor → **Boss · 競技場**. Defeat **Captain Gully / 蓋利隊長** alone in that room.
5. A toast says `蓋利隊長已擊破 · 出口已開啟`. A glowing circle labeled **出口** appears on the north side of the arena.
6. Walk into the exit. The **關卡清除** overlay opens (`data-testid=stageclear-overlay`).
   - **重新開始** or **R** — restart the dungeon, same class
   - **選角** or **Esc** — back to character select
   - **繼續** — dismiss the panel and keep walking (step off the exit to re-trigger it)

Spawn grace is about 2 seconds. Pastes are placed off the door tiles so the openings stay walkable.

## Map

144×64 tiles @ 16px → 2304×1024. Regen with:

```bash
python3 tools/make_dungeon_map.py
```

That rewrites `public/assets/maps/dungeon-room.json` and `dungeon-room.tmj` plus `dungeon-tiles.png`. Runtime rooms use MapGenerator; BootScene loads `dungeon-tiles` only (room JSON stripped from dist).

Room rects are map properties `roomA`, `roomC`, `roomB`, `roomBoss` (`x,y,w,h` pixels).

## Files touched

- `tools/make_dungeon_map.py` — four-room layout, door links, spawn/aggro checks
- `public/assets/maps/dungeon-room.json`
- `public/assets/maps/dungeon-room.tmj`
- `public/assets/maps/dungeon-tiles.png` — same procedural tiles, regenerated
- `src/ui/StageClearDom.ts` — new DOM overlay
- `src/scenes/GameScene.ts` — multi-room camera, spawns, exit portal, stage clear
- `README.md` — controls, features, world, map size
