import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { CharacterBase } from './CharacterBase';
import type { Player } from './Player';
import { PathFollower, type TilePathfinder } from '../ai/TilePathfinder';

/**
 * Shared enemy/boss helpers: HP UI hooks, iframe tint, knockback reset, path follower.
 * Paste / Gully keep their own AI and anim keys in subclasses.
 */
export abstract class EnemyBase extends CharacterBase {
  protected target: Player | null = null;
  protected pather: PathFollower | null = null;
  protected knockbackUntil = 0;
  protected hurtUntil = 0;

  protected hpText?: Phaser.GameObjects.Text;
  protected hpBarBg?: Phaser.GameObjects.Rectangle;
  protected hpBarFg?: Phaser.GameObjects.Rectangle;
  protected hpBarWidth = 20;
  protected hpBarYOffset = 18;
  protected hpTextYOffset = 24;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame: string | number | undefined,
    maxHp: number,
    moveSpeed: number,
  ) {
    super(scene, x, y, texture, frame, maxHp, moveSpeed);
  }

  setTarget(player: Player): void {
    this.target = player;
  }

  setPathfinder(finder: TilePathfinder, repathMs = 400): void {
    this.pather = new PathFollower(finder, repathMs);
  }

  protected createHpUi(opts?: {
    barWidth?: number;
    barY?: number;
    textY?: number;
    barColor?: number;
    textColor?: string;
  }): void {
    const barW = opts?.barWidth ?? this.hpBarWidth;
    const barY = opts?.barY ?? this.hpBarYOffset;
    const textY = opts?.textY ?? this.hpTextYOffset;
    this.hpBarWidth = barW;
    this.hpBarYOffset = barY;
    this.hpTextYOffset = textY;

    this.hpBarBg = this.scene.add
      .rectangle(this.x, this.y - barY, barW, barW >= 30 ? 4 : 3, 0x222222, 0.85)
      .setDepth(9)
      .setOrigin(0.5, 0.5);
    this.hpBarFg = this.scene.add
      .rectangle(this.x - barW / 2, this.y - barY, barW, barW >= 30 ? 4 : 3, opts?.barColor ?? 0x44cc55, 0.95)
      .setDepth(10)
      .setOrigin(0, 0.5);
    this.hpText = this.scene.add
      .text(this.x, this.y - textY, `${this.hp}/${this.maxHp}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: opts?.textColor ?? '#e8ffe8',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);
    this.refreshHpUi();
  }

  protected refreshHpUi(): void {
    if (!this.hpText || !this.hpBarFg) return;
    this.hpText.setText(`${this.hp}/${this.maxHp}`);
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.hpBarFg.width = Math.max(0, this.hpBarWidth * ratio);
    this.colorHpBar(ratio);
  }

  protected colorHpBar(ratio: number): void {
    if (!this.hpBarFg) return;
    this.hpBarFg.fillColor = ratio > 0.5 ? 0x44cc55 : ratio > 0.25 ? 0xcccc44 : 0xcc4444;
  }

  protected syncHpUiPositions(): void {
    this.hpText?.setPosition(this.x, this.y - this.hpTextYOffset);
    this.hpBarBg?.setPosition(this.x, this.y - this.hpBarYOffset);
    this.hpBarFg?.setPosition(this.x - this.hpBarWidth / 2, this.y - this.hpBarYOffset);
  }

  protected override onHpChanged(_hp: number, _maxHp: number): void {
    this.refreshHpUi();
  }

  protected override onDamaged(_amount: number, _fromX: number, _fromY: number): void {
    GameAudio.get(this.scene)?.hit();
    this.hurtUntil = this.scene.time.now + this.getHurtFlashMs();
    this.pather?.reset();
  }

  protected getHurtFlashMs(): number {
    return 280;
  }

  protected applyEnemyKnockback(fromX: number, fromY: number, speed: number, durationMs: number): void {
    const now = this.scene.time.now;
    this.knockbackUntil = now + durationMs;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setMaxVelocity(speed, speed);
    this.applyKnockback(fromX, fromY, speed);
  }

  protected fadeAndDestroy(
    targets: Phaser.GameObjects.GameObject[],
    durationMs: number,
    onComplete?: () => void,
  ): void {
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setEnable(false);
    this.setVelocity(0, 0);
    this.scene.tweens.add({
      targets,
      alpha: 0,
      duration: durationMs,
      onComplete: () => {
        onComplete?.();
        this.destroy();
      },
    });
  }

  protected destroyHpUi(): void {
    this.hpText?.destroy();
    this.hpBarBg?.destroy();
    this.hpBarFg?.destroy();
  }

  destroy(fromScene?: boolean): void {
    this.destroyHpUi();
    super.destroy(fromScene);
  }
}
