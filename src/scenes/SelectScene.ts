import Phaser from 'phaser';
import { HERO_ORDER, HEROES, SELECTED_HERO_KEY, type HeroId } from '../heroes';

/**
 * Title + character select. 1/2/3 or click → GameScene.
 */
export class SelectScene extends Phaser.Scene {
  private selected: HeroId = 'eric';
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

    this.add
      .text(width / 2, 28, 'SHINING SOUL II', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 48, 'web prototype — pick a hero', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88aa88',
      })
      .setOrigin(0.5);

    const slotW = 130;
    const gap = 12;
    const total = HERO_ORDER.length * slotW + (HERO_ORDER.length - 1) * gap;
    let x0 = (width - total) / 2 + slotW / 2;
    const y = height / 2 + 8;

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
          fontSize: '12px',
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
          fontSize: '12px',
          color: '#f0fff0',
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, 64, hero.subtitle, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#9bbb9b',
        })
        .setOrigin(0.5);
      const stats = this.add
        .text(0, 78, `HP ${hero.maxHp}  SPD ${hero.speed}`, {
          fontFamily: 'monospace',
          fontSize: '8px',
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
      .text(width / 2, height - 36, '1 / 2 / 3 · tap card / 點選 · Enter / Space', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c8e8c8',
        backgroundColor: '#00000066',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height - 16, 'Sprites: Claire Starsword · fan learning only', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#667766',
      })
      .setOrigin(0.5);

    this.setSelected('eric');

    if (!this.input.keyboard) return;
    this.input.keyboard.on('keydown-ONE', () => this.setSelected('eric'));
    this.input.keyboard.on('keydown-TWO', () => this.setSelected('prim'));
    this.input.keyboard.on('keydown-THREE', () => this.setSelected('raizen'));
    this.input.keyboard.on('keydown-NUMPAD_ONE', () => this.setSelected('eric'));
    this.input.keyboard.on('keydown-NUMPAD_TWO', () => this.setSelected('prim'));
    this.input.keyboard.on('keydown-NUMPAD_THREE', () => this.setSelected('raizen'));
    this.input.keyboard.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard.on('keydown-SPACE', () => this.confirm());
  }

  private setSelected(id: HeroId): void {
    this.selected = id;
    for (const c of this.cards) {
      const on = c.id === id;
      c.bg.setStrokeStyle(2, on ? 0xffe066 : 0x4a7a4a);
      c.bg.setFillStyle(on ? 0x2a4030 : 0x1e3020, 0.95);
    }
  }

  private confirm(): void {
    this.registry.set(SELECTED_HERO_KEY, this.selected);
    this.scene.start('GameScene');
  }
}
