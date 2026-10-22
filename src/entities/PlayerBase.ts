import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { FourDirAnimController } from '../anim/FourDirAnimController';
import type { HeroDef, PlayerData } from '../data/types';
import { CharacterBase } from './CharacterBase';

const HITBOX_LIFE_MS = 200;
const HITBOX_W = 28;
const HITBOX_H = 28;
const HITBOX_REACH = 22;

const PLAYER_IFRAME_MS = 550;
const HURT_STUN_MS = 300;

/** Move in [-1, 1] plus an attack edge. Keyboard and touch both feed this. */
export type PlayerInput = {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
};

/**
 * Data-driven playable hero. One class + PlayerData (Eric / Prim / Raizen / future).
 * Mechanics live here; stats / anim sheets / weapon stubs come from data.
 */
export class PlayerBase extends CharacterBase {
  readonly playerData: PlayerData;
  /** Flat HeroDef for HUD / select compat. */
  readonly hero: HeroDef;

  private attacking = false;
  private hitbox?: Phaser.GameObjects.Zone;
  private onHitboxSpawn?: (zone: Phaser.GameObjects.Zone) => void;
  private onHpChange?: (hp: number, maxHp: number) => void;
  private onDeath?: () => void;
  private skipAttackOnce = false;
  protected readonly animCtl: FourDirAnimController;

  constructor(scene: Phaser.Scene, x: number, y: number, hero: HeroDef) {
    const data = hero.data;
    super(scene, x, y, data.anim.atlas, data.anim.previewFrame, data.stats.maxHp, data.stats.speed);

    this.hero = hero;
    this.playerData = data;
    this.animCtl = new FourDirAnimController(this, data.anim);

    this.setCollideWorldBounds(true);
    this.setDepth(10);
    this.setScale(2);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 14);
    body.setOffset(5, 12);

    this.on('animationcomplete', this.onAnimComplete, this);
  }

  setHitboxHandler(handler: (zone: Phaser.GameObjects.Zone) => void): void {
    this.onHitboxSpawn = handler;
  }

  setHudHandlers(handlers: {
    onHpChange?: (hp: number, maxHp: number) => void;
    onDeath?: () => void;
  }): void {
    this.onHpChange = handlers.onHpChange;
    this.onDeath = handlers.onDeath;
    this.onHpChange?.(this.hp, this.maxHp);
  }

  isAttacking(): boolean {
    return this.attacking;
  }

  /** Skip the next Space/Z attack (used when Space opens a chest). */
  suppressNextAttack(): void {
    this.skipAttackOnce = true;
  }

  protected override getIframeMs(): number {
    return PLAYER_IFRAME_MS;
  }

  protected override getKnockbackSpeed(): number {
    return 100;
  }

  protected override getHurtStunMs(): number {
    return HURT_STUN_MS;
  }

  protected override onHpChanged(hp: number, maxHp: number): void {
    this.onHpChange?.(hp, maxHp);
  }

  protected override onDamaged(_amount: number, _fromX: number, _fromY: number): void {
    GameAudio.get(this.scene)?.hurt();
    this.attacking = false;
    this.clearHitbox();
    this.setTint(0xff6666);
    this.scene.cameras.main.shake(80, 0.004);
  }

  protected override onHurtStunStarted(): void {
    this.animCtl.setFacing(this.facing);
    this.animCtl.playHurt();
    this.scene.time.delayedCall(PLAYER_IFRAME_MS, () => {
      if (this.active && !this.dead && !this.dying && !this.stunned) this.clearTint();
    });
  }

  protected override onHurtStunEnded(): void {
    this.clearTint();
    this.animCtl.setFacing(this.facing);
    this.animCtl.playIdle();
  }

  protected override onDeathStarted(): void {
    this.attacking = false;
    this.clearHitbox();
    this.clearTint();
    this.animCtl.setFacing(this.facing);
    this.animCtl.playFaint();
  }

  handleInput(input: PlayerInput, _delta: number): void {
    if (this.dead || this.dying) {
      this.setVelocity(0, 0);
      return;
    }

    if (this.stunned) {
      const now = this.scene.time.now;
      if (now >= this.stunUntil) {
        this.stunned = false;
      } else {
        return;
      }
    }

    if (this.skipAttackOnce) {
      this.skipAttackOnce = false;
    } else if (input.attackPressed && !this.attacking) {
      this.startAttack();
    }

    const ix = input.moveX;
    const iy = input.moveY;
    let vx = 0;
    let vy = 0;

    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy) || 1;
      const mag = Math.min(1, len);
      const speed = (this.attacking ? this.moveSpeed * 0.35 : this.moveSpeed) * mag;
      vx = (ix / len) * speed;
      vy = (iy / len) * speed;

      if (!this.attacking) {
        this.updateFacingFromVector(vx, vy);
        this.animCtl.setFacing(this.facing);
      }
      this.setVelocity(vx, vy);
    } else if (!this.attacking) {
      const now = this.scene.time.now;
      if (now >= this.iframeUntil - PLAYER_IFRAME_MS + 120) {
        this.setVelocity(0, 0);
      }
    }

    if (!this.attacking) {
      const moving = Math.abs(vx) + Math.abs(vy) > 1;
      this.animCtl.setFacing(this.facing);
      this.animCtl.playWalk(moving);
    }

    if (!this.attacking && this.iframeUntil > this.scene.time.now) {
      this.flashIframeTint(this.scene.time.now, 50);
    }
  }

  private startAttack(): void {
    GameAudio.get(this.scene)?.slash();
    this.attacking = true;
    this.setVelocity(0, 0);
    this.animCtl.setFacing(this.facing);
    this.animCtl.playAttack();
    this.spawnHitbox();
  }

  private spawnHitbox(): void {
    this.clearHitbox();

    let ox = 0;
    let oy = 0;
    switch (this.facing) {
      case 'left':
        ox = -HITBOX_REACH;
        break;
      case 'right':
        ox = HITBOX_REACH;
        break;
      case 'up':
        oy = -HITBOX_REACH;
        break;
      case 'down':
        oy = HITBOX_REACH;
        break;
    }

    const zone = this.scene.add.zone(this.x + ox, this.y + oy, HITBOX_W, HITBOX_H);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);

    const g = this.scene.add.graphics().setDepth(20);
    g.lineStyle(1, 0xffee88, 0.7);
    g.strokeRect(zone.x - HITBOX_W / 2, zone.y - HITBOX_H / 2, HITBOX_W, HITBOX_H);
    zone.setData('debugGfx', g);

    this.hitbox = zone;
    this.onHitboxSpawn?.(zone);

    this.scene.time.delayedCall(HITBOX_LIFE_MS, () => this.clearHitbox());
  }

  private clearHitbox(): void {
    if (!this.hitbox) return;
    const g = this.hitbox.getData('debugGfx') as Phaser.GameObjects.Graphics | undefined;
    g?.destroy();
    this.hitbox.destroy();
    this.hitbox = undefined;
  }

  private onAnimComplete(
    anim: Phaser.Animations.Animation,
    _frame: Phaser.Animations.AnimationFrame,
  ): void {
    if (this.animCtl.isDeathKey(anim.key)) {
      this.markDead();
      this.animCtl.holdDeathFrame();
      this.onDeath?.();
      return;
    }
    if (this.animCtl.isAttackKey(anim.key)) {
      this.attacking = false;
      if (!this.dead && !this.dying && !this.stunned) {
        this.animCtl.setFacing(this.facing);
        this.animCtl.playIdle();
      }
    }
  }

  destroy(fromScene?: boolean): void {
    this.clearHitbox();
    super.destroy(fromScene);
  }
}
