import Phaser from 'phaser';
import { FourDirAnimController } from '../anim/FourDirAnimController';
import { GameAudio } from '../audio/GameAudio';
import { HEROES, SELECTED_HERO_KEY, type HeroId } from '../data/players';
import { SELECTED_STAGE_KEY, getStage, type StageId } from '../data/stages';
import { InputState } from '../input/InputState';
import * as SaveManager from '../systems/SaveManager';
import { TouchControls, UI_DEPTH } from '../ui/TouchControls';

type NpcKind = 'king' | 'girl' | null;

type InteractId = 'king' | 'girl' | 'signpost' | 'northGate' | 'southGate';

type Interactable = {
  id: InteractId;
  x: number;
  y: number;
  radius: number;
  /** Name plate shown while in zone (empty = CTA-only). */
  name: string;
  /** Action pill label. */
  pill: string;
  /** Pill fill colour. */
  pillFill: number;
  /** Pill stroke. */
  pillStroke: number;
  onInteract: () => void;
};

type HubLayout = {
  cx: number;
  plazaTop: number;
  plazaBottom: number;
  pathHalf: number;
  king: { x: number; y: number };
  girl: { x: number; y: number };
  signpost: { x: number; y: number };
  fountain: { x: number; y: number };
  northGate: { x: number; y: number };
  southGate: { x: number; y: number };
  spawn: { x: number; y: number };
};

const HUB_SPEED = 130;
const PLAYER_SCALE = 2;

/**
 * 葛蘭多爾城 lite — one-screen walkable courtyard hub.
 * Approach NPCs / gates / signpost for talk zones; no floating option buttons.
 */
export class VillageScene extends Phaser.Scene {
  private dialogueBox?: Phaser.GameObjects.Container;
  private dialogueSpeaker?: Phaser.GameObjects.Text;
  private dialogueBody?: Phaser.GameObjects.Text;
  private activeNpc: NpcKind = null;
  private goblinCleared = false;
  /** Stage 3 is open once stage 2 has been cleared. */
  private shrineUnlocked = false;
  private heroId: HeroId = 'eric';
  private audio!: GameAudio;

  private touch!: TouchControls;
  private inputState!: InputState;
  private player?: Phaser.Physics.Arcade.Sprite;
  private animCtl?: FourDirAnimController;
  private blockers!: Phaser.Physics.Arcade.StaticGroup;
  private interactables: Interactable[] = [];
  private nearest: Interactable | null = null;
  private kingSprite?: Phaser.GameObjects.Sprite;
  private girlSprite?: Phaser.GameObjects.Sprite;
  private npcSoftTargets: { x: number; y: number; minDist: number }[] = [];

  private zoneGfx?: Phaser.GameObjects.Graphics;
  private namePill?: Phaser.GameObjects.Container;
  private actionPill?: Phaser.GameObjects.Container;
  private actionPillBg?: Phaser.GameObjects.Rectangle;
  private departHint?: Phaser.GameObjects.Text;

  constructor() {
    super('VillageScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#87c4ea');

    const saved = SaveManager.load();
    const flags = SaveManager.getFlags(saved);
    this.goblinCleared = flags.goblinCleared;
    this.shrineUnlocked = SaveManager.getUnlockedStages(saved).includes(3);
    const regHero = this.registry.get(SELECTED_HERO_KEY);
    this.heroId = SaveManager.isHeroId(regHero)
      ? regHero
      : saved?.heroId ?? 'eric';
    this.registry.set(SELECTED_HERO_KEY, this.heroId);

    if (saved) {
      SaveManager.save(
        SaveManager.withFlags(saved, { villageVisited: true, seenIntro: true }),
      );
    } else {
      SaveManager.save(
        SaveManager.makeFreshSave(this.heroId, {
          seenIntro: true,
          villageVisited: true,
        }),
      );
    }

    this.audio = GameAudio.attach(this);
    this.audio.startBgm('village');

    const layout = this.computeLayout(width, height);
    this.paintCourtyard(width, height, layout);
    this.buildBlockers(width, height, layout);
    this.placeNpcs(layout);
    this.placePlayer(layout);
    this.buildInteractables(layout);
    this.buildHud(width, height);
    this.buildDialogueOverlay();
    this.buildPillUi();

    this.touch = new TouchControls(this, { mode: 'hub' });
    this.inputState = new InputState(this);
    // Pills sit above the stick; topOnly so the stick zone cannot steal 對話 taps.
    this.input.setTopOnly(true);

    this.input.on('pointerdown', () => this.audio.ensurePlaying());

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => {
        if (this.activeNpc) this.closeDialogue();
        else {
          this.audio.confirm();
          this.scene.start('SelectScene');
        }
      });
      // Enter is not in InputState.interact — use it for talk / close.
      // Space/E come from InputState (and close dialogue here only).
      this.input.keyboard.on('keydown-ENTER', () => {
        if (this.activeNpc) this.closeDialogue();
        else this.tryInteract();
      });
      this.input.keyboard.on('keydown-SPACE', () => {
        if (this.activeNpc) this.closeDialogue();
      });
    }

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
  }

  update(_time: number, _delta: number): void {
    if (!this.player?.active) return;

    this.inputState.update(this.touch.poll());
    this.touch.layout();

    if (this.activeNpc) {
      this.player.setVelocity(0, 0);
      this.animCtl?.playIdle();
      this.hidePills();
      return;
    }

    const ix = this.inputState.moveX;
    const iy = this.inputState.moveY;
    let vx = 0;
    let vy = 0;
    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy) || 1;
      const mag = Math.min(1, len);
      const speed = HUB_SPEED * mag;
      vx = (ix / len) * speed;
      vy = (iy / len) * speed;
      this.animCtl?.updateFacingFromVector(vx, vy);
      this.animCtl?.playWalk(true);
    } else {
      this.animCtl?.playIdle();
    }
    this.player.setVelocity(vx, vy);
    this.applyNpcSoftSeparation();
    this.refreshDepthSort();

    this.refreshNearest();
    this.refreshPills();

    if (this.inputState.interactPressed) {
      this.tryInteract();
    }
  }

  private onResize(): void {
    this.touch?.layout();
  }

  private computeLayout(w: number, h: number): HubLayout {
    const cx = w / 2;
    const plazaTop = Math.round(h * 0.28);
    const plazaBottom = h - 28;
    return {
      cx,
      plazaTop,
      plazaBottom,
      pathHalf: 36,
      king: { x: cx - 78, y: plazaTop + 28 },
      girl: { x: Math.round(w * 0.22), y: Math.round(h * 0.52) },
      signpost: { x: cx + 72, y: plazaTop + 48 },
      fountain: { x: cx + 88, y: Math.round(h * 0.62) },
      northGate: { x: cx, y: plazaTop - 8 },
      southGate: { x: cx, y: plazaBottom - 4 },
      spawn: { x: cx, y: Math.round(h * 0.58) },
    };
  }

  private paintCourtyard(w: number, h: number, L: HubLayout): void {
    const g = this.add.graphics().setDepth(0);
    const cx = L.cx;

    // Sky
    g.fillStyle(0x8ec8ef, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0xc5e6f8, 1);
    g.fillRect(0, 0, w, 36);
    g.fillStyle(0xffe7a0, 1);
    g.fillCircle(w - 28, 22, 12);
    g.fillStyle(0xfff6d0, 1);
    g.fillCircle(w - 25, 19, 6);

    // Grass borders
    g.fillStyle(0x4c8c3c, 1);
    g.fillRect(0, 90, w, h - 90);
    g.fillStyle(0x3e7832, 1);
    for (let x = 0; x < w; x += 18) g.fillRect(x, 90, 8, h - 90);

    // North castle wall + towers
    const tower = (x: number) => {
      g.fillStyle(0x7a3030, 1);
      g.fillTriangle(x - 4, 50, x + 27, 28, x + 58, 50);
      g.fillStyle(0x8d7562, 1);
      g.fillRect(x, 46, 54, 70);
      g.fillStyle(0x5c4638, 1);
      g.fillRect(x, 46, 54, 8);
      g.fillStyle(0xf0d080, 1);
      g.fillRect(x + 12, 64, 8, 12);
      g.fillRect(x + 34, 64, 8, 12);
    };
    tower(16);
    tower(w - 70);

    g.fillStyle(0x7a3030, 1);
    g.fillRect(64, 48, w - 128, 10);
    g.fillStyle(0x8d7562, 1);
    g.fillRect(64, 58, w - 128, 52);
    g.fillStyle(0x5c4638, 1);
    for (let x = 72; x < w - 72; x += 18) g.fillRect(x, 50, 10, 10);

    // North gate doorway
    g.fillStyle(0x2a1810, 1);
    g.fillRect(cx - 22, 62, 44, 48);
    g.fillStyle(0x6a4428, 1);
    g.fillRect(cx - 26, 58, 52, 8);
    g.fillStyle(0xc4b49a, 1);
    g.fillRect(cx - 40, L.plazaTop - 10, 80, 8);
    g.fillRect(cx - 52, L.plazaTop - 2, 104, 8);

    // Banners
    const hang = (x: number, color: number) => {
      const cloth = this.add.rectangle(x, 68, 12, 26, color).setOrigin(0.5, 0).setDepth(2);
      this.tweens.add({
        targets: cloth,
        angle: 7,
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    };
    hang(110, 0xb4333a);
    hang(w - 110, 0xe2b34a);

    // Checkered stone plaza
    const inset = 36;
    for (let y = L.plazaTop; y < L.plazaBottom; y += 16) {
      for (let x = inset; x < w - inset; x += 16) {
        const odd = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0;
        g.fillStyle(odd ? 0xcfc3b0 : 0xb3a48f, 1);
        g.fillRect(x, y, 16, 16);
      }
    }
    g.lineStyle(2, 0x8a7b68, 1);
    g.strokeRect(inset, L.plazaTop, w - inset * 2, L.plazaBottom - L.plazaTop);

    // Central dark path (full vertical through plaza)
    for (let y = L.plazaTop - 6; y < L.plazaBottom + 8; y += 12) {
      g.fillStyle(y % 24 < 12 ? 0x6e655a : 0x5c554c, 1);
      g.fillRect(cx - L.pathHalf, y, L.pathHalf * 2, 12);
    }

    // Trees on grass edges
    const tree = (x: number, y: number) => {
      g.fillStyle(0x6b4428, 1);
      g.fillRect(x - 3, y, 6, 14);
      g.fillStyle(0x2f7a32, 1);
      g.fillCircle(x, y - 2, 13);
      g.fillStyle(0x4ea04a, 1);
      g.fillCircle(x - 5, y - 6, 7);
    };
    for (let y = L.plazaTop + 20; y < L.plazaBottom - 20; y += 48) {
      tree(18, y);
      tree(w - 18, y);
    }
    tree(L.girl.x - 36, L.girl.y - 28);
    tree(L.signpost.x + 40, L.signpost.y + 10);

    // Fountain
    const fx = L.fountain.x;
    const fy = L.fountain.y;
    g.fillStyle(0xd9d3c8, 1);
    g.fillEllipse(fx, fy, 48, 26);
    g.fillStyle(0x5eb0d4, 1);
    g.fillEllipse(fx, fy, 30, 14);
    const water = this.add.circle(fx, fy, 7, 0x7ec8ea, 0.85).setDepth(2);
    this.tweens.add({
      targets: water,
      scale: 1.25,
      alpha: 0.4,
      duration: 900,
      yoyo: true,
      repeat: -1,
    });

    // Benches / crates (lower half fill)
    const crate = (x: number, y: number, ww: number, hh: number) => {
      g.fillStyle(0x7a5230, 1);
      g.fillRect(x - ww / 2, y - hh / 2, ww, hh);
      g.fillStyle(0x9a6a40, 1);
      g.fillRect(x - ww / 2, y - hh / 2, ww, 4);
    };
    crate(Math.round(w * 0.3), Math.round(h * 0.72), 28, 14);
    crate(Math.round(w * 0.3) + 34, Math.round(h * 0.72), 18, 16);
    crate(Math.round(w * 0.72), Math.round(h * 0.78), 32, 14);
    crate(Math.round(w * 0.18), Math.round(h * 0.68), 36, 12);
    crate(Math.round(w * 0.78), Math.round(h * 0.7), 20, 18);

    // South gate posts
    g.fillStyle(0x6a4328, 1);
    g.fillRect(cx - 48, L.southGate.y - 22, 10, 36);
    g.fillRect(cx + 38, L.southGate.y - 22, 10, 36);
    g.fillStyle(0x8a5a30, 1);
    g.fillRect(cx - 48, L.southGate.y - 28, 96, 8);

    // Static gate labels (always visible, thin)
    this.add
      .text(L.northGate.x, L.northGate.y - 18, '北門 · 出發', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e8ffe0',
        stroke: '#1a3010',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.add
      .text(L.southGate.x, L.southGate.y + 18, '南門 · 返回選角', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e8eef4',
        stroke: '#1a2030',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(6);
  }

  private buildBlockers(w: number, h: number, L: HubLayout): void {
    this.blockers = this.physics.add.staticGroup();
    const add = (x: number, y: number, bw: number, bh: number) => {
      const r = this.add.rectangle(x, y, bw, bh, 0x000000, 0).setVisible(false);
      this.physics.add.existing(r, true);
      this.blockers.add(r);
    };

    // North wall
    add(w / 2, 70, w, 36);
    // Grass / tree strips left & right of plaza
    add(18, (L.plazaTop + L.plazaBottom) / 2, 36, L.plazaBottom - L.plazaTop);
    add(w - 18, (L.plazaTop + L.plazaBottom) / 2, 36, L.plazaBottom - L.plazaTop);
    // South edge (leave path open through gate)
    add(w * 0.25, h - 10, w * 0.4, 20);
    add(w * 0.75, h - 10, w * 0.4, 20);
    // Fountain
    add(L.fountain.x, L.fountain.y, 40, 22);
    // Crates / benches
    add(Math.round(w * 0.3), Math.round(h * 0.72), 56, 18);
    add(Math.round(w * 0.72), Math.round(h * 0.78), 36, 16);
    add(Math.round(w * 0.18), Math.round(h * 0.68), 40, 14);
    add(Math.round(w * 0.78), Math.round(h * 0.7), 24, 20);
    // NPC soft blockers — match scale-2 standee footprint (feet-centered).
    add(L.king.x, L.king.y + 2, 36, 28);
    add(L.girl.x, L.girl.y + 2, 34, 26);
    add(L.signpost.x, L.signpost.y + 6, 20, 28);
    this.npcSoftTargets = [
      { x: L.king.x, y: L.king.y, minDist: 22 },
      { x: L.girl.x, y: L.girl.y, minDist: 20 },
    ];
    // Ensure static bodies match rectangle sizes after group add.
    this.blockers.getChildren().forEach((child) => {
      const body = (child as Phaser.Physics.Arcade.Image).body as
        | Phaser.Physics.Arcade.StaticBody
        | null;
      body?.updateFromGameObject();
    });
  }

  private placeNpcs(L: HubLayout): void {
    const king = this.add.sprite(L.king.x, L.king.y, 'npc', 'king_idle_0');
    king.setScale(PLAYER_SCALE);
    king.setOrigin(0.5, 0.85);
    king.setDepth(Math.round(L.king.y));
    king.play('npc-king-idle');
    this.kingSprite = king;

    const girl = this.add.sprite(L.girl.x, L.girl.y, 'npc', 'girl_idle_0');
    girl.setScale(PLAYER_SCALE);
    girl.setOrigin(0.5, 0.85);
    girl.setDepth(Math.round(L.girl.y));
    girl.play('npc-girl-idle');
    this.girlSprite = girl;

    // Signpost
    const sx = L.signpost.x;
    const sy = L.signpost.y;
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(0x6b4a2c, 1);
    g.fillRect(sx - 3, sy - 8, 6, 28);
    g.fillStyle(0x8a6a3c, 1);
    g.fillRect(sx - 16, sy - 22, 32, 18);
    g.lineStyle(2, 0x3a2810, 1);
    g.strokeRect(sx - 16, sy - 22, 32, 18);
    this.add
      .text(sx, sy - 14, '關卡', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e8ffe0',
      })
      .setOrigin(0.5)
      .setDepth(5);
    // Green flag tip
    g.fillStyle(0x4caf50, 1);
    g.fillTriangle(sx + 16, sy - 22, sx + 28, sy - 14, sx + 16, sy - 6);
  }

  private placePlayer(L: HubLayout): void {
    const hero = HEROES[this.heroId];
    if (!hero) return;
    const sprite = this.physics.add.sprite(L.spawn.x, L.spawn.y, hero.atlas, hero.previewFrame);
    sprite.setScale(PLAYER_SCALE);
    sprite.setOrigin(0.5, 0.85);
    sprite.setDepth(Math.round(L.spawn.y));
    sprite.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    // Slightly larger feet box so hub soft blockers actually catch the standee.
    body.setSize(14, 10);
    body.setOffset(sprite.width / 2 - 7, sprite.height - 14);
    this.physics.add.collider(sprite, this.blockers);
    this.player = sprite;
    this.animCtl = new FourDirAnimController(sprite, hero.data.anim);
    this.animCtl.setFacing('up');
    this.animCtl.playIdle();

    // Yellow arrow above player (spawn hint)
    const arrow = this.add
      .triangle(L.spawn.x, L.spawn.y - 28, 0, 8, 8, 8, 4, 0, 0xffe066)
      .setDepth(7);
    this.tweens.add({
      targets: arrow,
      y: L.spawn.y - 34,
      duration: 600,
      yoyo: true,
      repeat: 5,
      onComplete: () => arrow.destroy(),
    });
    this.tweens.add({
      targets: arrow,
      x: {
        getStart: () => this.player?.x ?? L.spawn.x,
        getEnd: () => this.player?.x ?? L.spawn.x,
      },
      duration: 100,
      repeat: 5,
      onUpdate: () => {
        if (this.player && arrow.active) arrow.x = this.player.x;
      },
    });
  }

  private buildInteractables(L: HubLayout): void {
    this.interactables = [
      {
        id: 'king',
        x: L.king.x,
        y: L.king.y,
        radius: 42,
        name: '國王馬歇爾',
        pill: '對話',
        pillFill: 0x2a5080,
        pillStroke: 0x90c4ff,
        onInteract: () => this.openNpc('king'),
      },
      {
        id: 'girl',
        x: L.girl.x,
        y: L.girl.y,
        radius: 40,
        name: '紅鞋少女',
        pill: '對話',
        pillFill: 0x2a5080,
        pillStroke: 0x90c4ff,
        onInteract: () => this.openNpc('girl'),
      },
      {
        id: 'signpost',
        x: L.signpost.x,
        y: L.signpost.y,
        radius: 40,
        name: '路牌 · 關卡選擇',
        pill: '關卡選擇',
        pillFill: 0x5a4630,
        pillStroke: 0xe0c080,
        onInteract: () => {
          this.audio.confirm();
          this.scene.start('StageSelectScene');
        },
      },
      {
        id: 'northGate',
        x: L.northGate.x,
        y: L.northGate.y + 16,
        radius: 48,
        name: '北門',
        pill: '出發 · 哥布林要塞',
        pillFill: 0x2e5a30,
        pillStroke: 0xb6f0a0,
        onInteract: () => {
          this.audio.confirm();
          this.departStage(1);
        },
      },
      {
        id: 'southGate',
        x: L.southGate.x,
        y: L.southGate.y - 8,
        radius: 44,
        name: '南門',
        pill: '返回選角',
        pillFill: 0x243038,
        pillStroke: 0x9ab0c0,
        onInteract: () => {
          this.audio.confirm();
          this.scene.start('SelectScene');
        },
      },
    ];
  }

  private buildHud(w: number, _h: number): void {
    const heroLabel = HEROES[this.heroId]?.label ?? this.heroId;
    const bar = this.add
      .rectangle(w / 2, 28, w - 16, 52, 0x0e1820, 0.72)
      .setStrokeStyle(1, 0x4a5a68, 0.8)
      .setDepth(12)
      .setScrollFactor(0);

    this.add
      .text(w / 2, 14, '葛蘭多爾城', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#fff8e8',
        stroke: '#3a2a18',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(13)
      .setScrollFactor(0);

    this.add
      .text(w / 2, 30, `據點 · ${heroLabel}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#fff4d8',
        stroke: '#3a2a18',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(13)
      .setScrollFactor(0);

    this.add
      .text(
        w / 2,
        44,
        this.shrineUnlocked
          ? '荒廢神殿已開啟 · 路牌可再出發'
          : this.goblinCleared
            ? '要塞已平定 · 深層迴廊已開啟'
            : '國王委託 · 調查哥布林要塞',
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: this.goblinCleared ? '#e8ffe8' : '#ffe7a0',
          stroke: '#2a2010',
          strokeThickness: 2,
        },
      )
      .setOrigin(0.5)
      .setDepth(13)
      .setScrollFactor(0);

    void bar;

    // Thin top-left 返回選角
    const backBg = this.add
      .rectangle(52, 28, 88, 28, 0x243038, 0.9)
      .setStrokeStyle(2, 0x9ab0c0)
      .setDepth(UI_DEPTH + 15)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(52, 28, '返回選角', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e4eef4',
      })
      .setOrigin(0.5)
      .setDepth(UI_DEPTH + 16)
      .setScrollFactor(0);
    backBg.on('pointerdown', () => {
      this.audio.confirm();
      this.scene.start('SelectScene');
    });

    this.departHint = this.add
      .text(w / 2, this.scale.height - 14, '靠近北門即可出發 · WASD／搖桿移動 · E 互動', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#c8d4c0',
        stroke: '#1a2010',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0);
  }

  private buildPillUi(): void {
    // Above TouchControls stick (UI_DEPTH-1) so hub「對話」taps are never stolen.
    const pillDepth = UI_DEPTH + 20;
    this.zoneGfx = this.add.graphics().setDepth(6);

    this.namePill = this.add.container(0, 0).setDepth(pillDepth).setVisible(false);
    const nameBg = this.add.rectangle(0, 0, 100, 20, 0x1a2430, 0.92).setStrokeStyle(2, 0xffe066);
    const nameTx = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fff8e0' })
      .setOrigin(0.5);
    this.namePill.add([nameBg, nameTx]);
    this.namePill.setData('bg', nameBg);
    this.namePill.setData('tx', nameTx);

    this.actionPill = this.add.container(0, 0).setDepth(pillDepth + 1).setVisible(false);
    const actBg = this.add
      .rectangle(0, 0, 120, 32, 0x2e5a30, 0.95)
      .setStrokeStyle(2, 0xb6f0a0);
    const actTx = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#eaffe4' })
      .setOrigin(0.5);
    this.actionPill.add([actBg, actTx]);
    this.actionPill.setData('bg', actBg);
    this.actionPill.setData('tx', actTx);
    this.actionPillBg = actBg;
    // Fat-finger hit on the fill rect (not the container) — clear bounds + cursor.
    this.bindActionPillHit(120, 44);
    actBg.on('pointerdown', () => this.tryInteract());
  }

  /** Oversized hit area for the action pill (min ~44px tall for thumbs). */
  private bindActionPillHit(w: number, h: number): void {
    const bg = this.actionPillBg;
    if (!bg) return;
    const hw = Math.max(88, w) / 2;
    const hh = Math.max(44, h) / 2;
    bg.setInteractive(
      new Phaser.Geom.Rectangle(-hw, -hh, hw * 2, hh * 2),
      Phaser.Geom.Rectangle.Contains,
    );
    if (bg.input) bg.input.cursor = 'pointer';
  }

  private refreshNearest(): void {
    if (!this.player) {
      this.nearest = null;
      return;
    }
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const it of this.interactables) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, it.x, it.y);
      if (d <= it.radius && d < bestDist) {
        best = it;
        bestDist = d;
      }
    }
    this.nearest = best;
  }

  private refreshPills(): void {
    const it = this.nearest;
    if (!it || !this.zoneGfx || !this.namePill || !this.actionPill) {
      this.hidePills();
      return;
    }

    // Yellow dashed talk zone
    this.zoneGfx.clear();
    this.zoneGfx.lineStyle(2, 0xffe066, 0.7);
    this.drawDashedCircle(this.zoneGfx, it.x, it.y, it.radius, 18);

    // Name plate
    const nameTx = this.namePill.getData('tx') as Phaser.GameObjects.Text;
    const nameBg = this.namePill.getData('bg') as Phaser.GameObjects.Rectangle;
    nameTx.setText(it.name);
    const nw = Math.max(72, nameTx.width + 16);
    nameBg.setSize(nw, 20);
    this.namePill.setPosition(it.x, it.y - 36);
    this.namePill.setVisible(true);

    // Action pill
    const actTx = this.actionPill.getData('tx') as Phaser.GameObjects.Text;
    const actBg = this.actionPill.getData('bg') as Phaser.GameObjects.Rectangle;
    actTx.setText(it.pill);
    const aw = Math.max(88, actTx.width + 20);
    actBg.setSize(aw, 28);
    actBg.setFillStyle(it.pillFill, 0.95);
    actBg.setStrokeStyle(2, it.pillStroke);
    this.actionPill.setPosition(it.x, it.y + 28);
    this.actionPill.setVisible(true);
    this.actionPill.setSize(aw, 32);
    // Keep hit geom in sync with label width; depth already above stick.
    this.bindActionPillHit(aw + 24, 48);

    // Pulse depart CTA
    if (it.id === 'northGate') {
      actBg.setAlpha(0.75 + 0.25 * Math.sin(this.time.now / 250));
      if (this.departHint) this.departHint.setColor('#b6f0a0');
    } else if (this.departHint) {
      this.departHint.setColor('#c8d4c0');
    }
  }

  private hidePills(): void {
    this.zoneGfx?.clear();
    this.namePill?.setVisible(false);
    this.actionPill?.setVisible(false);
  }

  private drawDashedCircle(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    dashes: number,
  ): void {
    const step = (Math.PI * 2) / dashes;
    for (let i = 0; i < dashes; i += 2) {
      const a0 = i * step;
      const a1 = (i + 1) * step;
      g.beginPath();
      g.arc(cx, cy, r, a0, a1, false);
      g.strokePath();
    }
  }

  /** Feet-Y depth so nearer characters draw in front when close (not stacked). */
  private refreshDepthSort(): void {
    if (this.player?.active) this.player.setDepth(Math.round(this.player.y));
    if (this.kingSprite?.active) this.kingSprite.setDepth(Math.round(this.kingSprite.y));
    if (this.girlSprite?.active) this.girlSprite.setDepth(Math.round(this.girlSprite.y));
  }

  /** Push player out if a body slip leaves them stacked on an NPC. */
  private applyNpcSoftSeparation(): void {
    const p = this.player;
    if (!p?.active) return;
    const body = p.body as Phaser.Physics.Arcade.Body | null;
    for (const t of this.npcSoftTargets) {
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= t.minDist || dist < 0.001) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const push = t.minDist - dist;
      p.x += nx * push;
      p.y += ny * push;
      body?.reset(p.x, p.y);
    }
  }

  private tryInteract(): void {
    if (this.activeNpc) return;
    if (!this.nearest) return;
    this.nearest.onInteract();
  }

  private buildDialogueOverlay(): void {
    const { width, height } = this.scale;
    const panelW = width - 40;
    const panelH = 110;
    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x0e1820, 0.96)
      .setStrokeStyle(2, 0xffe066);
    this.dialogueSpeaker = this.add
      .text(-panelW / 2 + 12, -panelH / 2 + 10, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffe066',
      })
      .setOrigin(0, 0);
    this.dialogueBody = this.add
      .text(-panelW / 2 + 12, -panelH / 2 + 32, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e8eef5',
        wordWrap: { width: panelW - 24 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    const hint = this.add
      .text(0, panelH / 2 - 14, '點擊關閉 · Enter / Space / Esc', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#8899aa',
      })
      .setOrigin(0.5);

    this.dialogueBox = this.add
      .container(width / 2, height - 70, [bg, this.dialogueSpeaker, this.dialogueBody, hint])
      .setDepth(UI_DEPTH + 30)
      .setVisible(false);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => this.closeDialogue());
  }

  private openNpc(kind: 'king' | 'girl'): void {
    this.activeNpc = kind;
    if (!this.dialogueBox || !this.dialogueSpeaker || !this.dialogueBody) return;
    this.audio.confirm();

    if (kind === 'king') {
      this.dialogueSpeaker.setText('國王馬歇爾');
      this.dialogueBody.setText(
        this.shrineUnlocked
          ? '深層迴廊亦已探明。城外「荒廢神殿」的入口現已開啟——可從路牌再出發。'
          : this.goblinCleared
            ? '你已討伐蓋利隊長，不負所託！哥布林要塞暫告平定。「深層迴廊」的入口亦已開啟——若有餘力，可再探查。'
            : '城外哥布林異常活躍，恐怕與帝斯哈多有關。請前往「哥布林要塞」，查明並擊破其首領蓋利隊長。',
      );
    } else {
      this.dialogueSpeaker.setText('紅鞋少女');
      this.dialogueBody.setText(
        this.goblinCleared
          ? '聽說要塞裡有雙紅鞋子……如果你找到了，可以拿來給我嗎？（尚未實作掉落，之後再接）'
          : '我最喜歡紅鞋子了！聽說哥布林要塞某處藏著一雙……你出城的時候，幫我留意一下好嗎？',
      );
    }
    this.dialogueBox.setVisible(true);
    this.hidePills();
  }

  private closeDialogue(): void {
    this.activeNpc = null;
    this.dialogueBox?.setVisible(false);
  }

  private departStage(id: StageId): void {
    void getStage(id);
    this.registry.set(SELECTED_STAGE_KEY, id);
    this.scene.start('GameScene');
  }
}
