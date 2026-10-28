import Phaser from 'phaser';
import type { Facing } from '../data/types';
import type { TilePathfinder } from '../ai/TilePathfinder';
import { GameAudio } from '../audio/GameAudio';
import { showLootToastDom } from '../ui/LootToastDom';
import { EnemyBase } from './EnemyBase';

const DEFAULT_HP = 14;
const IFRAME_MS = 280;
const KNOCKBACK = 70;
const DEATH_FLASH_MS = 400;

/** Slower than Paste (58) and player (110). */
const CHASE_SPEED = 42;
const AGGRO_RANGE = 200;
const MELEE_RANGE = 34;
const ATTACK_DAMAGE = 1;

/** B4 wind-up windows (fair dodge). */
const MELEE_WINDUP_MS = 400;
const AOE_WINDUP_MS = 580;
const CHARGE_WINDUP_MS = 600;

const LUNGE_SPEED = 130;
const LUNGE_MS = 170;
const AOE_RADIUS = 52;
const CHARGE_SPEED = 250;
const CHARGE_MS = 280;
const CHARGE_HIT_PAD = 28;

type AttackKind = 'melee' | 'aoe' | 'charge';
type CombatPhase = 1 | 2 | 3;

/**
 * Captain Gully — B4 phases + telegraphs.
 * Modes: melee lunge / slam AoE / charge dash. Soft HP phases >66% / 33–66% / <33%.
 * Each attack shows a 起手預警 before damage. Atlas "gully"; procedural VFX for AoE/charge.
 */
export class Boss extends EnemyBase {
  private nextAttackAt = 0;
  private busyUntil = 0;
  private onDefeated?: () => void;
  private label!: Phaser.GameObjects.Text;

  private combatPhase: CombatPhase = 1;
  private attackToken = 0;
  private telegraphGfx: Phaser.GameObjects.GameObject[] = [];
  private telegraphTweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = DEFAULT_HP) {
    super(scene, x, y, 'gully', 'idle_0', maxHp, CHASE_SPEED);

    this.setDepth(9);
    this.setScale(2);
    this.setOrigin(0.5, 0.85);
    this.setCollideWorldBounds(true);
    this.setBounce(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    // 37px frame @ scale 2. Opaque silhouette is about x12–34, y2–30; the old 14×16 torso missed most swings.
    body.setSize(22, 28);
    body.setOffset(12, 2);
    body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);

    // HK 繁中 name only — no English "BOSS", no solid nameplate behind the text.
    this.label = scene.add
      .text(x, y - 38, '蓋利隊長', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#ffcc66',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(13);

    this.createHpUi({
      barWidth: 36,
      barY: 26,
      textY: 34,
      barColor: 0xdd4444,
      textColor: '#ffe8e8',
    });
    // Dark thin bar under the name; avoid a bright block that reads as a white plate.
    this.hpBarBg?.setDepth(11).setFillStyle(0x101010, 0.9);
    this.hpBarFg?.setDepth(12);
    this.hpText?.setDepth(13);

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
    if (!present) this.cancelAttack(false);
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
    this.cancelAttack(true);
    this.hp = Math.max(0, this.hp - amount);
    this.refreshHpUi();
    this.onDamaged(amount, fromX, fromY);
    this.checkPhaseTransition();

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
    this.cancelAttack(false);
    this.setFrame('defeat_0');
    this.anims.stop();
    this.setTint(0xff8888);
    const ui = [this, this.label, this.hpText, this.hpBarBg, this.hpBarFg].filter(
      Boolean,
    ) as Phaser.GameObjects.GameObject[];
    this.fadeAndDestroy(ui, DEATH_FLASH_MS, () => this.onDefeated?.());
  }

  private hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  private phaseFromHp(): CombatPhase {
    const r = this.hpRatio();
    if (r <= 0.33) return 3;
    if (r <= 0.66) return 2;
    return 1;
  }

  private checkPhaseTransition(): void {
    const next = this.phaseFromHp();
    if (next <= this.combatPhase) return;
    this.combatPhase = next;
    GameAudio.get(this.scene)?.bossPhase();
    this.setTint(0xffaa44);
    this.scene.time.delayedCall(220, () => {
      if (this.active && !this.dying && this.scene.time.now >= this.iframeUntil) {
        this.clearTint();
      }
    });
    if (next === 2) {
      showLootToastDom('蓋利隊長·加速！', { color: '#ffcc66' });
    } else if (next === 3) {
      showLootToastDom('蓋利隊長·狂暴！', { color: '#ff8866' });
    }
  }

  private cooldownForPhase(): number {
    if (this.combatPhase >= 3) return 980;
    if (this.combatPhase === 2) return 1200;
    return 1500;
  }

  private pickAttack(dist: number): AttackKind {
    const phase = this.combatPhase;
    const roll = Math.random();
    if (phase === 1) {
      // Melee primary; occasional AoE when close enough to matter.
      if (dist < AOE_RADIUS + 20 && roll < 0.28) return 'aoe';
      return 'melee';
    }
    if (phase === 2) {
      if (roll < 0.34) return 'charge';
      if (roll < 0.62) return 'aoe';
      return 'melee';
    }
    // Phase 3 — harder mix.
    if (roll < 0.4) return 'charge';
    if (roll < 0.75) return 'aoe';
    return 'melee';
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

  private clearTelegraphs(): void {
    for (const tw of this.telegraphTweens) {
      try {
        tw.stop();
      } catch {
        /* ignore */
      }
    }
    this.telegraphTweens = [];
    for (const g of this.telegraphGfx) {
      try {
        g.destroy();
      } catch {
        /* ignore */
      }
    }
    this.telegraphGfx = [];
  }

  private trackGfx(obj: Phaser.GameObjects.GameObject): void {
    this.telegraphGfx.push(obj);
  }

  private trackTween(tw: Phaser.Tweens.Tween): void {
    this.telegraphTweens.push(tw);
  }

  private cancelAttack(fromHurt: boolean): void {
    this.attackToken += 1;
    this.busyUntil = 0;
    this.clearTelegraphs();
    if (fromHurt && this.active && !this.dying) {
      this.setVelocity(0, 0);
      const body = this.body as Phaser.Physics.Arcade.Body | null;
      body?.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);
    }
  }

  private aliveFor(token: number): boolean {
    return this.active && !this.dying && this.attackToken === token && !!this.scene;
  }

  private hurtPlayerOnce(token: number): void {
    if (!this.aliveFor(token) || !this.target || !this.target.active || this.target.isDead()) return;
    this.target.takeDamage(ATTACK_DAMAGE, this.x, this.y);
  }

  private beginAttack(kind: AttackKind, time: number): void {
    const token = ++this.attackToken;
    this.clearTelegraphs();
    GameAudio.get(this.scene)?.bossTelegraph();
    this.setVelocity(0, 0);
    this.pather?.reset();

    if (kind === 'melee') this.startMelee(token, time);
    else if (kind === 'aoe') this.startAoe(token, time);
    else this.startCharge(token, time);
  }

  private startMelee(token: number, time: number): void {
    const wind = MELEE_WINDUP_MS;
    this.busyUntil = time + wind + LUNGE_MS + 180;
    this.nextAttackAt = time + this.cooldownForPhase() + wind;

    if (!this.target) return;
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    this.facing = this.facingFromDelta(dx, dy);
    this.playAttack();
    this.setTint(0xffaa66);

    // Small amber ground circle as 起手預警.
    const ring = this.scene.add.circle(this.x, this.y, 18, 0xff6622, 0.28).setDepth(4);
    ring.setStrokeStyle(2, 0xffcc44, 0.9);
    this.trackGfx(ring);
    this.trackTween(
      this.scene.tweens.add({
        targets: ring,
        scale: 1.35,
        alpha: 0.12,
        duration: wind,
        yoyo: true,
        repeat: -1,
      }),
    );

    this.scene.time.delayedCall(wind, () => {
      if (!this.aliveFor(token) || !this.target) return;
      this.clearTelegraphs();
      if (this.scene.time.now >= this.iframeUntil) this.clearTint();
      this.playAttack();

      const tdx = this.target.x - this.x;
      const tdy = this.target.y - this.y;
      const len = Math.hypot(tdx, tdy) || 1;
      this.facing = this.facingFromDelta(tdx, tdy);
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.setMaxVelocity(LUNGE_SPEED, LUNGE_SPEED);
      this.setVelocity((tdx / len) * LUNGE_SPEED, (tdy / len) * LUNGE_SPEED);

      this.scene.time.delayedCall(90, () => {
        if (!this.aliveFor(token) || !this.target) return;
        const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
        if (d <= MELEE_RANGE + 14) this.hurtPlayerOnce(token);
      });

      this.scene.time.delayedCall(LUNGE_MS, () => {
        if (!this.aliveFor(token)) return;
        this.setVelocity(0, 0);
        body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);
      });
    });
  }

  private startAoe(token: number, time: number): void {
    const wind = AOE_WINDUP_MS;
    this.busyUntil = time + wind + 220;
    this.nextAttackAt = time + this.cooldownForPhase() + wind;

    this.playAttack();
    this.setTint(0xff6644);

    const cx = this.x;
    const cy = this.y;
    const fill = this.scene.add.circle(cx, cy, AOE_RADIUS, 0xff2222, 0.18).setDepth(3);
    const stroke = this.scene.add.circle(cx, cy, AOE_RADIUS, 0x000000, 0).setDepth(4);
    stroke.setStrokeStyle(2, 0xffaa33, 0.95);
    this.trackGfx(fill);
    this.trackGfx(stroke);
    this.trackTween(
      this.scene.tweens.add({
        targets: [fill, stroke],
        alpha: { from: 0.15, to: 0.45 },
        scale: { from: 0.72, to: 1.05 },
        duration: Math.floor(wind / 2),
        yoyo: true,
        repeat: -1,
      }),
    );

    this.scene.time.delayedCall(wind, () => {
      if (!this.aliveFor(token)) return;
      this.clearTelegraphs();
      if (this.scene.time.now >= this.iframeUntil) this.clearTint();

      const blast = this.scene.add.circle(this.x, this.y, AOE_RADIUS, 0xff4422, 0.55).setDepth(5);
      this.trackGfx(blast);
      this.scene.cameras.main.shake(70, 0.0035);
      this.playAttack();

      if (this.target && this.target.active && !this.target.isDead()) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
        if (d <= AOE_RADIUS + 6) this.hurtPlayerOnce(token);
      }

      this.scene.tweens.add({
        targets: blast,
        alpha: 0,
        scale: 1.25,
        duration: 180,
        onComplete: () => {
          blast.destroy();
        },
      });
    });
  }

  private startCharge(token: number, time: number): void {
    const wind = CHARGE_WINDUP_MS;
    this.busyUntil = time + wind + CHARGE_MS + 160;
    this.nextAttackAt = time + this.cooldownForPhase() + wind;

    if (!this.target) return;
    const aimX = this.target.x;
    const aimY = this.target.y;
    const dx = aimX - this.x;
    const dy = aimY - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    this.facing = this.facingFromDelta(dx, dy);
    this.playIdle();
    this.setTint(0xffcc44);

    // Directional amber telegraph line (locked aim).
    const lineLen = Math.min(140, Math.max(70, len));
    const g = this.scene.add.graphics().setDepth(4);
    g.lineStyle(3, 0xffaa33, 0.85);
    g.beginPath();
    g.moveTo(this.x, this.y);
    g.lineTo(this.x + dirX * lineLen, this.y + dirY * lineLen);
    g.strokePath();
    g.fillStyle(0xff6622, 0.35);
    g.fillCircle(this.x + dirX * lineLen, this.y + dirY * lineLen, 8);
    this.trackGfx(g);
    this.trackTween(
      this.scene.tweens.add({
        targets: g,
        alpha: 0.35,
        duration: 180,
        yoyo: true,
        repeat: -1,
      }),
    );

    this.scene.time.delayedCall(wind, () => {
      if (!this.aliveFor(token)) return;
      this.clearTelegraphs();
      if (this.scene.time.now >= this.iframeUntil) this.clearTint();
      this.playAttack();

      const body = this.body as Phaser.Physics.Arcade.Body;
      body.setMaxVelocity(CHARGE_SPEED, CHARGE_SPEED);
      this.setVelocity(dirX * CHARGE_SPEED, dirY * CHARGE_SPEED);

      let hit = false;
      const tick = this.scene.time.addEvent({
        delay: 40,
        repeat: Math.ceil(CHARGE_MS / 40),
        callback: () => {
          if (!this.aliveFor(token) || hit || !this.target) return;
          const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
          if (d <= CHARGE_HIT_PAD) {
            hit = true;
            this.hurtPlayerOnce(token);
          }
        },
      });

      this.scene.time.delayedCall(CHARGE_MS, () => {
        tick.remove(false);
        if (!this.aliveFor(token)) return;
        this.setVelocity(0, 0);
        body.setMaxVelocity(CHASE_SPEED, CHASE_SPEED);
      });
    });
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

    if (time < this.busyUntil) {
      // Hold during wind-up / active attack; velocity set by attack routines.
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

    // Prefer attacking when in melee band or when specials are unlocked and close-ish.
    const wantAttack =
      time >= this.nextAttackAt &&
      (dist <= MELEE_RANGE + 8 ||
        (this.combatPhase >= 2 && dist <= 110) ||
        (this.combatPhase === 1 && dist <= AOE_RADIUS + 10));

    if (wantAttack) {
      let kind = this.pickAttack(dist);
      // Melee needs proximity; if far, upgrade to charge (p2+) or keep chasing.
      if (kind === 'melee' && dist > MELEE_RANGE + 6) {
        if (this.combatPhase >= 2 && dist > 50) kind = 'charge';
        else kind = dist <= AOE_RADIUS + 8 ? 'aoe' : 'melee';
      }
      if (!(kind === 'melee' && dist > MELEE_RANGE + 6)) {
        this.beginAttack(kind, time);
        return;
      }
    }

    if (dist > MELEE_RANGE) {
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
    this.playIdle();
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    // Keep AoE telegraph centered on boss during wind-up.
    for (const g of this.telegraphGfx) {
      if (g instanceof Phaser.GameObjects.Arc) {
        g.setPosition(this.x, this.y);
      }
    }

    this.updateAi(time);

    this.label?.setPosition(this.x, this.y - 38);
    this.syncHpUiPositions();
    this.flashIframeTint(time, 40);
  }

  override destroy(fromScene?: boolean): void {
    this.clearTelegraphs();
    this.label?.destroy();
    super.destroy(fromScene);
  }
}
