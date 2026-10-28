import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { HERO_ORDER, HEROES, SELECTED_HERO_KEY, type HeroId } from '../data/players';
import * as SaveManager from '../systems/SaveManager';

/**
 * Title + character select.
 * New game → StoryScene; continue with seenIntro → VillageScene; else Story.
 */
export class SelectScene extends Phaser.Scene {
  private selected: HeroId = 'eric';
  private audio!: GameAudio;
  private cards: {
    id: HeroId;
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Rectangle;
  }[] = [];

  constructor() {
    super('SelectScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#142018');
    this.audio = GameAudio.attach(this);
    this.audio.startBgm('title');
    this.input.once('pointerdown', () => this.audio.ensurePlaying());
    const saved = SaveManager.load();

    this.add
      .text(width / 2, 28, '光明之魂2', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 48, '網頁試作 — 揀角色', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88aa88',
      })
      .setOrigin(0.5);

    // Four cards on a 480-wide canvas: total must stay ≤ width - 16.
    const slotW = 104;
    const gap = 8;
    const total = HERO_ORDER.length * slotW + (HERO_ORDER.length - 1) * gap;
    let x0 = (width - total) / 2 + slotW / 2;
    const y = height / 2;

    this.cards = [];
    HERO_ORDER.forEach((id, i) => {
      const hero = HEROES[id];
      const cx = x0 + i * (slotW + gap);
      const bg = this.add
        .rectangle(0, 0, slotW, 170, 0x1e3020, 0.95)
        .setStrokeStyle(2, 0x4a7a4a);
      const num = this.add
        .text(0, -72, `${i + 1}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aad0aa',
        })
        .setOrigin(0.5);
      const sprite = this.add
        .sprite(0, -18, hero.atlas, hero.previewFrame)
        .setScale(2)
        .setOrigin(0.5, 0.85);
      // gentle idle bob
      this.tweens.add({
        targets: sprite,
        y: -14,
        duration: 700 + i * 80,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      const label = this.add
        .text(0, 48, hero.label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#f0fff0',
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, 64, hero.subtitle, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: '#9bbb9b',
        })
        .setOrigin(0.5);
      const stats = this.add
        .text(0, 78, `生命 ${hero.maxHp}  速度 ${hero.speed}`, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color: '#c8e0c8',
        })
        .setOrigin(0.5);

      const container = this.add.container(cx, y, [bg, num, sprite, label, sub, stats]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => this.setSelected(id));
      bg.on('pointerdown', () => {
        this.setSelected(id);
        this.confirm();
      });
      this.cards.push({ id, container, bg });
    });

    this.add
      .text(width / 2, height - 54, '1 / 2 / 3 / 4 · 點選卡片 · Enter / Space', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c8e8c8',
        backgroundColor: '#00000066',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0.5);

    const continueFill = saved ? 0x3a3420 : 0x1e3020;
    const continueStroke = saved ? 0xffe066 : 0x88cc88;
    this.addMenuButton(width / 2 - 40, height - 32, '繼續', continueFill, continueStroke, () => {
      this.confirm();
    });
    this.addMenuButton(width / 2 + 40, height - 32, '新遊戲', 0x1e3020, 0x4a7a4a, () => {
      this.startNewGame();
    });

    this.add
      .text(width / 2, height - 12, '精靈圖：Claire Starsword · 僅供學習', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#667766',
      })
      .setOrigin(0.5);

    this.setSelected(saved?.heroId ?? 'eric');

    if (!this.input.keyboard) return;
    const keyboard = this.input.keyboard;
    const digitCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
    ];
    const numpadCodes = [
      Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
      Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
      Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
      Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR,
    ];
    HERO_ORDER.forEach((id, i) => {
      const digit = digitCodes[i];
      const pad = numpadCodes[i];
      if (digit !== undefined) keyboard.addKey(digit).on('down', () => this.setSelected(id));
      if (pad !== undefined) keyboard.addKey(pad).on('down', () => this.setSelected(id));
    });
    keyboard.on('keydown-ENTER', () => this.confirm());
    keyboard.on('keydown-SPACE', () => this.confirm());
  }

  private setSelected(id: HeroId): void {
    this.selected = id;
    for (const c of this.cards) {
      const on = c.id === id;
      c.bg.setStrokeStyle(2, on ? 0xffe066 : 0x4a7a4a);
      c.bg.setFillStyle(on ? 0x2a4030 : 0x1e3020, 0.95);
    }
  }

  private addMenuButton(
    x: number,
    y: number,
    label: string,
    fill: number,
    stroke: number,
    onClick: () => void,
  ): void {
    const w = 68;
    const h = 16;
    const bg = this.add.rectangle(0, 0, w, h, fill, 0.95).setStrokeStyle(1, stroke);
    const caption = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    const container = this.add.container(x, y, [bg, caption]).setDepth(5);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    if (container.input) container.input.cursor = 'pointer';
    container.on('pointerover', () => bg.setFillStyle(0x345040, 1));
    container.on('pointerout', () => bg.setFillStyle(fill, 0.95));
    container.on('pointerdown', () => onClick());
  }

  /** Keep gold, gear, and unlocks; remember the highlighted hero → story or village. */
  private confirm(): void {
    this.audio.confirm();
    this.registry.set(SELECTED_HERO_KEY, this.selected);
    const existing = SaveManager.load();
    SaveManager.save(
      SaveManager.mergeProfile(existing, {
        heroId: this.selected,
        gold: existing?.gold ?? 0,
        bag: existing?.bag ?? [],
        equipped: existing?.equipped ?? {},
        unlockedStages: SaveManager.getUnlockedStages(existing),
      }),
    );
    this.routeAfterSelect(SaveManager.getFlags(SaveManager.load()).seenIntro);
  }

  /** Drop the profile and start the highlighted hero → intro story. */
  private startNewGame(): void {
    this.audio.confirm();
    SaveManager.clear();
    this.registry.set(SELECTED_HERO_KEY, this.selected);
    SaveManager.save(SaveManager.makeFreshSave(this.selected));
    this.scene.start('StoryScene');
  }

  private routeAfterSelect(seenIntro: boolean): void {
    if (seenIntro) this.scene.start('VillageScene');
    else this.scene.start('StoryScene');
  }
}
