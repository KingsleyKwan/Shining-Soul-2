import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { HEROES, SELECTED_HERO_KEY, type HeroId } from '../data/players';
import { SELECTED_STAGE_KEY, getStage, type StageId } from '../data/stages';
import * as SaveManager from '../systems/SaveManager';

type NpcKind = 'king' | 'girl' | null;

type Spot = { x: number; y: number; w: number; h: number };

/**
 * 葛蘭多爾城 lite — painted plaza after the intro / after a stage clear.
 * Hotspots keep the king, red-shoe girl, fort depart, stage select, and character select.
 */
export class VillageScene extends Phaser.Scene {
  private dialogueBox?: Phaser.GameObjects.Container;
  private dialogueSpeaker?: Phaser.GameObjects.Text;
  private dialogueBody?: Phaser.GameObjects.Text;
  private activeNpc: NpcKind = null;
  private goblinCleared = false;
  private heroId: HeroId = 'eric';
  private audio!: GameAudio;

  constructor() {
    super('VillageScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#87c4ea');

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

    this.audio = GameAudio.attach(this);
    this.audio.startBgm('village');

    const heroLabel = HEROES[this.heroId]?.label ?? this.heroId;
    const spots = this.hubSpots(width, height);
    this.paintPlaza(width, height, spots);
    this.placeHero(spots.fountain.x, spots.fountain.y + 22);

    this.add
      .text(width / 2, 12, '葛蘭多爾城', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#fff8e8',
        stroke: '#3a2a18',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(12);
    this.add
      .text(width / 2, 30, `村莊據點 · ${heroLabel}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#fff4d8',
        stroke: '#3a2a18',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(12);
    this.add
      .text(
        width / 2,
        46,
        this.goblinCleared ? '要塞已平定 · 國王等候回報' : '國王委託 · 調查哥不林要塞',
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: this.goblinCleared ? '#e8ffe8' : '#ffe7a0',
          stroke: '#2a2010',
          strokeThickness: 2,
        },
      )
      .setOrigin(0.5)
      .setDepth(12);

    this.addHotspot(spots.back, '返回選角', 0x243038, 0x9ab0c0, '#e4eef4', () => {
      this.scene.start('SelectScene');
    }, '12px');
    this.addHotspot(spots.king, '國王馬歇爾', 0x6a4424, 0xffe08a, '#fff4d0', () => {
      this.openNpc('king');
    });
    this.addHotspot(spots.girl, '紅鞋少女', 0x7a3040, 0xffb0c4, '#ffe8ee', () => {
      this.openNpc('girl');
    });
    this.addHotspot(spots.board, '關卡選擇', 0x5a4630, 0xe0c080, '#fff6e0', () => {
      this.scene.start('StageSelectScene');
    });
    this.addHotspot(
      spots.gate,
      '出發 · 哥不林要塞',
      0x2e5a30,
      0xb6f0a0,
      '#eaffe4',
      () => this.departStage(1),
      '13px',
      true,
    );

    this.buildDialogueOverlay();
    this.input.on('pointerdown', () => this.audio.ensurePlaying());

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => {
        if (this.activeNpc) this.closeDialogue();
        else {
          this.audio.confirm();
          this.scene.start('SelectScene');
        }
      });
      this.input.keyboard.on('keydown-ENTER', () => {
        if (this.activeNpc) this.closeDialogue();
      });
      this.input.keyboard.on('keydown-SPACE', () => {
        if (this.activeNpc) this.closeDialogue();
      });
      this.input.keyboard.on('keydown-ONE', () => {
        this.audio.confirm();
        this.departStage(1);
      });
    }
  }

  /** Layout from the live canvas (EXPAND may be taller/wider than 480×320). */
  private hubSpots(w: number, h: number): {
    back: Spot;
    king: Spot;
    girl: Spot;
    board: Spot;
    gate: Spot;
    fountain: { x: number; y: number };
  } {
    return {
      back: { x: 64, y: 24, w: 112, h: 48 },
      king: { x: w / 2, y: 124, w: 176, h: 52 },
      girl: { x: Math.round(w * 0.24), y: 198, w: 140, h: 52 },
      board: { x: Math.round(w * 0.76), y: 198, w: 140, h: 52 },
      gate: { x: w / 2, y: h - 52, w: 224, h: 52 },
      fountain: { x: w / 2, y: 206 },
    };
  }

  private paintPlaza(
    w: number,
    h: number,
    spots: { king: Spot; girl: Spot; board: Spot; gate: Spot; fountain: { x: number; y: number } },
  ): void {
    const g = this.add.graphics().setDepth(0);
    const cx = w / 2;

    g.fillStyle(0x8ec8ef, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0xc5e6f8, 1);
    g.fillRect(0, 0, w, 40);
    g.fillStyle(0xffe7a0, 1);
    g.fillCircle(w - 34, 26, 14);
    g.fillStyle(0xfff6d0, 1);
    g.fillCircle(w - 30, 22, 7);

    g.fillStyle(0x6ea45a, 1);
    g.fillEllipse(w * 0.28, 86, 240, 48);
    g.fillStyle(0x5b9450, 1);
    g.fillEllipse(w * 0.74, 90, 280, 52);

    g.fillStyle(0x4c8c3c, 1);
    g.fillRect(0, 100, w, h - 100);
    g.fillStyle(0x3e7832, 1);
    for (let x = 0; x < w; x += 18) g.fillRect(x, 100, 8, h - 100);

    // Castle facade across the north edge.
    const tower = (x: number) => {
      g.fillStyle(0x7a3030, 1);
      g.fillTriangle(x - 4, 58, x + 27, 36, x + 58, 58);
      g.fillStyle(0x8d7562, 1);
      g.fillRect(x, 54, 54, 78);
      g.fillStyle(0x5c4638, 1);
      g.fillRect(x, 54, 54, 8);
      g.fillStyle(0xf0d080, 1);
      g.fillRect(x + 12, 72, 8, 12);
      g.fillRect(x + 34, 72, 8, 12);
    };
    tower(22);
    tower(w - 76);

    g.fillStyle(0x7a3030, 1);
    g.fillRect(70, 58, w - 140, 10);
    g.fillStyle(0x8d7562, 1);
    g.fillRect(70, 68, w - 140, 58);
    g.fillStyle(0x5c4638, 1);
    for (let x = 78; x < w - 78; x += 18) g.fillRect(x, 60, 10, 10);
    g.fillStyle(0xf0d080, 1);
    g.fillRect(cx - 70, 82, 8, 14);
    g.fillRect(cx + 62, 82, 8, 14);
    g.fillRect(cx - 110, 86, 8, 12);
    g.fillRect(cx + 102, 86, 8, 12);

    // Door and steps — the king hotspot sits on the steps.
    g.fillStyle(0x3a2416, 1);
    g.fillRect(cx - 22, 78, 44, 42);
    g.fillStyle(0x6a4428, 1);
    g.fillRect(cx - 26, 74, 52, 8);
    g.fillStyle(0xc4b49a, 1);
    g.fillRect(cx - 40, 116, 80, 8);
    g.fillRect(cx - 52, 124, 104, 8);
    g.fillStyle(0xe8d8bc, 1);
    g.fillRect(cx - 8, 96, 16, 20);

    // Banners.
    const hang = (x: number, color: number) => {
      const cloth = this.add.rectangle(x, 78, 12, 26, color).setOrigin(0.5, 0).setDepth(2);
      this.tweens.add({
        targets: cloth,
        angle: 7,
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    };
    hang(118, 0xb4333a);
    hang(w - 118, 0xe2b34a);

    // Stone plaza.
    const plazaTop = 146;
    for (let y = plazaTop; y < h - 8; y += 16) {
      for (let x = 28; x < w - 28; x += 16) {
        const odd = ((x / 16) + (y / 16)) % 2 < 1;
        g.fillStyle(odd ? 0xcfc3b0 : 0xb3a48f, 1);
        g.fillRect(x, y, 16, 16);
      }
    }
    g.lineStyle(2, 0x8a7b68, 1);
    g.strokeRect(28, plazaTop, w - 56, h - plazaTop - 8);

    // Road south, under the depart gate.
    for (let y = 214; y < h; y += 12) {
      g.fillStyle(y % 24 === 0 ? 0x8d8072 : 0x7a6e62, 1);
      g.fillRect(cx - 44, y, 88, 12);
    }

    // Fountain.
    const fx = spots.fountain.x;
    const fy = spots.fountain.y;
    g.fillStyle(0xd9d3c8, 1);
    g.fillEllipse(fx, fy, 54, 28);
    g.fillStyle(0x5eb0d4, 1);
    g.fillEllipse(fx, fy, 34, 16);
    g.fillStyle(0xe8f4ff, 0.8);
    g.fillCircle(fx, fy - 2, 3);
    const water = this.add.circle(fx, fy, 8, 0x7ec8ea, 0.85).setDepth(2);
    this.tweens.add({
      targets: water,
      scale: 1.2,
      alpha: 0.45,
      duration: 900,
      yoyo: true,
      repeat: -1,
    });

    // Trees framing the road.
    const tree = (x: number, y: number) => {
      g.fillStyle(0x6b4428, 1);
      g.fillRect(x - 3, y, 6, 16);
      g.fillStyle(0x2f7a32, 1);
      g.fillCircle(x, y - 2, 14);
      g.fillStyle(0x4ea04a, 1);
      g.fillCircle(x - 5, y - 6, 8);
    };
    tree(22, 236);
    tree(w - 22, 236);
    tree(spots.girl.x - 62, 176);
    tree(spots.board.x + 62, 176);

    // Red-shoe girl, standing just above her sign.
    const gx = spots.girl.x;
    const gy = spots.girl.y - 38;
    g.fillStyle(0xf0d0b0, 1);
    g.fillCircle(gx, gy - 16, 5);
    g.fillStyle(0xf4e4c4, 1);
    g.fillRect(gx - 5, gy - 12, 10, 12);
    g.fillStyle(0xc43b4a, 1);
    g.fillRect(gx - 6, gy - 2, 12, 10);
    g.fillStyle(0xb42030, 1);
    g.fillRect(gx - 6, gy + 8, 5, 3);
    g.fillRect(gx + 1, gy + 8, 5, 3);

    // Notice board posts under the stage-select sign.
    g.fillStyle(0x6b4a2c, 1);
    g.fillRect(spots.board.x - 28, spots.board.y + 10, 6, 28);
    g.fillRect(spots.board.x + 22, spots.board.y + 10, 6, 28);

    // South gate behind the depart sign.
    g.fillStyle(0x6a4328, 1);
    g.fillRect(spots.gate.x - 78, spots.gate.y - 8, 12, 40);
    g.fillRect(spots.gate.x + 66, spots.gate.y - 8, 12, 40);
    g.fillStyle(0x8a5a30, 1);
    g.fillRect(spots.gate.x - 78, spots.gate.y - 16, 156, 10);
    g.fillStyle(0xf0d080, 1);
    g.fillRect(spots.gate.x - 4, spots.gate.y - 14, 8, 6);
  }

  private placeHero(x: number, y: number): void {
    const hero = HEROES[this.heroId];
    if (!hero) return;
    const sprite = this.add
      .sprite(x, y, hero.atlas, hero.previewFrame)
      .setScale(2)
      .setOrigin(0.5, 0.85)
      .setDepth(5);
    this.tweens.add({
      targets: sprite,
      y: y - 4,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private addHotspot(
    spot: Spot,
    label: string,
    fill: number,
    stroke: number,
    labelColor: string,
    onClick: () => void,
    fontSize = '13px',
    pulse = false,
  ): void {
    const bg = this.add.rectangle(0, 0, spot.w, spot.h, fill, 0.94).setStrokeStyle(3, stroke);
    const caption = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize,
        color: labelColor,
      })
      .setOrigin(0.5);
    const c = this.add.container(spot.x, spot.y, [bg, caption]).setDepth(8);
    c.setSize(spot.w, spot.h);
    c.setInteractive(
      new Phaser.Geom.Rectangle(-spot.w / 2, -spot.h / 2, spot.w, spot.h),
      Phaser.Geom.Rectangle.Contains,
    );
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => bg.setStrokeStyle(3, 0xfff3b0));
    c.on('pointerout', () => bg.setStrokeStyle(3, stroke));
    c.on('pointerdown', () => {
      this.audio.confirm();
      onClick();
    });
    if (pulse) {
      this.tweens.add({
        targets: bg,
        alpha: 0.72,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
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
