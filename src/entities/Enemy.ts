import Phaser from 'phaser';
import type { TilePathfinder } from '../ai/TilePathfinder';
import { EnemyBase } from './EnemyBase';

const DEFAULT_HP = 3;
const IFRAME_MS = 220;
const KNOCKBACK = 90;
const DEATH_FLASH_MS = 180;

/** Tuned slower than player (110). */
const CHASE_SPEED = 58;
const AGGRO_RANGE = 150;
const ATTACK_RANGE = 22;
const ATTACK_COOLDOWN_MS = 1250;

/**
 * Paste enemy (SS2 slime) — chase + melee with tile A* pathfinding.
 * Extends EnemyBase; atlas "paste" from Claire Starsword / Spriters Resource.
 */
export class Enemy extends EnemyBase {
  private nextAttackAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = DEFAULT_HP) {
    super(scene, x, y, 'paste', 'idle_0', maxHp, CHASE_SPEED);

    this.setDepth(8);
    this.setScale(2);
    this.setOrigin(0.5, 0.85);
    this.setCollideWorldBounds(true);
    this.setBounce(0);
    this.setDrag(0, 0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(14, 12);
    body.setOffset(6, 10);
    body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);

    this.createHpUi({
      barWidth: 20,
      barY: 18,
      textY: 24,
      barColor: 0x44cc55,
      textColor: '#e8ffe8',
    });

    this.play('paste-idle', true);
  }

  override setPathfinder(finder: TilePathfinder): void {
    super.setPathfinder(finder, 400);
  }

  protected override getIframeMs(): number {
    return IFRAME_MS;
  }

  protected override getKnockbackSpeed(): number {
    return KNOCKBACK;
  }

  protected override getHurtStunMs(): number {
    return 0;
  }

  protected override getHurtFlashMs(): number {
    return 280;
  }

  /**
   * @param iframeMs Hurt gate after this hit. Omit to keep the Paste iframe.
   * @returns true if damage was applied this call
   */
  override takeDamage(amount: number, fromX: number, fromY: number, iframeMs = IFRAME_MS): boolean {
    if (this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + iframeMs;
    this.hurtUntil = now + 280;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshHpUi();
    this.onDamaged(amount, fromX, fromY);

    this.play('paste-hurt', true);
    this.setTint(0xffffff);
    this.scene.tweens.add({
      targets: this,
      scaleX: 2.25,
      scaleY: 2.25,
      duration: 80,
      yoyo: true,
      onComplete: () => {
        if (!this.dying && this.active) this.setScale(2);
      },
    });

    this.applyEnemyKnockback(fromX, fromY, KNOCKBACK, 140);

    if (this.hp <= 0) {
      this.startDeath();
    } else {
      this.scene.time.delayedCall(iframeMs, () => {
        if (this.active && !this.dying) this.clearTint();
      });
    }

    return true;
  }

  protected override onDeathStarted(): void {
    this.play('paste-hurt', true);
    this.setTint(0xff6666);
    const ui = [this, this.hpText, this.hpBarBg, this.hpBarFg].filter(
      Boolean,
    ) as Phaser.GameObjects.GameObject[];
    this.fadeAndDestroy(ui, DEATH_FLASH_MS);
  }

  private updateAnim(chasing: boolean, time: number): void {
    if (this.dying) return;
    if (time < this.hurtUntil) {
      if (this.anims.currentAnim?.key !== 'paste-hurt') {
        this.play('paste-hurt', true);
      }
      return;
    }
    if (chasing) {
      if (this.anims.currentAnim?.key !== 'paste-walk') {
        this.play('paste-walk', true);
      }
    } else if (this.anims.currentAnim?.key !== 'paste-idle') {
      this.play('paste-idle', true);
    }
  }

  private updateAi(time: number): void {
    if (this.dying || !this.active || !this.target || !this.target.active || this.target.isDead()) {
      this.setVelocity(0, 0);
      this.updateAnim(false, time);
      return;
    }

    if (time < this.knockbackUntil) {
      this.updateAnim(false, time);
      return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > AGGRO_RANGE) {
      this.setVelocity(0, 0);
      this.pather?.reset();
      this.updateAnim(false, time);
      return;
    }

    if (dist > ATTACK_RANGE) {
      const blockedX =
        body.blocked.left || body.blocked.right || body.wasTouching.left || body.wasTouching.right;
      const blockedY =
        body.blocked.up || body.blocked.down || body.wasTouching.up || body.wasTouching.down;

      if (this.pather) {
        const v = this.pather.chaseVelocity(
          time,
          this.x,
          this.y,
          this.target.x,
          this.target.y,
          CHASE_SPEED,
          blockedX,
          blockedY,
        );
        this.setVelocity(v.x, v.y);
      } else {
        const len = dist || 1;
        this.setVelocity((dx / len) * CHASE_SPEED, (dy / len) * CHASE_SPEED);
      }
      this.updateAnim(true, time);
      return;
    }

    this.setVelocity(0, 0);
    this.updateAnim(true, time);
    if (time >= this.nextAttackAt) {
      this.nextAttackAt = time + ATTACK_COOLDOWN_MS;
      this.target.takeDamage(1, this.x, this.y);
      this.setTint(0xaaffff);
      this.scene.time.delayedCall(80, () => {
        if (this.active && !this.dying && this.scene.time.now >= this.iframeUntil) {
          this.clearTint();
        }
      });
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    this.updateAi(time);
    this.syncHpUiPositions();
    this.flashIframeTint(time, 40);
  }
}
