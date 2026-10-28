import Phaser from 'phaser';
import { HEROES, SELECTED_HERO_KEY, type HeroId } from '../data/players';
import { SELECTED_STAGE_KEY, getStage, type StageId } from '../data/stages';
import * as SaveManager from '../systems/SaveManager';

type NpcKind = 'king' | 'girl' | null;

/**
 * 葛蘭多爾城 lite — village hub after intro / after stage clear.
 * King (quest / turn-in), red-shoe girl stub, depart to stage 1, stage select.
 */
export class VillageScene extends Phaser.Scene {
  private dialogueBox?: Phaser.GameObjects.Container;
  private dialogueSpeaker?: Phaser.GameObjects.Text;
  private dialogueBody?: Phaser.GameObjects.Text;
  private activeNpc: NpcKind = null;
  private goblinCleared = false;
  private heroId: HeroId = 'eric';

  constructor() {
    super('VillageScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#1a2418');

    const saved = SaveManager.load();
    const flags = SaveManager.getFlags(saved);
    this.goblinCleared = flags.goblinCleared;
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

    const heroLabel = HEROES[this.heroId]?.label ?? this.heroId;

    this.add
      .text(width / 2, 18, '葛蘭多爾城', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 36, `村莊據點 · ${heroLabel}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88aa88',
      })
      .setOrigin(0.5);

    // Decorative plaza frame
    this.add
      .rectangle(width / 2, height / 2 - 8, width - 28, height - 100, 0x243028, 0.9)
      .setStrokeStyle(2, 0x4a7a4a);

    this.add
      .text(width / 2, 58, this.goblinCleared ? '要塞已平定 · 國王等候回報' : '國王委託 · 調查哥不林要塞', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: this.goblinCleared ? '#6dffa0' : '#ffe066',
      })
      .setOrigin(0.5);

    // NPC buttons (large touch targets)
    this.addNpcButton(width / 2 - 100, 100, '國王馬歇爾', () => this.openNpc('king'));
    this.addNpcButton(width / 2 + 100, 100, '紅鞋少女', () => this.openNpc('girl'));

    // Primary depart
    this.addWideButton(
      width / 2,
      168,
      '出發 · 哥不林要塞',
      0x2a4a28,
      0x6dffa0,
      () => this.departStage(1),
    );

    this.addWideButton(
      width / 2,
      208,
      '關卡選擇',
      0x1e3028,
      0x88cc88,
      () => this.scene.start('StageSelectScene'),
    );

    this.addWideButton(
      width / 2,
      248,
      '返回選角',
      0x2a2a30,
      0x8888aa,
      () => this.scene.start('SelectScene'),
    );

    this.buildDialogueOverlay();

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => {
        if (this.activeNpc) this.closeDialogue();
        else this.scene.start('SelectScene');
      });
      this.input.keyboard.on('keydown-ENTER', () => {
        if (this.activeNpc) this.closeDialogue();
      });
      this.input.keyboard.on('keydown-SPACE', () => {
        if (this.activeNpc) this.closeDialogue();
      });
      this.input.keyboard.on('keydown-ONE', () => this.departStage(1));
    }
  }

  private addNpcButton(x: number, y: number, label: string, onClick: () => void): void {
    const w = 140;
    const h = 36;
    const bg = this.add.rectangle(0, 0, w, h, 0x2a3a48, 0.95).setStrokeStyle(2, 0x66a0cc);
    const caption = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e8f4ff',
      })
      .setOrigin(0.5);
    const c = this.add.container(x, y, [bg, caption]);
    c.setSize(w, h);
    c.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => bg.setFillStyle(0x3a5060, 1));
    c.on('pointerout', () => bg.setFillStyle(0x2a3a48, 0.95));
    c.on('pointerdown', () => onClick());
  }

  private addWideButton(
    x: number,
    y: number,
    label: string,
    fill: number,
    stroke: number,
    onClick: () => void,
  ): void {
    const w = 220;
    const h = 32;
    const bg = this.add.rectangle(0, 0, w, h, fill, 0.95).setStrokeStyle(2, stroke);
    const caption = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    const c = this.add.container(x, y, [bg, caption]).setDepth(5);
    c.setSize(w, h);
    c.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => bg.setFillStyle(0x3a5a48, 1));
    c.on('pointerout', () => bg.setFillStyle(fill, 0.95));
    c.on('pointerdown', () => onClick());
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
      .setDepth(20)
      .setVisible(false);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => this.closeDialogue());
  }

  private openNpc(kind: 'king' | 'girl'): void {
    this.activeNpc = kind;
    if (!this.dialogueBox || !this.dialogueSpeaker || !this.dialogueBody) return;

    if (kind === 'king') {
      this.dialogueSpeaker.setText('國王馬歇爾');
      this.dialogueBody.setText(
        this.goblinCleared
          ? '你已討伐蓋利隊長，不負所託！哥不林要塞暫告平定。「深層迴廊」的入口亦已開啟——若有餘力，可再探查。'
          : '城外哥不林異常活躍，恐怕與帝斯哈多有關。請前往「哥不林要塞」，查明並擊破其首領蓋利隊長。',
      );
    } else {
      this.dialogueSpeaker.setText('紅鞋少女');
      this.dialogueBody.setText(
        this.goblinCleared
          ? '聽說要塞裡有雙紅鞋子……如果你找到了，可以拿來給我嗎？（尚未實作掉落，之後再接）'
          : '我最喜歡紅鞋子了！聽說哥不林要塞某處藏著一雙……你出城的時候，幫我留意一下好嗎？',
      );
    }
    this.dialogueBox.setVisible(true);
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
