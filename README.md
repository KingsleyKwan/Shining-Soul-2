# Shining Soul II Web Prototype / 光明之魂2 网页学习原型

Personal / fan **learning** remake of **GBA Shining Soul II（光明之魂2）** with **Phaser 3 + Vite + TypeScript**.

个人／粉丝向 **学习用** 重制原型（Phaser 3 + Vite + TypeScript）。**非商业**；仅供本机学习，请勿打包发行受版权保护的素材包。

> Shining Soul II © SEGA / original rights holders.  
> 光明之魂2 版权归 SEGA 及原权利方所有。本仓库为绿色学习原型，不附带 ROM。

---

## How to run / 如何运行

```bash
cd shining-soul-2-web   # or /workspace/shining-soul-2-web
npm install
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173**).  
浏览器打开终端里 Vite 打印的地址（默认 **http://localhost:5173**）。

```bash
npm run build    # production → dist/
npm run preview  # serve dist/
```

Optional asset regen（可选资源重切）:

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

Desktop keys are unchanged. Touch controls appear only on touch-capable devices (joystick + buttons, fixed to the screen). Keyboard and touch can be used together.
桌面键位不变。可触屏时才显示摇杆和按钮（不随镜头滚动）。两者可同时使用。

### Character select / 选角（SelectScene）

| Input / 按键 | Action / 作用 |
|--------------|---------------|
| **1** | Eric（Warrior） |
| **2** | Prim（Priestess） |
| **3** | Raizen（Ninja） |
| **Tap / Click** card | Select + start / 点选或点击并进入地牢 |
| **Enter** / **Space** | Confirm selected class / 确认当前高亮角色 |

### In dungeon — desktop / 地牢内（键盘）

| Input / 按键 | Action / 作用 |
|--------------|---------------|
| **WASD** / **Arrow keys** | Move / 四向移动 |
| **Space** / **Z** | Attack (short hitbox) / 攻击（短判定框） |
| **E**（near chest） | Open Room B chest / 开 B 房宝箱 |
| **Space**（when chest prompt shows） | Same as **E** / 有提示时等同开箱（不挥刀） |
| Walk into **door** | Fade + teleport to other room / 淡入淡出传送 |
| **M** | Mute / unmute SFX + BGM / 静音开关（键盘） |
| **R** | Restart dungeon（same class）/ 重开地牢（保留职业） |
| **Esc** | Back to character select / 返回选角 |
| Click / tap（on GAME OVER） | Restart / 游戏结束后点击或点按重开 |

### Mobile touch / 触屏

Shown when the device reports touch (`maxTouchPoints`, a coarse pointer, or Phaser touch). Hidden on desktop-only browsers.
仅在可触屏时显示；纯桌面浏览器不显示。

| Control / 控件 | Action / 作用 |
|----------------|---------------|
| Joystick（bottom-left / 左下） | Move / 移动（松开归零，拖出底盘仍有效） |
| **ATK**（bottom-right / 右下） | Attack / 攻击（同 Space / Z，点按一次） |
| **E**（beside ATK / 攻击键旁） | Open chest / 开箱（同键盘 E） |
| **R**（top-right / 右上） | Restart / 重开 |
| **☰** | Back to select / 返回选角（同 Esc） |

Mute stays on the **M** key / 静音仍用 **M** 键。

---

## Current features / 当前功能

Accurate to the code — nothing beyond what is implemented.  
以下均与现有代码一致，未写未实现内容。

### Flow / 流程

1. **BootScene** — load atlases, tilemap, placeholder audio, register anims  
2. **SelectScene** — pick Eric / Prim / Raizen  
3. **GameScene** — two-room dungeon

### Heroes / 可玩角色

| Class | HP | Speed | Notes |
|-------|----|-------|-------|
| **Eric** Warrior | 5 | 110 | Balanced / 均衡 |
| **Prim** Priestess | **7** | 100 | More HP / 更高生命 |
| **Raizen** Ninja | 4 | **135** | Faster / 更快移动 |

Each has walk + attack + hurt + death anims from their atlas（各有行走／攻击／受伤／死亡动画）.

### Combat / 战斗

- Room A: **2× Paste** (HP 3, chase ~150px, melee 1 dmg) + boss **Captain Gully** (HP 14, melee **2** dmg + short lunge)  
  A 房：2 只 Paste（HP 3）+ Boss 盖利队长（HP 14，伤害 2）
- Room B: **1×** weaker Paste (HP 2) + openable chest  
  B 房：1 只弱 Paste（HP 2）+ 可开宝箱
- Player HP HUD; at 0 → GAME OVER  
  玩家血量 HUD；归零游戏结束
- Pastes / Gully: tile **A\*** pathfinding (~0.4–0.45s repath) around walls/pillars; axis-slide fallback  
  敌人沿墙格 A* 绕柱，失败则轴向滑动

### World / 地图

- One Tiled map **80×28** @ 16px → **1280×448** (Room A | Room B)  
  单张双室地图；镜头按房间夹取
- Wall collision on `walls` layer; wooden door tiles + door objects teleport with fade  
  墙体碰撞；木门传送带淡入淡出
- Room B chest: once per run → **+2 HP** (capped) + **25 gold** (HUD toast); resets on **R**  
  宝箱每局一次：回血 + 金币；**R** 重置

### Audio / 音频

- Placeholder procedural OGG/WAV（not SS2 rips）: slash, hit, chest, door, hurt, boss defeat, looping soft BGM  
  程序生成占位音效／BGM（非原作扒曲）
- **M** mutes; browsers may need one tap, click, or key before BGM (autoplay)  
  **M** 静音；部分浏览器需先点一下或按键才播 BGM

---

## Asset credits / 素材致谢

Fan learning only — sheets from [The Spriters Resource](https://www.spriters-resource.com/) (Shining Soul II).  
仅供粉丝学习，精灵表来自 The Spriters Resource。

| Asset | Credit |
|-------|--------|
| Eric, Prim, Raizen, Paste | **Claire Starsword** |
| Captain Gully | **darkbolt99** |
| Dungeon tiles (`dungeon-tiles.png`) | **Original placeholders** (Spriters has no SS2 map tiles) / 自绘占位地砖 |
| Audio under `public/assets/audio/` | Procedural placeholders (`tools/gen_placeholder_audio.py`) / 程序占位 |

To swap music later: drop GBAMusRippy (or custom) files into `public/assets/audio/` using the **same keys/filenames** (`sfx-slash`, `sfx-hit`, `sfx-chest`, `sfx-door`, `sfx-hurt`, `sfx-boss`, `bgm-dungeon`) — see `src/audio/GameAudio.ts`.  
日后可用 GBAMusRippy 等替换同名文件，无需改键名。

---

## Project structure / 目录结构

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
│   ├── make_dungeon_map.py   # tiles + 80×28 two-room JSON
│   └── gen_placeholder_audio.py
├── public/assets/
│   ├── eric-warrior.png | prim-priestess.png | raizen-ninja.png
│   ├── paste.png | captain-gully.png
│   ├── generated/*-atlas.{png,json}
│   ├── maps/dungeon-room.json + dungeon-tiles.png
│   └── audio/*.ogg           # placeholder SFX + BGM
└── src/
    ├── main.ts
    ├── heroes.ts             # Eric / Prim / Raizen stats
    ├── audio/GameAudio.ts
    ├── ai/TilePathfinder.ts  # grid A* + PathFollower
    ├── input/InputState.ts   # keyboard (if any) + touch → one frame
    ├── ui/TouchControls.ts   # on-screen stick + ATK / E / R / ☰
    ├── scenes/
    │   ├── BootScene.ts
    │   ├── SelectScene.ts
    │   └── GameScene.ts
    └── entities/
        ├── Player.ts
        ├── Enemy.ts          # Paste
        └── Boss.ts           # Captain Gully
```

Edit the map in [Tiled](https://www.mapeditor.org/): open `public/assets/maps/dungeon-room.json` (or `.tmj`), paint `walls`, move `spawns` objects, save JSON, refresh Vite.  
可用 Tiled 编辑地图后刷新即可。

---

## Suggested next ideas / 建议下一步

Ideas only — not implemented yet.  
仅为想法，下列尚未实现：

1. More rooms / stairs / simple loot table beyond one chest  
   更多房间／楼梯／掉落表
2. Distinct Prim / Raizen attack VFX (staff / shuriken feel) while keeping Space/Z  
   职业差异化攻击表现（仍用 Space/Z）
3. Replace placeholder BGM/SFX with GBAMusRippy tracks for personal testing  
   个人测试用原曲替换占位音频
4. Save selected class + gold across **R** (or a soft continue)  
   跨重开保留职业／金币
5. Tune attack frame picks / optional 8-dir from the same sheets  
   微调攻击帧／可选八向
6. Wizard / other class sheets if ripped for personal use  
   其他职业表（仅限个人学习素材）

---

## License / 声明

Greenfield learning prototype on your own machine. Do **not** redistribute copyrighted sprite or audio packs commercially.

本机绿色学习原型。**禁止**将受版权保护的精灵／音频打包作商业分发。

---

## GitHub Pages / 线上试玩

After push to `main`, GitHub Actions builds `dist/` and deploys Pages.

推到 `main` 后 Actions 会构建并部署。预计地址：

**https://kingsleykwan.github.io/Shining-Soul-2/**

Repo → Settings → Pages → Source: **GitHub Actions**（若尚未开启）.

First visit may need a tap or click for audio (browser autoplay).
