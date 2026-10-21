import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import type { Player } from './Player';
import { PathFollower, type TilePathfinder } from '../ai/TilePathfinder';

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

type Facing = 'down' | 'up' | 'left' | 'right';

/**
 * Captain Gully dungeon boss — tile A* chase + melee lunge.
 * Atlas: "gully" (darkbolt99 / Spriters Resource) — see gully-frame-map.json.
 */
export class Boss extends Phaser.Physics.Arcade.Sprite {
  readonly maxHp: number;
  hp: number;

  private target: Player | null = null;
  private pather: PathFollower | null = null;
  private facing: Facing = 'down';
  private iframeUntil = 0;
  private nextAttackAt = 0;
  private knockbackUntil = 0;
  private hurtUntil = 0;
  private attackingUntil = 0;
  private dying = false;
  private onDefeated?: () => void;

  private label: Phaser.GameObjects.Text;
  private hpText: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFg: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = DEFAULT_HP) {
    super(scene, x, y, 'gully', 'idle_0');

    this.maxHp = maxHp;
    this.hp = maxHp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

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

    this.hpBarBg = scene.add
      .rectangle(x, y - 28, 36, 4, 0x222222, 0.9)
      .setDepth(11)
      .setOrigin(0.5, 0.5);
    this.hpBarFg = scene.add
      .rectangle(x - 18, y - 28, 36, 4, 0xdd4444, 0.95)
      .setDepth(12)
      .setOrigin(0, 0.5);

    this.hpText = scene.add
      .text(x, y - 22, `${this.hp}/${this.maxHp}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffe8e8',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.refreshHpUi();
    this.play('gully-idle-down', true);
  }

  setTarget(player: Player): void {
    this.target = player;
  }

  setPathfinder(finder: TilePathfinder): void {
    this.pather = new PathFollower(finder, 450);
  }

  setOnDefeated(cb: () => void): void {
    this.onDefeated = cb;
  }

  /** @returns true if damage applied */
  takeDamage(amount: number, fromX: number, fromY: number): boolean {
    if (this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + IFRAME_MS;
    this.hurtUntil = now + 320;
    this.attackingUntil = 0;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshHpUi();
    GameAudio.get(this.scene)?.hit();

    this.play('gully-hurt', true);
    this.setTint(0xffffff);

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.knockbackUntil = now + 150;
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
    this.setFrame('defeat_0');
    this.anims.stop();
    this.setTint(0xff8888);
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setEnable(false);
    this.setVelocity(0, 0);

    this.scene.tweens.add({
      targets: [this, this.label, this.hpText, this.hpBarBg, this.hpBarFg],
      alpha: 0,
      duration: DEATH_FLASH_MS,
      onComplete: () => {
        this.onDefeated?.();
        this.destroy();
      },
    });
  }

  private refreshHpUi(): void {
    this.hpText.setText(`${this.hp}/${this.maxHp}`);
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.hpBarFg.width = Math.max(0, 36 * ratio);
    this.hpBarFg.fillColor = ratio > 0.5 ? 0xdd4444 : ratio > 0.25 ? 0xdd8844 : 0x882222;
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

    // Finish brief lunge window without re-pathing
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
      const blockedX = body.blocked.left || body.blocked.right || body.wasTouching.left || body.wasTouching.right;
      const blockedY = body.blocked.up || body.blocked.down || body.wasTouching.up || body.wasTouching.down;

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

    // Melee: stop, play attack, short lunge, deal 2 dmg
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

    this.label.setPosition(this.x, this.y - 36);
    this.hpText.setPosition(this.x, this.y - 22);
    this.hpBarBg.setPosition(this.x, this.y - 28);
    this.hpBarFg.setPosition(this.x - 18, this.y - 28);

    if (!this.dying && time < this.iframeUntil) {
      this.setTint(Math.floor(time / 40) % 2 === 0 ? 0xff8888 : 0xffffff);
    }
  }

  destroy(fromScene?: boolean): void {
    this.label?.destroy();
    this.hpText?.destroy();
    this.hpBarBg?.destroy();
    this.hpBarFg?.destroy();
    super.destroy(fromScene);
  }
}
