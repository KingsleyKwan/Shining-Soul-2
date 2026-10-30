import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { HERO_ORDER, HEROES } from '../data/players';

/**
 * Loads atlases + dungeon tiles + audio; registers anims; goes to character select.
 * The room layout is built per run in GameScene (see MapGenerator).
 *
 * Credits (fan learning only):
 * - Eric / Prim / Raizen / Paste: Claire Starsword @ The Spriters Resource
 * - Ryle atlas: recolored Claire Starsword hero sheet (same source as eric/prim/raizen),
 *   palette-shifted for the archer. Arrow VFX are procedural.
 * - Captain Gully: darkbolt99 @ The Spriters Resource
 * - Hub NPCs: original pixel standees packed by make_npc_atlas.py
 * - Map tiles: original placeholders (Spriters has no SS2 tilesets)
 */
export class BootScene extends Phaser.Scene {
  private loadTrack?: Phaser.GameObjects.Graphics;
  private loadFill?: Phaser.GameObjects.Graphics;
  private loadLabel?: Phaser.GameObjects.Text;
  private onLoadProgress?: (value: number) => void;

  constructor() {
    super('BootScene');
  }

  preload(): void {
    const cam = this.cameras.main;
    const barW = 160;
    const barH = 8;
    const x = Math.round(cam.centerX - barW / 2);
    const y = Math.round(cam.centerY);

    this.loadTrack = this.add.graphics();
    this.loadTrack.fillStyle(0x0e1a0e, 1);
    this.loadTrack.fillRect(x - 1, y - 1, barW + 2, barH + 2);

    this.loadFill = this.add.graphics();
    this.loadLabel = this.add
      .text(Math.round(cam.centerX), y - 4, '載入中… 0%', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d8ffd8',
        resolution: 1,
      })
      .setOrigin(0.5, 1);

    this.onLoadProgress = (value: number) => {
      const clamped = Phaser.Math.Clamp(value, 0, 1);
      const pct = Math.round(clamped * 100);
      const fill = this.loadFill;
      if (fill) {
        fill.clear();
        const w = Math.round(barW * clamped);
        if (w > 0) {
          fill.fillStyle(0x6dff6d, 1);
          fill.fillRect(x, y, w, barH);
        }
      }
      this.loadLabel?.setText(`載入中… ${pct}%`);
    };
    this.load.on('progress', this.onLoadProgress);

    this.load.atlas('eric', 'assets/generated/eric-atlas.png', 'assets/generated/eric-atlas.json');
    this.load.atlas('prim', 'assets/generated/prim-atlas.png', 'assets/generated/prim-atlas.json');
    this.load.atlas(
      'raizen',
      'assets/generated/raizen-atlas.png',
      'assets/generated/raizen-atlas.json',
    );
    this.load.atlas(
      'ryle',
      'assets/generated/ryle-atlas.png',
      'assets/generated/ryle-atlas.json',
    );
    this.load.atlas(
      'paste',
      'assets/generated/paste-atlas.png',
      'assets/generated/paste-atlas.json',
    );
    this.load.atlas(
      'gully',
      'assets/generated/gully-atlas.png',
      'assets/generated/gully-atlas.json',
    );
    this.load.atlas('npc', 'assets/generated/npc-atlas.png', 'assets/generated/npc-atlas.json');
    this.load.image('dungeon-tiles', 'assets/maps/dungeon-tiles.png');
    GameAudio.preload(this);
  }

  create(): void {
    if (this.onLoadProgress) {
      this.load.off('progress', this.onLoadProgress);
      this.onLoadProgress = undefined;
    }
    this.loadTrack?.destroy();
    this.loadFill?.destroy();
    this.loadLabel?.destroy();
    this.loadTrack = undefined;
    this.loadFill = undefined;
    this.loadLabel = undefined;

    this.createHeroAnimations();
    this.createEnemyAnimations();
    this.createNpcAnimations();
    this.scene.start('SelectScene');
  }

  private createHeroAnimations(): void {
    for (const id of HERO_ORDER) {
      const hero = HEROES[id];
      const atlas = hero.atlas;
      const p = hero.anim; // anim key prefix

      const mk = (
        key: string,
        prefix: string,
        end: number,
        rate: number,
        repeat: number,
      ) => {
        const full = `${p}-${key}`;
        if (this.anims.exists(full)) return;
        this.anims.create({
          key: full,
          frames: this.anims.generateFrameNames(atlas, {
            prefix: `${prefix}_`,
            start: 0,
            end,
          }),
          frameRate: rate,
          repeat,
        });
      };

      mk('walk-down', 'walk_down', 4, 8, -1);
      mk('walk-up', 'walk_up', 4, 8, -1);
      mk('walk-left', 'walk_left', 3, 8, -1);
      mk('attack-down', 'attack_down', 3, 12, 0);
      mk('attack-up', 'attack_up', 3, 12, 0);
      mk('attack-left', 'attack_left', 3, 12, 0);
      mk('attack-right', 'attack_right', 3, 12, 0);
      mk('hurt-down', 'hurt_down', 0, 1, 0);
      mk('hurt-up', 'hurt_up', 0, 1, 0);
      mk('hurt-left', 'hurt_left', 0, 1, 0);
      mk('hurt-right', 'hurt_right', 0, 1, 0);
      mk('death', 'death', 4, 8, 0);
    }
  }

  private createEnemyAnimations(): void {
    if (!this.anims.exists('paste-idle')) {
      this.anims.create({
        key: 'paste-idle',
        frames: [
          { key: 'paste', frame: 'idle_0' },
          { key: 'paste', frame: 'walk_1' },
          { key: 'paste', frame: 'idle_0' },
          { key: 'paste', frame: 'walk_2' },
        ],
        frameRate: 4,
        repeat: -1,
      });
    }
    if (!this.anims.exists('paste-walk')) {
      this.anims.create({
        key: 'paste-walk',
        frames: this.anims.generateFrameNames('paste', {
          prefix: 'walk_',
          start: 0,
          end: 2,
        }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists('paste-hurt')) {
      this.anims.create({
        key: 'paste-hurt',
        frames: this.anims.generateFrameNames('paste', {
          prefix: 'hurt_',
          start: 0,
          end: 2,
        }),
        frameRate: 10,
        repeat: 0,
      });
    }

    const dirs = ['down', 'up', 'left', 'right'] as const;
    for (const d of dirs) {
      const walkKey = `gully-walk-${d}`;
      if (!this.anims.exists(walkKey)) {
        this.anims.create({
          key: walkKey,
          frames: this.anims.generateFrameNames('gully', {
            prefix: `walk_${d}_`,
            start: 0,
            end: 3,
          }),
          frameRate: 7,
          repeat: -1,
        });
      }
      const idleKey = `gully-idle-${d}`;
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: [{ key: 'gully', frame: `walk_${d}_0` }],
          frameRate: 1,
          repeat: -1,
        });
      }
      const atkKey = `gully-attack-${d}`;
      if (!this.anims.exists(atkKey)) {
        this.anims.create({
          key: atkKey,
          frames: this.anims.generateFrameNames('gully', {
            prefix: `attack_${d}_`,
            start: 0,
            end: 3,
          }),
          frameRate: 10,
          repeat: 0,
        });
      }
    }
    if (!this.anims.exists('gully-hurt')) {
      this.anims.create({
        key: 'gully-hurt',
        frames: [{ key: 'gully', frame: 'hurt_0' }],
        frameRate: 1,
        repeat: 0,
      });
    }
  }

  private createNpcAnimations(): void {
    if (!this.anims.exists('npc-king-idle')) {
      this.anims.create({
        key: 'npc-king-idle',
        frames: [
          { key: 'npc', frame: 'king_idle_0' },
          { key: 'npc', frame: 'king_idle_1' },
        ],
        frameRate: 3,
        repeat: -1,
      });
    }
    if (!this.anims.exists('npc-girl-idle')) {
      this.anims.create({
        key: 'npc-girl-idle',
        frames: [
          { key: 'npc', frame: 'girl_idle_0' },
          { key: 'npc', frame: 'girl_idle_1' },
        ],
        frameRate: 3,
        repeat: -1,
      });
    }
  }
}
