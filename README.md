# Shining Soul II Web Prototype / 光明之魂2 網頁學習原型

Personal / fan **learning** remake of **GBA Shining Soul II（光明之魂2）** with **Phaser 3 + Vite + TypeScript**.

個人／粉絲向 **學習用** 重製原型（Phaser 3 + Vite + TypeScript）。**非商業**；僅供本機學習，請勿打包發行受版權保護的素材包。

> Shining Soul II © SEGA / original rights holders.  
> 光明之魂2 版權歸 SEGA 及原權利方所有。本倉庫為綠色學習原型，不附帶 ROM。

---

## How to run / 如何運行

```bash
cd shining-soul-2-web   # or /workspace/shining-soul-2-web
npm install
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173**).  
瀏覽器打開終端裏 Vite 打印的地址（預設 **http://localhost:5173**）。

```bash
npm run build    # production → dist/
npm run preview  # serve dist/
```

Optional asset regen（可選資源重切）:

```bash
python3 tools/extract_eric.py
python3 tools/extract_prim.py
python3 tools/extract_raizen.py
python3 tools/extract_paste.py
python3 tools/extract_gully.py
python3 tools/make_dungeon_map.py
python3 tools/gen_placeholder_audio.py
```

---

## Controls / 操作

Desktop adds **Q** for the active skill. Touch controls appear only on touch-capable devices (joystick + buttons, fixed to the screen) and include **技**. Keyboard and touch can be used together.
桌面新增 **Q** 主動技能。可觸屏時才顯示搖桿和按鈕（不隨鏡頭滾動），並含 **技**。兩者可同時使用。

### Character select / 選角（SelectScene）

| Input / 按鍵 | Action / 作用 |
|--------------|---------------|
| **1** | Eric（Warrior） |
| **2** | Prim（Priestess） |
| **3** | Raizen（Ninja） |
| **Tap / Click** card | Select + start / 點選或點擊並進入地牢 |
| **Enter** / **Space** | Confirm selected class / 確認當前高亮角色 |

### In dungeon — desktop / 地牢內（鍵盤）

| Input / 按鍵 | Action / 作用 |
|--------------|---------------|
| **WASD** / **Arrow keys** | Move / 四向移動 |
| **Space** / **Z** | Tap = attack; **hold** = charge 1–3 (cyan→yellow→red) / 輕點攻擊；**長按**蓄力 1–3 段（青→黃→紅） |
| **Q** | Active skill / 主動技能（冷卻） |
| **E**（near chest） | Open the chest room chest / 開寶箱房寶箱 |
| **Space**（when chest prompt shows） | Same as **E** / 有提示時等同開箱（不揮刀） |
| Walk into **door** | Fade + teleport to the linked room / 淡入淡出傳送到相連房間 |
| Walk into **出口**（after boss） | Stage Clear overlay / Boss 擊破後走進出口，顯示關卡清除 |
| **M** | Mute / unmute SFX + BGM / 靜音開關（鍵盤） |
| **R** | Restart dungeon（same class）/ 重開地牢（保留職業） |
| **Esc** | Back to character select / 返回選角 |
| Click / tap（on GAME OVER） | Restart / 遊戲結束後點擊或點按重開 |
| **關卡清除** buttons | **重新開始** / **選角** / **繼續**（繼續只關掉面板） |

### Mobile touch / 觸屏

Shown when the device reports touch (`maxTouchPoints`, a coarse pointer, or Phaser touch). Hidden on desktop-only browsers.
僅在可觸屏時顯示；純桌面瀏覽器不顯示。

| Control / 控件 | Action / 作用 |
|----------------|---------------|
| Joystick（bottom-left / 左下） | Move / 移動（鬆開歸零，拖出底盤仍有效） |
| **ATK**（bottom-right / 右下） | Tap or **hold** to charge / 輕點或**長按**蓄力（同 Space / Z） |
| **技**（above **E** / E 上方） | Active skill / 主動技能（同 **Q**，有冷卻） |
| **E**（beside ATK / 攻擊鍵旁） | Open chest / 開箱（同鍵盤 E） |
| **R**（top-right / 右上） | Restart / 重開 |
| **☰** | Back to select / 返回選角（同 Esc） |

Mute stays on the **M** key / 靜音仍用 **M** 鍵。

---

## Current features / 當前功能

Accurate to the code — nothing beyond what is implemented.  
以下均與現有代碼一致，未寫未實現內容。

### Flow / 流程

1. **BootScene** — load atlases, tilemap, placeholder audio, register anims  
2. **SelectScene** — pick Eric / Prim / Raizen  
3. **GameScene** — one stage: entry → corridor → chest, then boss arena → exit

### Heroes / 可玩角色

| Class | HP | Speed | Notes |
|-------|----|-------|-------|
| **Eric** Warrior | 5 | 110 | Balanced / 均衡 |
| **Prim** Priestess | **7** | 100 | More HP / 更高生命 |
| **Raizen** Ninja | 4 | **135** | Faster / 更快移動 |

Each has walk + attack + hurt + death anims from their atlas（各有行走／攻擊／受傷／死亡動畫）.

Each hero has one active skill（主動技能，**Q** / **技**，HUD 顯示冷卻）:
- **Eric** — 強力斬擊（前衝＋範圍重擊）
- **Prim** — 奧術飛彈（直線飛彈）
- **Raizen** — 影襲連斬（三連斬）

### Combat / 戰鬥

- **Entry / 營地大廳**: **1×** weak Paste (HP 2). Player spawns here, away from the boss.  
  入口營地：1 隻弱 Paste（HP 2）。玩家在此出生，不與 Boss 同房。
- **Corridor / 戰鬥迴廊**: **3× Paste** (HP 3, chase ~150px, melee 1 dmg). Links entry, chest, and the boss door.  
  戰鬥迴廊：3 隻 Paste（HP 3）。連接入口、寶箱與 Boss 門。
- **Chest / 寶箱房**: **1×** weaker Paste (HP 2) + openable chest  
  寶箱房：1 隻弱 Paste（HP 2）+ 可開寶箱
- **Boss / 競技場**: **Captain Gully** alone (HP 14, melee **2** dmg + short lunge). Defeat opens the **出口**.  
  Boss 房只有蓋利隊長（HP 14，傷害 2）。擊破後開啟出口。
- Walk into the exit → **關卡清除** overlay（重新開始 / 選角 / 繼續）  
  走進出口顯示關卡清除
- Spawn grace ~2s so a fresh run is not contact-killed  
  出生約 2 秒無敵，避免一進場被貼臉擊倒
- Player HP HUD; at 0 → GAME OVER  
  玩家血量 HUD；歸零遊戲結束
- Pastes / Gully: tile **A\*** pathfinding (~0.4–0.45s repath) around walls/pillars; axis-slide fallback  
  敵人沿牆格 A* 繞柱，失敗則軸向滑動

### World / 地圖

- One Tiled map **144×64** @ 16px → **2304×1024**. Top row: entry | corridor | boss arena (each 48×32). Chest room sits under the corridor.  
  單張四區地圖；鏡頭按房間夾取
- Clear path: **entry → corridor → chest**, and **corridor → boss → 出口**  
  通關路線：入口 → 迴廊 → 寶箱房，以及迴廊 → Boss → 出口
- Wall collision on `walls` layer; wooden door tiles + door objects teleport with fade  
  牆體碰撞；木門傳送帶淡入淡出
- Chest room: once per run → **+2 HP** (capped) + **25 gold** (HUD toast); resets on **R**  
  寶箱每局一次：回血 + 金幣；**R** 重置
- After Gully dies, a glowing **出口** appears on the arena's north side. Overlap opens the stage-clear DOM (`data-testid=stageclear-overlay`). **繼續** dismisses it.  
  蓋利擊破後，競技場北側出現發光出口。走進後顯示關卡清除；繼續只關閉面板。

### Audio / 音頻

- Placeholder procedural OGG/WAV（not SS2 rips）: slash, hit, chest, door, hurt, boss defeat, looping soft BGM  
  程序生成佔位音效／BGM（非原作扒曲）
- **M** mutes; browsers may need one tap, click, or key before BGM (autoplay)  
  **M** 靜音；部分瀏覽器需先點一下或按鍵才播 BGM

---

## Asset credits / 素材致謝

Fan learning only — sheets from [The Spriters Resource](https://www.spriters-resource.com/) (Shining Soul II).  
僅供粉絲學習，精靈表來自 The Spriters Resource。

| Asset | Credit |
|-------|--------|
| Eric, Prim, Raizen, Paste | **Claire Starsword** |
| Captain Gully | **darkbolt99** |
| Dungeon tiles (`dungeon-tiles.png`) | **Original placeholders** (Spriters has no SS2 map tiles) / 自繪佔位地磚 |
| Audio under `public/assets/audio/` | Procedural placeholders (`tools/gen_placeholder_audio.py`) / 程序佔位 |

To swap music later: drop GBAMusRippy (or custom) files into `public/assets/audio/` using the **same keys/filenames** (`sfx-slash`, `sfx-hit`, `sfx-chest`, `sfx-door`, `sfx-hurt`, `sfx-boss`, `bgm-dungeon`) — see `src/audio/GameAudio.ts`.  
日後可用 GBAMusRippy 等替換同名文件，無需改鍵名。

---

## Phase 1 architecture / 第一階段架構

Mechanics are decoupled from character data so a future hero is mostly **new data + atlas**, not a rewrite of `Player`.
機制與角色資料分離：日後加新英雄大致只要 **新資料檔 + 圖集**，不必重寫 `Player`。

| Piece / 模組 | Role / 作用 |
|--------------|-------------|
| `CharacterBase` | Shared move / collide / hurt / HP / facing · 共用移動、碰撞、受傷、生命、朝向 |
| `PlayerBase` / `EnemyBase` | Player & enemy extensions · 玩家／敵人延伸 |
| `data/players/*.ts` (`PlayerData`) | id, stats (HP/STR/speed), weapon stub, anim set keys, active skill · 角色資料＋主動技能 |
| `FourDirAnimController` | Idle/Walk/Attack/Hurt/Faint by facing · 四向動畫狀態機（依朝向） |
| `Player` | Thin wrapper: one class + swap `PlayerData` · 薄包裝，換資料即可換角 |


## Phase 2 — Charge & loot / 第二階段 — 蓄力與掉落

### Charge attack / 蓄力攻擊
- Hold **Space / Z / ATK** → stages **1–3** with a charge ring (**cyan → yellow → red**).
- Release fires a larger hitbox; damage uses `stats.str` + gear + stage:
  `max(1, floor((str + gearDamage + stage*2) / 2))`.
- Quick tap (release before stage 1) = normal slash.
- 長按蓄力；鬆開揮砍。輕點（未到第 1 段）＝普通攻擊。傷害接 `str`／裝備／段數。

### Loot affixes / 詞綴掉落
- Diablo-like **prefix + suffix** data in `src/data/loot/` (JSON-friendly TS).
- Chest always rolls 1 item (prefers hero weapon type) + HP/gold; Paste ~28% / Boss ~55% drop.
- Names: EN + 香港繁體（例：「鋒利鐵劍之力量」）.
- `Inventory` stub auto-equips best weapon; mods apply to damage/speed/str; HUD shows bag + equipped.
- 寶箱必出一件；敵人有機率掉落。背包自動裝備最高傷害武器。

## Project structure / 目錄結構

```
shining-soul-2-web/
├── index.html
├── package.json              # phaser@3.90.0, vite, typescript
├── README.md
├── tools/
│   ├── extract_eric.py       # warrior atlas
│   ├── extract_prim.py       # priestess atlas
│   ├── extract_raizen.py     # ninja atlas
│   ├── extract_paste.py
│   ├── extract_gully.py
│   ├── make_dungeon_map.py   # tiles + 144×64 four-room JSON
│   └── gen_placeholder_audio.py
├── public/assets/
│   ├── eric-warrior.png | prim-priestess.png | raizen-ninja.png
│   ├── paste.png | captain-gully.png
│   ├── generated/*-atlas.{png,json}
│   ├── maps/dungeon-room.json + dungeon-tiles.png
│   └── audio/*.ogg           # placeholder SFX + BGM
└── src/
    ├── main.ts
    ├── heroes.ts             # deprecated re-export → data/players
    ├── data/
    │   ├── types.ts          # PlayerData, Facing, AnimSetKeys, …
    │   ├── players/          # eric.ts / prim.ts / raizen.ts + index
    │   └── loot/             # bases, affixes, rollItem (Phase 2)
    ├── systems/
    │   └── Inventory.ts      # bag + auto-equip weapon
    ├── anim/
    │   └── FourDirAnimController.ts
    ├── audio/GameAudio.ts
    ├── ai/TilePathfinder.ts  # grid A* + PathFollower
    ├── input/InputState.ts   # keyboard + touch → one frame (incl. Q / 技)
    ├── ui/TouchControls.ts   # on-screen stick + ATK / 技 / E / R / ☰
    ├── ui/GameOverDom.ts     # DOM game-over overlay
    ├── ui/StageClearDom.ts   # DOM 關卡清除 overlay
    ├── scenes/
    │   ├── BootScene.ts
    │   ├── SelectScene.ts
    │   └── GameScene.ts
    └── entities/
        ├── CharacterBase.ts
        ├── PlayerBase.ts
        ├── Player.ts         # thin PlayerBase wrapper
        ├── EnemyBase.ts
        ├── Enemy.ts          # Paste
        └── Boss.ts           # Captain Gully
```

Edit the map in [Tiled](https://www.mapeditor.org/): open `public/assets/maps/dungeon-room.json` (or `.tmj`), paint `walls`, move `spawns` objects, save JSON, refresh Vite.  
可用 Tiled 編輯地圖後刷新即可。

---

## Suggested next ideas / 建議下一步

Ideas only — not implemented yet.  
僅為想法，下列尚未實現：

### Done in Phase 2 / 第二階段已完成
Charge stages + STR damage; affix loot + inventory stub.  
蓄力段數＋力量傷害；詞綴掉落＋背包 stub。

### Done — active skill stub / 主動技能 stub 已完成
One active skill per hero + cooldown HUD（**Q** / **技**）. Not a skill tree.  
每位英雄一個主動技能＋冷卻 HUD。不是技能樹。
- Eric 強力斬擊 · Prim 奧術飛彈 · Raizen 影襲連斬

### Done — stage path / 關卡路線已完成
Entry, combat corridor, chest room, boss arena, and an exit portal that opens **關卡清除**.  
入口、戰鬥迴廊、寶箱房、Boss 競技場，以及通往關卡清除的出口。

### Next ideas / 下一步想法
1. Full inventory UI (equip/compare) · 完整背包介面  
2. Stairs / a second stage · 樓梯／第二關  
3. Distinct Prim / Raizen charge VFX · 職業蓄力特效  
4. Persist gold / bag across **R** · 跨重開保留金幣／背包  
5. Wizard = new `data/players/*.ts` + atlas · 新職業資料檔  
6. Skill tree / extra skill slots · 技能樹／額外技能槽  

---

## License / 聲明

Greenfield learning prototype on your own machine. Do **not** redistribute copyrighted sprite or audio packs commercially.

本機綠色學習原型。**禁止**將受版權保護的精靈／音頻打包作商業分發。

---

## GitHub Pages / 線上試玩

After push to `main`, GitHub Actions builds `dist/` and deploys Pages.

推到 `main` 後 Actions 會構建並部署。預計地址：

**https://kingsleykwan.github.io/Shining-Soul-2/**

Repo → Settings → Pages → Source: **GitHub Actions**（若尚未開啟）.

First visit may need a tap or click for audio (browser autoplay).
