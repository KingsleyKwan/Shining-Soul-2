import Phaser from 'phaser';
import type { Facing } from '../data/types';
import type { TilePathfinder } from '../ai/TilePathfinder';
import { EnemyBase } from './EnemyBase';

const DEFAULT_HP = 14;
const IFRAME_MS = 280;
const KNOCKBACK = 70;
const DEATH_FLASH_MS = 400;

/** Slower than Paste (58) and player (110). */
const CHASE_SPEED = 42;
const AGGRO_RANGE = 200;
const ATTACK_RANGE = 30;
const ATTACK_COOLDOWN_MS = 1100;
const ATTACK_DAMAGE = 2;
const LUNGE_SPEED = 120;
const LUNGE_MS = 160;

/**
 * Captain Gully dungeon boss — tile A* chase + melee lunge.
 * Extends EnemyBase; atlas "gully" (darkbolt99 / Spriters Resource).
 */
export class Boss extends EnemyBase {
  private nextAttackAt = 0;
  private attackingUntil = 0;
  private onDefeated?: () => void;
  private label!: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = DEFAULT_HP) {
    super(scene, x, y, 'gully', 'idle_0', maxHp, CHASE_SPEED);

    this.setDepth(9);
    this.setScale(2);
    this.setOrigin(0.5, 0.85);
    this.setCollideWorldBounds(true);
    this.setBounce(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(14, 16);
    body.setOffset(9, 14);
    body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);

    this.label = scene.add
      .text(x, y - 36, 'BOSS', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffcc66',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.createHpUi({
      barWidth: 36,
      barY: 28,
      textY: 22,
      barColor: 0xdd4444,
      textColor: '#ffe8e8',
    });
    // Boss HP bar sits above label depth
    this.hpBarBg?.setDepth(11);
    this.hpBarFg?.setDepth(12);
    this.hpText?.setDepth(12);

    this.play('gully-idle-down', true);
  }

  override setPathfinder(finder: TilePathfinder): void {
    super.setPathfinder(finder, 450);
  }

  setOnDefeated(cb: () => void): void {
    this.onDefeated = cb;
  }

  override setRoomPresent(present: boolean): void {
    super.setRoomPresent(present);
    if (!this.label?.scene) return;
    if ((this.dying || this.dead) && present) return;
    this.label.setVisible(present);
  }

  protected override getIframeMs(): number {
    return IFRAME_MS;
  }

  protected override getKnockbackSpeed(): number {
    return KNOCKBACK;
  }

  protected override getHurtFlashMs(): number {
    return 320;
  }

  protected override colorHpBar(ratio: number): void {
    if (!this.hpBarFg) return;
    this.hpBarFg.fillColor = ratio > 0.5 ? 0xdd4444 : ratio > 0.25 ? 0xdd8844 : 0x882222;
  }

  /**
   * @param iframeMs Hurt gate after this hit. Omit to keep the boss iframe.
   * @returns true if damage applied
   */
  override takeDamage(amount: number, fromX: number, fromY: number, iframeMs = IFRAME_MS): boolean {
    if (this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + iframeMs;
    this.hurtUntil = now + 320;
    this.attackingUntil = 0;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshHpUi();
    this.onDamaged(amount, fromX, fromY);

    this.play('gully-hurt', true);
    this.setTint(0xffffff);
    this.applyEnemyKnockback(fromX, fromY, KNOCKBACK, 150);

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
    this.setFrame('defeat_0');
    this.anims.stop();
    this.setTint(0xff8888);
    const ui = [this, this.label, this.hpText, this.hpBarBg, this.hpBarFg].filter(
      Boolean,
    ) as Phaser.GameObjects.GameObject[];
    this.fadeAndDestroy(ui, DEATH_FLASH_MS, () => this.onDefeated?.());
  }

  private facingFromDelta(dx: number, dy: number): Facing {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  private playWalk(): void {
    const key = `gully-walk-${this.facing}`;
    if (this.anims.currentAnim?.key !== key) this.play(key, true);
  }

  private playIdle(): void {
    const key = `gully-idle-${this.facing}`;
    if (this.anims.currentAnim?.key !== key) this.play(key, true);
  }

  private playAttack(): void {
    const key = `gully-attack-${this.facing}`;
    this.play(key, true);
  }

  private updateAi(time: number): void {
    if (this.dying || !this.active || !this.target || !this.target.active || this.target.isDead()) {
      this.setVelocity(0, 0);
      if (!this.dying) this.playIdle();
      return;
    }

    if (time < this.knockbackUntil || time < this.hurtUntil) {
      return;
    }

    if (time < this.attackingUntil) {
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
      this.playIdle();
      return;
    }

    if (dist > ATTACK_RANGE) {
      const blockedX =
        body.blocked.left || body.blocked.right || body.wasTouching.left || body.wasTouching.right;
      const blockedY =
        body.blocked.up || body.blocked.down || body.wasTouching.up || body.wasTouching.down;

      let vx: number;
      let vy: number;
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
        vx = v.x;
        vy = v.y;
      } else {
        const len = dist || 1;
        vx = (dx / len) * CHASE_SPEED;
        vy = (dy / len) * CHASE_SPEED;
      }
      this.setVelocity(vx, vy);
      this.facing = this.facingFromDelta(vx, vy);
      this.playWalk();
      return;
    }

    this.facing = this.facingFromDelta(dx, dy);
    this.setVelocity(0, 0);
    if (time >= this.nextAttackAt) {
      this.nextAttackAt = time + ATTACK_COOLDOWN_MS;
      this.attackingUntil = time + LUNGE_MS + 200;
      this.playAttack();
      this.pather?.reset();

      const len = dist || 1;
      body.setMaxVelocity(LUNGE_SPEED, LUNGE_SPEED);
      this.setVelocity((dx / len) * LUNGE_SPEED, (dy / len) * LUNGE_SPEED);

      this.scene.time.delayedCall(90, () => {
        if (!this.active || this.dying || !this.target) return;
        const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
        if (d <= ATTACK_RANGE + 12) {
          this.target.takeDamage(ATTACK_DAMAGE, this.x, this.y);
        }
      });

      this.scene.time.delayedCall(LUNGE_MS, () => {
        if (this.active && !this.dying) this.setVelocity(0, 0);
      });
    } else {
      this.playIdle();
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    this.updateAi(time);

    this.label?.setPosition(this.x, this.y - 36);
    this.syncHpUiPositions();
    this.flashIframeTint(time, 40);
  }

  override destroy(fromScene?: boolean): void {
    this.label?.destroy();
    super.destroy(fromScene);
  }
}
