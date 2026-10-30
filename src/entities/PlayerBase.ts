import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { FourDirAnimController } from '../anim/FourDirAnimController';
import type { ActiveSkillDef, HeroDef, PlayerData } from '../data/types';
import type { ItemMods } from '../data/loot/types';
import { emptyMods } from '../data/loot/types';
import { SECOND_SKILL_LEVEL, levelAtkBonus, levelHpBonus } from '../systems/Progression';
import { CharacterBase } from './CharacterBase';

const HITBOX_LIFE_MS = 200;
const HITBOX_W = 28;
const HITBOX_H = 28;
const HITBOX_REACH = 22;

const PLAYER_IFRAME_MS = 800;
const HURT_STUN_MS = 320;

/** ms held → charge stage (1 cyan, 2 yellow, 3 red). Below stage1 = tap/normal. */
/** Faster stages so red (3) is reachable ~0.65s. */
const CHARGE_STAGE_MS = [160, 380, 620] as const;
const CHARGE_COLORS = [0x44ddff, 0xffee44, 0xff4444] as const;

/** Move + attack hold/release + skill edge. Keyboard and touch both feed this. */
export type PlayerInput = {
  moveX: number;
  moveY: number;
  /** Legacy edge — prefer attackHeld / attackReleased for charge. */
  attackPressed: boolean;
  attackHeld: boolean;
  attackReleased: boolean;
  /** Q or the 技 button. Edge-triggered. */
  skillPressed: boolean;
  /**
   * F or the 技2 button. Edge-triggered.
   * R stays restart — binding this slot to R would reload the stage.
   */
  skill2Pressed: boolean;
};

/** Below Paste (220) / Gully (280) iframes so each flurry pulse can connect. */
const FLURRY_IFRAME_MS = 60;

type BoltVisual = Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;

type Bolt = {
  zone: Phaser.GameObjects.Zone;
  gfx: BoltVisual;
  core: BoltVisual;
  originX: number;
  originY: number;
  maxRange: number;
  /** Shaft facing in radians. Omitted for orb bolts. */
  rotation?: number;
  /** Places `core` this far ahead of the body along `rotation`. */
  tipLead?: number;
};

/** Charge-shot tuning for bow basics. Hit size grows only at stage 2. */
const BOW_SHOT = [
  { speed: 280, range: 220, hit: 12 },
  { speed: 340, range: 260, hit: 12 },
  { speed: 380, range: 300, hit: 16 },
  { speed: 400, range: 320, hit: 12 },
] as const;

const BOW_FAN_RAD = 0.22;

/**
 * Data-driven playable hero.
 * Charge slash or bow volley, gear mods, Q / 技, and a second slot (F / 技2)
 * that opens at SECOND_SKILL_LEVEL. R is restart and is not a skill key.
 */
export class PlayerBase extends CharacterBase {
  readonly playerData: PlayerData;
  readonly hero: HeroDef;

  private attacking = false;
  private skillActive = false;
  /** While true, handleInput must not overwrite dash / lunge velocity. */
  private skillVelocityLock = false;
  private skillCooldownUntil = 0;
  /** Separate from Q. Starts only after the second slot unlocks. */
  private skill2CooldownUntil = 0;
  private runLevel = 1;
  private levelHp = 0;
  private levelAtk = 0;
  private skillTimers: Phaser.Time.TimerEvent[] = [];
  private skillVfx: Phaser.GameObjects.GameObject[] = [];
  private projectiles: Bolt[] = [];
  /** Independent rain zones — not the single melee hitbox slot. */
  private rainZones: Phaser.GameObjects.Zone[] = [];
  private removed = false;
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
    this.scene.physics.world.on('worldstep', this.onWorldStep);
  }

  private readonly onWorldStep = (): void => {
    if (this.removed || !this.active) return;
    this.tickProjectiles();
  };

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

  /** Apply aggregated Inventory mods (damage/speed/str/maxHp). Raises/lowers maxHp with gear. */
  applyGearMods(mods: ItemMods): void {
    this.gearMods = { ...mods };
    this.recomputeVitals();
  }

  /** Persistent run level. +1 max HP per level above 1; attack every two levels. */
  setRunLevel(level: number): void {
    this.runLevel = Math.max(1, Math.floor(level));
    this.recomputeVitals();
  }

  isSecondSkillUnlocked(): boolean {
    return this.runLevel >= SECOND_SKILL_LEVEL;
  }

  /**
   * Base HP + gear + level. Heals the positive max-HP delta.
   * A dead hero is not revived — heal() ignores dying characters.
   */
  private recomputeVitals(): void {
    const prevMax = this.maxHp;
    this.levelHp = levelHpBonus(this.runLevel);
    this.levelAtk = levelAtkBonus(this.runLevel);
    this.moveSpeed = this.baseMoveSpeed + this.gearMods.speed;
    this.maxHp = this.playerData.stats.maxHp + this.gearMods.maxHp + this.levelHp;
    const delta = this.maxHp - prevMax;
    if (delta > 0) {
      this.heal(delta);
    } else if (delta < 0) {
      if (this.hp > this.maxHp) this.hp = this.maxHp;
      this.onHpChanged(this.hp, this.maxHp);
    }
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
    const base = Math.max(1, Math.floor((str + gearDmg + stage * 2) / 2));
    return base + this.levelAtk;
  }

  getActiveSkill(): ActiveSkillDef {
    return this.playerData.activeSkill;
  }

  getSecondSkill(): ActiveSkillDef {
    return this.playerData.secondSkill;
  }

  /** 0 when the active skill is ready. */
  getSkillCooldownRemainingMs(): number {
    return Math.max(0, this.skillCooldownUntil - this.scene.time.now);
  }

  /** 0 when 技2 is ready. Stays 0 while the slot is still locked. */
  getSkill2CooldownRemainingMs(): number {
    return Math.max(0, this.skill2CooldownUntil - this.scene.time.now);
  }

  /** 0 ready → 1 full cooldown. */
  getSkillCooldownRatio(): number {
    const total = this.playerData.activeSkill.cooldownMs;
    if (total <= 0) return 0;
    return Phaser.Math.Clamp(this.getSkillCooldownRemainingMs() / total, 0, 1);
  }

  protected override getIframeMs(): number {
    return PLAYER_IFRAME_MS;
  }

  protected override getKnockbackSpeed(): number {
    // Stronger push-out so corridor / boss contact is less of a death ball.
    return 140;
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
    this.interruptSkill();
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
    this.interruptSkill(true);
    this.clearHitbox();
    this.clearTint();
    this.animCtl.setFacing(this.facing);
    this.animCtl.playFaint();
  }

  handleInput(input: PlayerInput, _delta: number): void {
    if (this.dead || this.dying) {
      this.setVelocity(0, 0);
      this.cancelCharge();
      if (this.skillActive) this.interruptSkill(true);
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

    this.tryStartSkill(input);
    this.tryStartSkill2(input);
    this.handleAttackInput(input);

    const ix = input.moveX;
    const iy = input.moveY;
    let vx = 0;
    let vy = 0;
    const chargingSlow = this.charging && this.chargeStage >= 1;

    if (this.skillActive) {
      // Dash / lunge owns velocity until the skill timer clears the lock.
      if (!this.skillVelocityLock) this.setVelocity(0, 0);
    } else if (ix !== 0 || iy !== 0) {
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

    if (!this.attacking && !this.skillActive) {
      this.animCtl.setFacing(this.facing);
      if (this.charging) {
        // Hold idle while charging — avoids walk-flip afterimage / "clone" look.
        this.animCtl.playIdle();
      } else {
        const moving = Math.abs(vx) + Math.abs(vy) > 1;
        this.animCtl.playWalk(moving);
      }
    }

    if (!this.attacking && !this.skillActive && this.iframeUntil > this.scene.time.now) {
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
    if (this.attacking || this.skillActive) return;

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
    // Destroy (not just clear) so a charge-release frame cannot leave a ring "ghost clone".
    if (this.chargeGfx) {
      this.chargeGfx.destroy();
      this.chargeGfx = undefined;
    }
  }

  private startAttack(stage: number): void {
    GameAudio.get(this.scene)?.slash();
    this.attacking = true;
    this.setVelocity(0, 0);
    // Drop charge-ring / skill gfx residue so release cannot leave ghost clones.
    this.destroySkillVfx();
    this.clearTint();
    this.animCtl.setFacing(this.facing);
    this.animCtl.playIdle();
    this.animCtl.playAttack();
    if (this.usesBowBasic()) {
      this.clearHitbox();
      this.fireBowBasic(stage);
      return;
    }
    this.spawnHitbox(stage);
  }

  /** Ranged basic: explicit bow flag, or a weapon list that includes bow. */
  private usesBowBasic(): boolean {
    return (
      this.playerData.basicAttack === 'bow' ||
      this.playerData.weapons.allowedTypes.includes('bow')
    );
  }

  private tryStartSkill(input: PlayerInput): void {
    if (!input.skillPressed) return;
    if (this.dead || this.dying || this.stunned || this.attacking || this.skillActive) return;
    if (this.scene.time.now < this.skillCooldownUntil) return;

    switch (this.playerData.activeSkill.kind) {
      case 'dash_smash':
        this.startDashSmash();
        break;
      case 'arc_bolt':
        this.startArcBolt();
        break;
      case 'shadow_flurry':
        this.startShadowFlurry();
        break;
      case 'rain_of_arrows':
        this.startRainOfArrows();
        break;
      default:
        break;
    }
  }

  /**
   * Second slot. Shared cast lock with Q so the two skills cannot overlap.
   * Cooldown is independent. Locked until SECOND_SKILL_LEVEL.
   */
  private tryStartSkill2(input: PlayerInput): void {
    if (!input.skill2Pressed || !this.isSecondSkillUnlocked()) return;
    if (this.dead || this.dying || this.stunned || this.attacking || this.skillActive) return;
    if (this.scene.time.now < this.skill2CooldownUntil) return;

    switch (this.playerData.secondSkill.kind) {
      case 'ground_cleave':
        this.startGroundCleave();
        break;
      case 'heal_pulse':
        this.startHealPulse();
        break;
      case 'spin_slash':
        this.startSpinSlash();
        break;
      case 'pierce_shot':
        this.startPierceShot();
        break;
      default:
        break;
    }
  }

  /**
   * Shared cast lock. Charge is cancelled; the chosen slot's cooldown starts now.
   * Default slot is Q so existing callers stay on the primary skill.
   * F / 技2 is the second slot. R remains restart.
   */
  private beginSkillLock(slot: 'primary' | 'second' = 'primary'): void {
    this.cancelCharge();
    this.clearHitbox();
    this.skillActive = true;
    this.skillVelocityLock = false;
    const def = slot === 'second' ? this.playerData.secondSkill : this.playerData.activeSkill;
    const until = this.scene.time.now + def.cooldownMs;
    if (slot === 'second') this.skill2CooldownUntil = until;
    else this.skillCooldownUntil = until;
    this.animCtl.setFacing(this.facing);
    this.animCtl.playAttack();
    GameAudio.get(this.scene)?.skill();
  }

  /** Wide cleave in front of the hero. Bigger than 強力斬擊, no dash. */
  private startGroundCleave(): void {
    this.beginSkillLock('second');
    this.setVelocity(0, 0);
    const dir = this.facingUnit();
    this.trackTimer(80, () => {
      const horiz = dir.x !== 0;
      const zone = this.spawnCombatZone(
        dir.x * 22,
        dir.y * 22,
        horiz ? 84 : 56,
        horiz ? 56 : 84,
        this.getSlashDamage(3),
        220,
      );
      this.spawnSmashVfx(zone.x, zone.y);
    });
    this.trackTimer(320, () => this.endSkill());
  }

  /** Restore 2 HP and pulse a green ring. No attack zone. */
  private startHealPulse(): void {
    this.beginSkillLock('second');
    this.setVelocity(0, 0);
    this.heal(2);
    this.spawnHealRing();
    this.trackTimer(280, () => this.endSkill());
  }

  /**
   * Four sequential arcs. spawnCombatZone keeps a single hitbox, so the
   * pulses are timed instead of stacked.
   */
  private startSpinSlash(): void {
    this.beginSkillLock('second');
    this.setVelocity(0, 0);
    const dirs = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    dirs.forEach((dir, i) => {
      this.trackTimer(i * 90, () => {
        const horiz = dir.x !== 0;
        this.spawnCombatZone(
          dir.x * 18,
          dir.y * 18,
          horiz ? 64 : 40,
          horiz ? 40 : 64,
          this.getSlashDamage(1),
          80,
          { iframeMs: FLURRY_IFRAME_MS },
        );
        this.spawnSpinVfx(dir.x, dir.y);
        if (i > 0) GameAudio.get(this.scene)?.slash();
      });
    });
    this.trackTimer(400, () => this.endSkill());
  }

  /** One long arrow. The projectile keeps flying after the cast lock ends. */
  private startPierceShot(): void {
    this.beginSkillLock('second');
    this.setVelocity(0, 0);
    const dir = this.facingUnit();
    const ang = Math.atan2(dir.y, dir.x);
    this.spawnArrow(dir.x, dir.y, 460, 420, this.getSlashDamage(2) + 1, 14, ang);
    this.trackTimer(200, () => this.endSkill());
  }

  private startDashSmash(): void {
    this.beginSkillLock();
    const dir = this.facingUnit();
    const dashMs = 120;
    const dashPx = 100;
    this.skillVelocityLock = true;
    // World bounds + wall collider clamp the dash.
    this.setVelocity(dir.x * (dashPx / dashMs) * 1000, dir.y * (dashPx / dashMs) * 1000);

    this.trackTimer(dashMs, () => {
      this.skillVelocityLock = false;
      this.setVelocity(0, 0);
      const horiz = dir.x !== 0;
      const zone = this.spawnCombatZone(
        dir.x * 28,
        dir.y * 28,
        horiz ? 56 : 42,
        horiz ? 42 : 56,
        this.getSlashDamage(2),
        200,
      );
      this.spawnSmashVfx(zone.x, zone.y);
    });
    this.trackTimer(dashMs + 200, () => this.endSkill());
  }

  private startArcBolt(): void {
    this.beginSkillLock();
    this.setVelocity(0, 0);
    this.spawnArcBolt();
    // Brief cast lock; the bolt keeps flying after the anim releases.
    this.trackTimer(240, () => this.endSkill());
  }

  private startShadowFlurry(): void {
    this.beginSkillLock();
    const dir = this.facingUnit();
    const lungeMs = 80;
    const lungePx = 40;
    this.skillVelocityLock = true;
    this.setVelocity(dir.x * (lungePx / lungeMs) * 1000, dir.y * (lungePx / lungeMs) * 1000);
    this.trackTimer(lungeMs, () => {
      this.skillVelocityLock = false;
      this.setVelocity(0, 0);
    });

    for (let i = 0; i < 3; i++) {
      this.trackTimer(i * 90, () => {
        // Long box so the 40px lunge does not step past the target between pulses.
        const horiz = dir.x !== 0;
        this.spawnCombatZone(
          dir.x * 20,
          dir.y * 20,
          horiz ? 72 : 36,
          horiz ? 36 : 72,
          this.getSlashDamage(0),
          80,
          { iframeMs: FLURRY_IFRAME_MS },
        );
        this.spawnKnifeVfx();
        if (i > 0) GameAudio.get(this.scene)?.slash();
      });
    }
    this.trackTimer(280, () => this.endSkill());
  }

  /**
   * Stand still and drop 5–7 short zones in a cone ahead.
   * Zones overlap in time, so they are not the single melee hitbox.
   */
  private startRainOfArrows(): void {
    this.beginSkillLock();
    this.setVelocity(0, 0);
    const count = 5 + Math.floor(Math.random() * 3);
    const dir = this.facingUnit();
    const px = -dir.y;
    const py = dir.x;
    let cursor = 0;
    let lastDelay = 0;
    for (let i = 0; i < count; i++) {
      const delay = cursor;
      lastDelay = delay;
      this.trackTimer(delay, () => {
        const along = 30 + Math.random() * 72;
        const lateral = (Math.random() - 0.5) * (28 + along * 0.35);
        const ox = dir.x * along + px * lateral;
        const oy = dir.y * along + py * lateral;
        const lifeMs = 120 + Math.floor(Math.random() * 41);
        this.spawnRainZone(ox, oy, lifeMs);
        this.spawnRainStreak(this.x + ox, this.y + oy);
      });
      cursor += 50 + Math.floor(Math.random() * 21);
    }
    this.trackTimer(lastDelay + 550, () => this.endSkill());
  }

  private endSkill(): void {
    if (!this.skillActive) return;
    this.skillActive = false;
    this.skillVelocityLock = false;
    this.clearSkillTimers();
    this.destroyRainZones();
    // Drop any lingering slash arcs / rings so skills cannot leave ghost gfx.
    this.destroySkillVfx();
    if (!this.dead && !this.dying && !this.stunned) this.setVelocity(0, 0);
    if (this.dead || this.dying || this.stunned || this.attacking) return;
    this.animCtl.setFacing(this.facing);
    this.animCtl.playIdle();
  }

  /** Stop a skill in progress. In-flight bolts stay unless `dropBolts` is set. */
  private interruptSkill(dropBolts = false): void {
    this.skillActive = false;
    this.skillVelocityLock = false;
    this.clearSkillTimers();
    this.destroyRainZones();
    this.destroySkillVfx();
    if (dropBolts) this.destroyProjectiles();
  }

  private trackTimer(delay: number, cb: () => void): void {
    const ev = this.scene.time.delayedCall(delay, () => {
      if (!this.active || !this.skillActive) return;
      cb();
    });
    this.skillTimers.push(ev);
  }

  private clearSkillTimers(): void {
    for (const ev of this.skillTimers) this.scene.time.removeEvent(ev);
    this.skillTimers.length = 0;
  }

  private facingUnit(): { x: number; y: number } {
    switch (this.facing) {
      case 'left':
        return { x: -1, y: 0 };
      case 'right':
        return { x: 1, y: 0 };
      case 'up':
        return { x: 0, y: -1 };
      default:
        return { x: 0, y: 1 };
    }
  }

  private spawnHitbox(stage: number): void {
    const scale = 1 + stage * 0.28;
    const reach = HITBOX_REACH * scale;
    const { x: fx, y: fy } = this.facingUnit();
    this.spawnCombatZone(
      fx * reach,
      fy * reach,
      HITBOX_W * scale,
      HITBOX_H * scale,
      this.getSlashDamage(stage),
      HITBOX_LIFE_MS + stage * 40,
      { chargeStage: stage },
    );
  }

  private spawnCombatZone(
    ox: number,
    oy: number,
    w: number,
    h: number,
    damage: number,
    lifeMs: number,
    extra?: { chargeStage?: number; iframeMs?: number },
  ): Phaser.GameObjects.Zone {
    this.clearHitbox();

    const zone = this.scene.add.zone(this.x + ox, this.y + oy, w, h);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);

    // No debug rect — charge ring already shows stage; yellow box looked like "clones".
    zone.setData('damage', damage);
    if (extra?.chargeStage !== undefined) zone.setData('chargeStage', extra.chargeStage);
    if (extra?.iframeMs !== undefined) zone.setData('iframeMs', extra.iframeMs);

    this.hitbox = zone;
    this.onHitboxSpawn?.(zone);

    this.scene.time.delayedCall(lifeMs, () => {
      if (this.hitbox === zone) this.clearHitbox();
    });
    return zone;
  }

  private spawnArcBolt(): void {
    const dir = this.facingUnit();
    const speed = 320;
    const maxRange = 250;
    const x = this.x + dir.x * 18;
    const y = this.y + dir.y * 18;

    const zone = this.scene.add.zone(x, y, 14, 14);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setVelocity(dir.x * speed, dir.y * speed);
    zone.setData('damage', this.getSlashDamage(1));
    this.onHitboxSpawn?.(zone);

    const gfx = this.scene.add.circle(x, y, 6, 0x44ddff, 0.95).setDepth(16);
    gfx.setStrokeStyle(2, 0xaa66ff, 0.95);
    const core = this.scene.add.circle(x, y, 2.5, 0xf4f0ff, 0.95).setDepth(17);

    this.projectiles.push({
      zone,
      gfx,
      core,
      originX: x,
      originY: y,
      maxRange,
    });
  }

  private fireBowBasic(stage: number): void {
    const facing = this.facingUnit();
    const base = Math.atan2(facing.y, facing.x);
    const shot = BOW_SHOT[Math.min(stage, BOW_SHOT.length - 1)] ?? BOW_SHOT[0];
    const angles = stage >= 3 ? [base - BOW_FAN_RAD, base, base + BOW_FAN_RAD] : [base];
    const damage = this.getSlashDamage(stage);
    for (const ang of angles) {
      this.spawnArrow(Math.cos(ang), Math.sin(ang), shot.speed, shot.range, damage, shot.hit, ang);
    }
  }

  /** One piercing arrow. Each zone keeps its own hit set in GameScene. */
  private spawnArrow(
    dirX: number,
    dirY: number,
    speed: number,
    maxRange: number,
    damage: number,
    hitSize: number,
    rotation: number,
  ): void {
    const x = this.x + dirX * 18;
    const y = this.y + dirY * 18;

    const zone = this.scene.add.zone(x, y, hitSize, hitSize);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setVelocity(dirX * speed, dirY * speed);
    zone.setData('damage', damage);
    this.onHitboxSpawn?.(zone);

    const shaft = this.scene.add.rectangle(x, y, 16, 2, 0xe8c070, 1).setDepth(16);
    shaft.setRotation(rotation);
    const tipLead = 9;
    const tip = this.scene.add
      .rectangle(x + dirX * tipLead, y + dirY * tipLead, 5, 3, 0xfff6d0, 1)
      .setDepth(17);
    tip.setRotation(rotation);

    this.projectiles.push({
      zone,
      gfx: shaft,
      core: tip,
      originX: x,
      originY: y,
      maxRange,
      rotation,
      tipLead,
    });
  }

  private spawnRainZone(ox: number, oy: number, lifeMs: number): void {
    const zone = this.scene.add.zone(this.x + ox, this.y + oy, 22, 22);
    this.scene.physics.add.existing(zone, false);
    const body = zone.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    zone.setData('damage', this.getSlashDamage(1));
    this.rainZones.push(zone);
    this.onHitboxSpawn?.(zone);
    this.scene.time.delayedCall(lifeMs, () => {
      this.destroyRainZone(zone);
    });
  }

  private destroyRainZone(zone: Phaser.GameObjects.Zone): void {
    const i = this.rainZones.indexOf(zone);
    if (i >= 0) this.rainZones.splice(i, 1);
    if (zone.active) zone.destroy();
  }

  private destroyRainZones(): void {
    for (const zone of [...this.rainZones]) this.destroyRainZone(zone);
  }

  /** Gold/green streak falling onto a rain impact. */
  private spawnRainStreak(x: number, y: number): void {
    const g = this.scene.add.graphics().setDepth(17);
    g.setPosition(x, y - 22);
    this.ownVfx(g);
    g.lineStyle(2, 0xe8c070, 0.95);
    g.lineBetween(-1, -14, 0, 2);
    g.lineStyle(2, 0x7dcc6a, 0.9);
    g.lineBetween(3, -12, 1, 6);
    g.lineStyle(1, 0xfff4c0, 0.95);
    g.lineBetween(0, -8, 0, 8);
    g.fillStyle(0xc6f0a0, 0.9);
    g.fillCircle(1, 8, 2);
    this.scene.tweens.add({
      targets: g,
      y: y + 2,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        if (g.active) g.destroy();
      },
    });
  }

  private tickProjectiles(): void {
    const bounds = this.scene.physics.world.bounds;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i]!;
      const body = bolt.zone.body as Phaser.Physics.Arcade.Body | null;
      if (!bolt.zone.active || !body) {
        this.destroyProjectile(i);
        continue;
      }
      const x = body.center.x;
      const y = body.center.y;
      const rot = bolt.rotation;
      if (bolt.gfx.active) {
        bolt.gfx.setPosition(x, y);
        if (rot !== undefined) bolt.gfx.setRotation(rot);
      }
      if (bolt.core.active) {
        if (rot !== undefined && bolt.tipLead) {
          bolt.core.setPosition(x + Math.cos(rot) * bolt.tipLead, y + Math.sin(rot) * bolt.tipLead);
          bolt.core.setRotation(rot);
        } else {
          bolt.core.setPosition(x, y);
        }
      }
      const dist = Phaser.Math.Distance.Between(bolt.originX, bolt.originY, x, y);
      const outside =
        x < bounds.x - 8 || y < bounds.y - 8 || x > bounds.right + 8 || y > bounds.bottom + 8;
      if (dist >= bolt.maxRange || outside) this.destroyProjectile(i);
    }
  }

  private destroyProjectile(index: number): void {
    const bolt = this.projectiles[index];
    if (!bolt) return;
    this.projectiles.splice(index, 1);
    if (bolt.gfx.active) bolt.gfx.destroy();
    if (bolt.core.active) bolt.core.destroy();
    if (bolt.zone.active) bolt.zone.destroy();
  }

  private destroyProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this.destroyProjectile(i);
  }

  private spawnHealRing(): void {
    const ring = this.scene.add.circle(this.x, this.y, 10, 0x66ee88, 0.35).setDepth(16);
    ring.setStrokeStyle(3, 0xc8ffd0, 0.95);
    this.ownVfx(ring);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 2.8,
      scaleY: 2.8,
      alpha: 0,
      duration: 280,
      onComplete: () => {
        if (ring.active) ring.destroy();
      },
    });
  }

  private spawnSpinVfx(dirX: number, dirY: number): void {
    const g = this.scene.add.graphics().setDepth(17);
    this.ownVfx(g);
    const ang = Math.atan2(dirY, dirX);
    g.lineStyle(3, 0xf4f8ff, 0.95);
    g.beginPath();
    g.arc(this.x, this.y, 20, ang - 0.7, ang + 0.7, false);
    g.strokePath();
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 120,
      onComplete: () => {
        if (g.active) g.destroy();
      },
    });
  }

  private spawnSmashVfx(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, 12, 0xff8822, 0.4).setDepth(16);
    ring.setStrokeStyle(3, 0xfff4e0, 0.95);
    this.ownVfx(ring);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 2.5,
      scaleY: 2.5,
      alpha: 0,
      duration: 180,
      onComplete: () => {
        if (ring.active) ring.destroy();
      },
    });

    const g = this.scene.add.graphics().setDepth(17);
    this.ownVfx(g);
    const dir = this.facingUnit();
    const ang = Math.atan2(dir.y, dir.x);
    g.lineStyle(3, 0xffffff, 0.95);
    g.beginPath();
    g.arc(x, y, 16, ang - 1.05, ang + 1.05, false);
    g.strokePath();
    g.lineStyle(2, 0xffaa33, 0.9);
    g.beginPath();
    g.arc(x, y, 22, ang - 0.75, ang + 0.75, false);
    g.strokePath();
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        if (g.active) g.destroy();
      },
    });
  }

  private spawnKnifeVfx(): void {
    const dir = this.facingUnit();
    const g = this.scene.add.graphics().setDepth(17);
    this.ownVfx(g);
    const base = Math.atan2(dir.y, dir.x);
    const ang = base + (Math.random() - 0.5) * 0.9;
    const near = 6;
    const far = 22 + Math.random() * 8;
    const x1 = this.x + Math.cos(ang) * near;
    const y1 = this.y + Math.sin(ang) * near;
    const x2 = this.x + Math.cos(ang) * far;
    const y2 = this.y + Math.sin(ang) * far;
    g.lineStyle(2, 0xf4f8ff, 0.95);
    g.lineBetween(x1, y1, x2, y2);
    g.lineStyle(1, 0x99bbdd, 0.8);
    g.lineBetween(x1 + dir.y * 2, y1 - dir.x * 2, x2, y2);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 140,
      onComplete: () => {
        if (g.active) g.destroy();
      },
    });
  }

  private ownVfx(obj: Phaser.GameObjects.GameObject): void {
    this.skillVfx.push(obj);
    obj.once(Phaser.GameObjects.Events.DESTROY, () => {
      const i = this.skillVfx.indexOf(obj);
      if (i >= 0) this.skillVfx.splice(i, 1);
    });
  }

  private destroySkillVfx(): void {
    for (const obj of [...this.skillVfx]) {
      if (obj.active) obj.destroy();
    }
    this.skillVfx.length = 0;
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
      // Skill lock outlives a short attack clip; don't snap back to walk early.
      if (this.skillActive) return;
      this.attacking = false;
      if (!this.dead && !this.dying && !this.stunned) {
        this.animCtl.setFacing(this.facing);
        this.animCtl.playIdle();
      }
    }
  }

  destroy(fromScene?: boolean): void {
    this.removed = true;
    this.skillActive = false;
    this.clearSkillTimers();
    this.destroyRainZones();
    this.destroySkillVfx();
    this.destroyProjectiles();
    try {
      this.scene.physics.world.off('worldstep', this.onWorldStep);
    } catch {
      /* physics world may already be gone */
    }
    this.clearHitbox();
    this.chargeGfx?.destroy();
    this.chargeGfx = undefined;
    super.destroy(fromScene);
  }
}
