import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import {
  SELECTED_STAGE_KEY,
  STAGES,
  type StageId,
  getStage,
} from '../data/stages';
import * as SaveManager from '../systems/SaveManager';

/**
 * Stage select after hero pick. 1/2 or click → GameScene with stage id.
 */
export class StageSelectScene extends Phaser.Scene {
  private selected: StageId = 1;
  private audio!: GameAudio;
  private unlocked: StageId[] = [1];
  private cards: {
    id: StageId;
    locked: boolean;
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Rectangle;
  }[] = [];

  constructor() {
    super('StageSelectScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#142018');
    this.audio = GameAudio.attach(this);
    this.audio.startBgm('title');
    this.input.once('pointerdown', () => this.audio.ensurePlaying());

    const saved = SaveManager.load();
    this.unlocked = SaveManager.getUnlockedStages(saved);
    const firstOpen = this.unlocked[0] ?? 1;
    this.selected = firstOpen;

    this.add
      .text(width / 2, 28, '光明之魂2', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 48, '揀關卡 · 亦可從村莊出發', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#88aa88',
      })
      .setOrigin(0.5);

    const slotW = 180;
    const gap = 16;
    const total = STAGES.length * slotW + (STAGES.length - 1) * gap;
    const x0 = (width - total) / 2 + slotW / 2;
    const y = height / 2 - 8;

    this.cards = [];
    STAGES.forEach((stage, i) => {
      const locked = !this.unlocked.includes(stage.id);
      const cx = x0 + i * (slotW + gap);
      const bg = this.add
        .rectangle(0, 0, slotW, 150, locked ? 0x181818 : 0x1e3020, 0.95)
        .setStrokeStyle(2, locked ? 0x555555 : 0x4a7a4a);
      const num = this.add
        .text(0, -58, `${stage.id}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: locked ? '#777777' : '#aad0aa',
        })
        .setOrigin(0.5);
      const label = this.add
        .text(0, -20, stage.nameZh, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: locked ? '#888888' : '#f0fff0',
        })
        .setOrigin(0.5);
      const state = this.add
        .text(0, 10, locked ? '鎖定' : '已解鎖', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: locked ? '#ff8888' : '#6dffa0',
        })
        .setOrigin(0.5);
      const hint = this.add
        .text(0, 36, locked ? '通關上一關解鎖' : '點選／數字鍵開始', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: locked ? '#999999' : '#9bbb9b',
          align: 'center',
          wordWrap: { width: slotW - 16 },
        })
        .setOrigin(0.5);

      const container = this.add.container(cx, y, [bg, num, label, state, hint]);
      if (!locked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => this.setSelected(stage.id));
        bg.on('pointerdown', () => {
          this.setSelected(stage.id);
          this.startStage(stage.id);
        });
      }
      this.cards.push({ id: stage.id, locked, container, bg });
    });

    this.add
      .text(width / 2, height - 54, '1 / 2 · 點選卡片 · Enter / Space 開始', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c8e8c8',
        backgroundColor: '#00000066',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0.5);

    this.addMenuButton(width / 2 - 90, height - 28, '回城', 0x3a2a18, 0xffcc66, () => {
      this.audio.confirm();
      this.scene.start('VillageScene');
    });
    this.addMenuButton(width / 2, height - 28, '返回選角', 0x1e3020, 0x4a7a4a, () => {
      this.audio.confirm();
      this.scene.start('SelectScene');
    });
    this.addMenuButton(width / 2 + 90, height - 28, '開始', 0x2a4a28, 0x6dffa0, () => {
      this.confirm();
    });

    this.setSelected(this.selected);

    if (!this.input.keyboard) return;
    const keyboard = this.input.keyboard;
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE).on('down', () => this.trySelect(1));
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO).on('down', () => this.trySelect(2));
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE).on('down', () => this.trySelect(1));
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO).on('down', () => this.trySelect(2));
    keyboard.on('keydown-ENTER', () => this.confirm());
    keyboard.on('keydown-SPACE', () => this.confirm());
    keyboard.on('keydown-ESC', () => {
      this.audio.confirm();
      this.scene.start('SelectScene');
    });
  }

  private trySelect(id: StageId): void {
    if (!this.unlocked.includes(id)) return;
    this.setSelected(id);
  }

  private setSelected(id: StageId): void {
    if (!this.unlocked.includes(id)) return;
    this.selected = id;
    for (const c of this.cards) {
      if (c.locked) continue;
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
    const w = 78;
    const h = 22;
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

  private confirm(): void {
    if (!this.unlocked.includes(this.selected)) return;
    this.startStage(this.selected);
  }

  private startStage(id: StageId): void {
    if (!this.unlocked.includes(id)) return;
    this.audio.confirm();
    // Touch the stage def so a typo fails at compile time.
    void getStage(id);
    this.registry.set(SELECTED_STAGE_KEY, id);
    this.scene.start('GameScene');
  }
}
