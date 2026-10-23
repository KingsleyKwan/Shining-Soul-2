import Phaser from 'phaser';
import type { Facing } from '../data/types';

/**
 * Shared arcade character: move helpers, collide-ready body, hurt / HP / facing.
 * PlayerBase / EnemyBase extend this; combat numbers stay on subclasses / data.
 */
export abstract class CharacterBase extends Phaser.Physics.Arcade.Sprite {
  facing: Facing = 'down';
  maxHp: number;
  hp: number;

  protected moveSpeed: number;
  protected stunned = false;
  protected dead = false;
  protected dying = false;
  protected iframeUntil = 0;
  protected stunUntil = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame: string | number | undefined,
    maxHp: number,
    moveSpeed: number,
  ) {
    super(scene, x, y, texture, frame);
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.moveSpeed = moveSpeed;

    scene.add.existing(this);
    scene.physics.add.existing(this);
  }

  isDead(): boolean {
    return this.dead || this.dying;
  }

  isDying(): boolean {
    return this.dying;
  }

  /** Heal up to maxHp. @returns amount actually restored */
  heal(amount: number): number {
    if (this.dead || this.dying || !this.active || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const gained = this.hp - before;
    if (gained > 0) this.onHpChanged(this.hp, this.maxHp);
    return gained;
  }

  /**
   * Apply damage with iframe gate. Subclasses implement visual / death via hooks.
   * @returns true if damage applied
   */
  takeDamage(amount: number, fromX: number, fromY: number): boolean {
    if (this.dead || this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + this.getIframeMs();
    this.hp = Math.max(0, this.hp - amount);
    this.onHpChanged(this.hp, this.maxHp);
    this.onDamaged(amount, fromX, fromY);

    this.applyKnockback(fromX, fromY, this.getKnockbackSpeed());

    if (this.hp <= 0) {
      this.startDeath();
      return true;
    }

    this.beginHurtStun(now);
    return true;
  }

  protected applyKnockback(fromX: number, fromY: number, speed: number): void {
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.setVelocity((dx / len) * speed, (dy / len) * speed);
  }

  protected updateFacingFromVector(vx: number, vy: number): void {
    if (Math.abs(vx) > Math.abs(vy)) {
      this.facing = vx < 0 ? 'left' : 'right';
    } else if (Math.abs(vy) > 0) {
      this.facing = vy < 0 ? 'up' : 'down';
    }
  }

  protected flashIframeTint(time: number, period = 50): void {
    if (!this.dying && time < this.iframeUntil) {
      this.setTint(Math.floor(time / period) % 2 === 0 ? 0xff8888 : 0xffffff);
    }
  }

  /** Override for class-specific iframe length. */
  protected getIframeMs(): number {
    return 220;
  }

  protected getKnockbackSpeed(): number {
    return 90;
  }

  protected getHurtStunMs(): number {
    return 300;
  }

  protected onHpChanged(_hp: number, _maxHp: number): void {}

  protected onDamaged(_amount: number, _fromX: number, _fromY: number): void {}

  protected beginHurtStun(now: number): void {
    const stunMs = this.getHurtStunMs();
    this.stunned = true;
    this.stunUntil = now + stunMs;
    this.onHurtStunStarted();
    this.scene.time.delayedCall(stunMs, () => {
      if (!this.active || this.dying || this.dead) return;
      this.stunned = false;
      this.onHurtStunEnded();
    });
  }

  protected onHurtStunStarted(): void {}
  protected onHurtStunEnded(): void {}

  protected startDeath(): void {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.stunned = true;
    this.setVelocity(0, 0);
    this.onDeathStarted();
  }

  protected onDeathStarted(): void {}

  protected markDead(): void {
    this.dead = true;
    this.dying = false;
  }
}
