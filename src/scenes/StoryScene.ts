import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { SELECTED_HERO_KEY, type HeroId } from '../data/players';
import * as SaveManager from '../systems/SaveManager';

type StoryCard = {
  speaker: string;
  body: string;
};

/**
 * Short Colosseum / Deatharte intro — dialogue cards only (no arena combat).
 * After the last card → VillageScene (葛蘭多爾城 lite).
 */
const INTRO_CARDS: StoryCard[] = [
  {
    speaker: '帝斯哈多',
    body: '公主已在我掌握之中……哈哈哈！葛蘭多爾的螻蟻，儘管掙扎吧！',
  },
  {
    speaker: '旁白',
    body: '卡蜜兒公主遭帝斯哈多擄走。黑暗之力籠罩王國，鬥技場上的試煉戛然而止。',
  },
  {
    speaker: '國王馬歇爾',
    body: '勇者啊……城外哥不林近日異常活躍。請你前往「哥不林要塞」調查，查明真相。',
  },
  {
    speaker: '旁白',
    body: '你接受國王的委託，離開簡易鬥技場，踏上通往葛蘭多爾城的路。',
  },
];

export class StoryScene extends Phaser.Scene {
  private index = 0;
  private speakerText?: Phaser.GameObjects.Text;
  private bodyText?: Phaser.GameObjects.Text;
  private progressText?: Phaser.GameObjects.Text;
  private advancing = false;
  private audio!: GameAudio;

  constructor() {
    super('StoryScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0c1418');
    this.index = 0;
    this.advancing = false;
    this.audio = GameAudio.attach(this);
    this.audio.startBgm('title');
    this.input.once('pointerdown', () => this.audio.ensurePlaying());

    this.add
      .rectangle(width / 2, height / 2, width - 24, height - 24, 0x152028, 0.96)
      .setStrokeStyle(2, 0x4a6a7a);

    this.add
      .text(width / 2, 22, '序章 · 簡易鬥技場', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#88aabb',
      })
      .setOrigin(0.5);

    this.speakerText = this.add
      .text(width / 2, 56, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffe066',
      })
      .setOrigin(0.5);

    this.bodyText = this.add
      .text(width / 2, height / 2 - 8, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e8f0f8',
        align: 'center',
        wordWrap: { width: width - 64 },
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    this.progressText = this.add
      .text(width / 2, height - 58, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#8899aa',
      })
      .setOrigin(0.5);

    const btnW = 160;
    const btnH = 32;
    const bg = this.add
      .rectangle(0, 0, btnW, btnH, 0x2a4a38, 0.95)
      .setStrokeStyle(2, 0x6dffa0);
    const caption = this.add
      .text(0, 0, '繼續', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#e8ffe8',
      })
      .setOrigin(0.5);
    const btn = this.add.container(width / 2, height - 28, [bg, caption]);
    btn.setSize(btnW, btnH);
    btn.setInteractive(
      new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
      Phaser.Geom.Rectangle.Contains,
    );
    if (btn.input) btn.input.cursor = 'pointer';
    btn.on('pointerover', () => bg.setFillStyle(0x3a6050, 1));
    btn.on('pointerout', () => bg.setFillStyle(0x2a4a38, 0.95));
    btn.on('pointerdown', () => this.advance());

    // Whole panel is tappable for mobile.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Ignore the button's own hit (it already advances); empty area also advances.
      if (pointer.y > height - 50) return;
      this.advance();
    });

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ENTER', () => this.advance());
      this.input.keyboard.on('keydown-SPACE', () => this.advance());
      this.input.keyboard.on('keydown-ESC', () => this.finish());
    }

    this.renderCard();
  }

  private renderCard(): void {
    const card = INTRO_CARDS[this.index];
    if (!card) {
      this.finish();
      return;
    }
    this.speakerText?.setText(card.speaker);
    this.bodyText?.setText(card.body);
    this.progressText?.setText(
      `${this.index + 1} / ${INTRO_CARDS.length} · 點擊卡片或「繼續」`,
    );
  }

  private advance(): void {
    if (this.advancing) return;
    this.audio.confirm();
    if (this.index >= INTRO_CARDS.length - 1) {
      this.finish(false);
      return;
    }
    this.index += 1;
    this.renderCard();
  }

  private finish(blip = true): void {
    if (this.advancing) return;
    if (blip) this.audio.confirm();
    this.advancing = true;

    const current = this.registry.get(SELECTED_HERO_KEY);
    const heroId: HeroId = SaveManager.isHeroId(current) ? current : 'eric';
    const existing = SaveManager.load();
    const next = SaveManager.mergeProfile(existing, {
      heroId,
      seenIntro: true,
      villageVisited: true,
    });
    SaveManager.save(next);
    this.registry.set(SELECTED_HERO_KEY, heroId);
    this.scene.start('VillageScene');
  }
}
