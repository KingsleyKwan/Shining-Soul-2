import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import type { Player } from './Player';
import { PathFollower, type TilePathfinder } from '../ai/TilePathfinder';

const DEFAULT_HP = 3;
const IFRAME_MS = 220;
const KNOCKBACK = 90;
const DEATH_FLASH_MS = 180;

/** Tuned slower than player (110). */
const CHASE_SPEED = 58;
const AGGRO_RANGE = 150;
const ATTACK_RANGE = 22;
const ATTACK_COOLDOWN_MS = 1000;

/**
 * Paste enemy (SS2 slime) — chase + melee with tile A* pathfinding.
 * Atlas: "paste" from Claire Starsword / Spriters Resource (see paste-frame-map.json).
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly maxHp: number;
  hp: number;

  private target: Player | null = null;
  private pather: PathFollower | null = null;
  private iframeUntil = 0;
  private nextAttackAt = 0;
  private knockbackUntil = 0;
  private hurtUntil = 0;
  private dying = false;
  private hpText: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFg: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = DEFAULT_HP) {
    super(scene, x, y, 'paste', 'idle_0');

    this.maxHp = maxHp;
    this.hp = maxHp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(8);
    this.setScale(2);
    this.setOrigin(0.5, 0.85);
    this.setCollideWorldBounds(true);
    this.setBounce(0);
    this.setDrag(0, 0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    // Paste frames ~20–27 wide; keep feet near origin
    body.setSize(14, 12);
    body.setOffset(6, 10);
    body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);

    this.hpBarBg = scene.add
      .rectangle(x, y - 18, 20, 3, 0x222222, 0.85)
      .setDepth(9)
      .setOrigin(0.5, 0.5);
    this.hpBarFg = scene.add
      .rectangle(x - 10, y - 18, 20, 3, 0x44cc55, 0.95)
      .setDepth(10)
      .setOrigin(0, 0.5);

    this.hpText = scene.add
      .text(x, y - 24, `${this.hp}/${this.maxHp}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#e8ffe8',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);

    this.refreshHpUi();
    this.play('paste-idle', true);
  }

  setTarget(player: Player): void {
    this.target = player;
  }

  setPathfinder(finder: TilePathfinder): void {
    this.pather = new PathFollower(finder, 400);
  }

  /** @returns true if damage was applied this call */
  takeDamage(amount: number, fromX: number, fromY: number): boolean {
    if (this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + IFRAME_MS;
    this.hurtUntil = now + 280;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshHpUi();
    GameAudio.get(this.scene)?.hit();

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

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.knockbackUntil = now + 140;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setMaxVelocity(KNOCKBACK, KNOCKBACK);
    this.setVelocity((dx / len) * KNOCKBACK, (dy / len) * KNOCKBACK);
    this.pather?.reset();

    if (this.hp <= 0) {
      this.startDeath();
    } else {
      this.scene.time.delayedCall(IFRAME_MS, () => {
        if (this.active && !this.dying) this.clearTint();
      });
    }

    return true;
  }

  private startDeath(): void {
    this.dying = true;
    this.play('paste-hurt', true);
    this.setTint(0xff6666);
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setEnable(false);
    this.setVelocity(0, 0);

    this.scene.tweens.add({
      targets: [this, this.hpText, this.hpBarBg, this.hpBarFg],
      alpha: 0,
      duration: DEATH_FLASH_MS,
      onComplete: () => this.destroy(),
    });
  }

  private refreshHpUi(): void {
    this.hpText.setText(`${this.hp}/${this.maxHp}`);
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.hpBarFg.width = Math.max(0, 20 * ratio);
    this.hpBarFg.fillColor = ratio > 0.5 ? 0x44cc55 : ratio > 0.25 ? 0xcccc44 : 0xcc4444;
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
      const blockedX = body.blocked.left || body.blocked.right || body.wasTouching.left || body.wasTouching.right;
      const blockedY = body.blocked.up || body.blocked.down || body.wasTouching.up || body.wasTouching.down;

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
    this.updateAnim(true, time); // bob while in melee
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

    this.hpText.setPosition(this.x, this.y - 24);
    this.hpBarBg.setPosition(this.x, this.y - 18);
    this.hpBarFg.setPosition(this.x - 10, this.y - 18);

    if (!this.dying && time < this.iframeUntil) {
      this.setTint(Math.floor(time / 40) % 2 === 0 ? 0xff8888 : 0xffffff);
    }
  }

  destroy(fromScene?: boolean): void {
    this.hpText?.destroy();
    this.hpBarBg?.destroy();
    this.hpBarFg?.destroy();
    super.destroy(fromScene);
  }
}
