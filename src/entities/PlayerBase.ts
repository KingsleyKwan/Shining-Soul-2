import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { FourDirAnimController } from '../anim/FourDirAnimController';
import type { HeroDef, PlayerData } from '../data/types';
import type { ItemMods } from '../data/loot/types';
import { emptyMods } from '../data/loot/types';
import { CharacterBase } from './CharacterBase';

const HITBOX_LIFE_MS = 200;
const HITBOX_W = 28;
const HITBOX_H = 28;
const HITBOX_REACH = 22;

const PLAYER_IFRAME_MS = 550;
const HURT_STUN_MS = 300;

/** ms held → charge stage (1 cyan, 2 yellow, 3 red). Below stage1 = tap/normal. */
/** Faster stages so red (3) is reachable ~0.65s. */
const CHARGE_STAGE_MS = [160, 380, 620] as const;
const CHARGE_COLORS = [0x44ddff, 0xffee44, 0xff4444] as const;

/** Move + attack hold/release. Keyboard and touch both feed this. */
export type PlayerInput = {
  moveX: number;
  moveY: number;
  /** Legacy edge — prefer attackHeld / attackReleased for charge. */
  attackPressed: boolean;
  attackHeld: boolean;
  attackReleased: boolean;
};

/**
 * Data-driven playable hero. Phase 2: charge slash + gear mods from Inventory.
 */
export class PlayerBase extends CharacterBase {
  readonly playerData: PlayerData;
  readonly hero: HeroDef;

  private attacking = false;
  private charging = false;
  private chargeStartAt = 0;
  private chargeStage = 0;
  private chargeGfx?: Phaser.GameObjects.Graphics;
  private gearMods: ItemMods = emptyMods();
  private baseMoveSpeed: number;
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
    this.baseMoveSpeed = data.stats.speed;
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

  /** Apply aggregated Inventory mods (damage/speed/str/maxHp heal bump). */
  applyGearMods(mods: ItemMods): void {
    const prevMaxBonus = this.gearMods.maxHp;
    this.gearMods = { ...mods };
    this.moveSpeed = this.baseMoveSpeed + mods.speed;
    const maxBonusDelta = mods.maxHp - prevMaxBonus;
    if (maxBonusDelta > 0) this.heal(maxBonusDelta);
  }

  getGearMods(): ItemMods {
    return this.gearMods;
  }

  isAttacking(): boolean {
    return this.attacking;
  }

  isCharging(): boolean {
    return this.charging;
  }

  getChargeStage(): number {
    return this.chargeStage;
  }

  /** Skip the next Space/Z attack (used when Space opens a chest). */
  suppressNextAttack(): void {
    this.skipAttackOnce = true;
    this.cancelCharge();
  }

  /** Temporary iframes after (re)spawn so nearby hostiles cannot delete the run instantly. */
  grantSpawnGrace(ms: number): void {
    this.iframeUntil = Math.max(this.iframeUntil, this.scene.time.now + ms);
  }

  /**
   * Slash damage: str + gear, scaled by charge stage.
   * Tap (stage 0) ≈ 1 for default heroes; stage 3 hits harder.
   */
  getSlashDamage(stage = 0): number {
    const str = this.playerData.stats.str + this.gearMods.str;
    const gearDmg = this.gearMods.damage;
    return Math.max(1, Math.floor((str + gearDmg + stage * 2) / 2));
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
    this.cancelCharge();
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
    this.cancelCharge();
    this.clearHitbox();
    this.clearTint();
    this.animCtl.setFacing(this.facing);
    this.animCtl.playFaint();
  }

  handleInput(input: PlayerInput, _delta: number): void {
    if (this.dead || this.dying) {
      this.setVelocity(0, 0);
      this.cancelCharge();
      return;
    }

    if (this.stunned) {
      const now = this.scene.time.now;
      if (now >= this.stunUntil) {
        this.stunned = false;
      } else {
        this.cancelCharge();
        return;
      }
    }

    this.handleAttackInput(input);

    const ix = input.moveX;
    const iy = input.moveY;
    let vx = 0;
    let vy = 0;
    const chargingSlow = this.charging && this.chargeStage >= 1;

    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy) || 1;
      const mag = Math.min(1, len);
      const speedMul = this.attacking ? 0.35 : chargingSlow ? 0.55 : 1;
      const speed = this.moveSpeed * speedMul * mag;
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
      this.animCtl.setFacing(this.facing);
      if (this.charging) {
        // Hold idle while charging — avoids walk-flip afterimage / "clone" look.
        this.animCtl.playIdle();
      } else {
        const moving = Math.abs(vx) + Math.abs(vy) > 1;
        this.animCtl.playWalk(moving);
      }
    }

    if (!this.attacking && this.iframeUntil > this.scene.time.now) {
      this.flashIframeTint(this.scene.time.now, 50);
    }

    if (this.charging) this.drawChargeRing();
  }

  private handleAttackInput(input: PlayerInput): void {
    if (this.skipAttackOnce) {
      this.skipAttackOnce = false;
      this.cancelCharge();
      return;
    }
    if (this.attacking) return;

    if (input.attackHeld && !this.charging) {
      this.beginCharge();
    }

    if (this.charging) {
      this.updateChargeStage();
      if (input.attackReleased || !input.attackHeld) {
        const stage = this.chargeStage;
        this.cancelCharge();
        this.startAttack(stage);
      }
    }
  }

  private beginCharge(): void {
    this.charging = true;
    this.chargeStartAt = this.scene.time.now;
    this.chargeStage = 0;
    if (!this.chargeGfx) {
      this.chargeGfx = this.scene.add.graphics().setDepth(15);
    }
  }

  private updateChargeStage(): void {
    const held = this.scene.time.now - this.chargeStartAt;
    let stage = 0;
    if (held >= CHARGE_STAGE_MS[2]) stage = 3;
    else if (held >= CHARGE_STAGE_MS[1]) stage = 2;
    else if (held >= CHARGE_STAGE_MS[0]) stage = 1;
    this.chargeStage = stage;
  }

  private drawChargeRing(): void {
    const g = this.chargeGfx;
    if (!g) return;
    g.clear();
    if (this.chargeStage < 1) {
      // Faint wind-up ring while charging toward stage 1
      const t = (this.scene.time.now - this.chargeStartAt) / CHARGE_STAGE_MS[0];
      g.lineStyle(2, 0xaaccff, 0.25 + 0.35 * Math.min(1, t));
      g.strokeCircle(this.x, this.y, 14 + 4 * Math.min(1, t));
      return;
    }
    const color = CHARGE_COLORS[this.chargeStage - 1]!;
    const radius = 16 + this.chargeStage * 4;
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(this.x, this.y, radius);
    g.lineStyle(1, 0xffffff, 0.5);
    g.strokeCircle(this.x, this.y, radius - 3);
  }

  private cancelCharge(): void {
    this.charging = false;
    this.chargeStage = 0;
    this.chargeGfx?.clear();
  }

  private startAttack(stage: number): void {
    GameAudio.get(this.scene)?.slash();
    this.attacking = true;
    this.setVelocity(0, 0);
    this.animCtl.setFacing(this.facing);
    this.animCtl.playAttack();
    this.spawnHitbox(stage);
  }

  private spawnHitbox(stage: number): void {
    this.clearHitbox();

    const scale = 1 + stage * 0.28;
    const reach = HITBOX_REACH * scale;
    const w = HITBOX_W * scale;
    const h = HITBOX_H * scale;
    const damage = this.getSlashDamage(stage);

    let ox = 0;
    let oy = 0;
    switch (this.facing) {
      case 'left':
        ox = -reach;
        break;
      case 'right':
        ox = reach;
        break;
      case 'up':
        oy = -reach;
        break;
      case 'down':
        oy = reach;
        break;
    }

    const zone = this.scene.add.zone(this.x + ox, this.y + oy, w, h);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);

    // No debug rect — charge ring already shows stage; yellow box looked like "clones".
    zone.setData('damage', damage);
    zone.setData('chargeStage', stage);

    this.hitbox = zone;
    this.onHitboxSpawn?.(zone);

    this.scene.time.delayedCall(HITBOX_LIFE_MS + stage * 40, () => this.clearHitbox());
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
    this.chargeGfx?.destroy();
    this.chargeGfx = undefined;
    super.destroy(fromScene);
  }
}
