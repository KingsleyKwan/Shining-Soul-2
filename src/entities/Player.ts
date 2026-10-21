import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio';
import { getHero, type HeroDef } from '../heroes';

export type MoveKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

export type Facing = 'down' | 'up' | 'left' | 'right';

const ATTACK_MOVE_FACTOR = 0.15;
const HITBOX_LIFE_MS = 200;
const HITBOX_W = 28;
const HITBOX_H = 28;
const HITBOX_REACH = 22;

const PLAYER_IFRAME_MS = 550;
const HURT_STUN_MS = 300;

/**
 * Playable hero (Eric / Prim / Raizen) — walk / attack / hurt / death.
 * Atlases: Claire Starsword @ Spriters Resource (see tools/extract_*.py).
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  facing: Facing = 'down';
  readonly maxHp: number;
  hp: number;
  readonly hero: HeroDef;

  private moveSpeed: number;
  private attacking = false;
  private stunned = false;
  private dead = false;
  private dying = false;
  private iframeUntil = 0;
  private stunUntil = 0;
  private attackKeys!: {
    space: Phaser.Input.Keyboard.Key;
    z: Phaser.Input.Keyboard.Key;
  };
  private hitbox?: Phaser.GameObjects.Zone;
  private onHitboxSpawn?: (zone: Phaser.GameObjects.Zone) => void;
  private onHpChange?: (hp: number, maxHp: number) => void;
  private onDeath?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, hero?: HeroDef) {
    const h = hero ?? getHero('eric');
    super(scene, x, y, h.atlas, h.previewFrame);

    this.hero = h;
    this.maxHp = h.maxHp;
    this.hp = h.maxHp;
    this.moveSpeed = h.speed;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.setDepth(10);
    this.setScale(2);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 14);
    body.setOffset(5, 12);

    if (!scene.input.keyboard) {
      throw new Error('Keyboard required');
    }
    this.attackKeys = {
      space: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      z: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
    };

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

  isDead(): boolean {
    return this.dead || this.dying;
  }

  /** Prefixed anim key, e.g. prim-walk-down */
  private ak(suffix: string): string {
    return `${this.hero.anim}-${suffix}`;
  }

  private skipAttackOnce = false;

  /** Skip the next Space/Z attack (used when Space opens a chest). */
  suppressNextAttack(): void {
    this.skipAttackOnce = true;
  }

  /** Heal up to maxHp. @returns amount actually restored */
  heal(amount: number): number {
    if (this.dead || this.dying || !this.active || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const gained = this.hp - before;
    if (gained > 0) this.onHpChange?.(this.hp, this.maxHp);
    return gained;
  }

  /** @returns true if damage applied */
  takeDamage(amount: number, fromX: number, fromY: number): boolean {
    if (this.dead || this.dying || !this.active) return false;

    const now = this.scene.time.now;
    if (now < this.iframeUntil) return false;

    this.iframeUntil = now + PLAYER_IFRAME_MS;
    this.hp = Math.max(0, this.hp - amount);
    this.onHpChange?.(this.hp, this.maxHp);
    GameAudio.get(this.scene)?.hurt();

    // Interrupt slash
    this.attacking = false;
    this.clearHitbox();

    this.setTint(0xff6666);
    this.scene.cameras.main.shake(80, 0.004);

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.setVelocity((dx / len) * 100, (dy / len) * 100);

    if (this.hp <= 0) {
      this.startDeath();
      return true;
    }

    // Brief hurt stun + directional hurt pose
    this.stunned = true;
    this.stunUntil = now + HURT_STUN_MS;
    this.playHurtAnim();

    this.scene.time.delayedCall(HURT_STUN_MS, () => {
      if (!this.active || this.dying || this.dead) return;
      this.stunned = false;
      this.clearTint();
      this.showIdleFrame();
    });

    this.scene.time.delayedCall(PLAYER_IFRAME_MS, () => {
      if (this.active && !this.dead && !this.dying && !this.stunned) this.clearTint();
    });

    return true;
  }

  private playHurtAnim(): void {
    this.setFlipX(false);
    const key =
      this.facing === 'up'
        ? this.ak('hurt-up')
        : this.facing === 'left'
          ? this.ak('hurt-left')
          : this.facing === 'right'
            ? this.ak('hurt-right')
            : this.ak('hurt-down');
    this.play(key, true);
  }

  private startDeath(): void {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.stunned = true;
    this.attacking = false;
    this.clearHitbox();
    this.setVelocity(0, 0);
    this.clearTint();
    this.setFlipX(false);
    // Play knockdown; GAME OVER fires after anim completes (not mid-anim)
    this.play(this.ak('death'), false);
  }

  handleInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: MoveKeys,
    _delta: number,
  ): void {
    if (this.dead || this.dying) {
      this.setVelocity(0, 0);
      return;
    }

    if (this.stunned) {
      // Let knockback settle; no control
      const now = this.scene.time.now;
      if (now >= this.stunUntil) {
        this.stunned = false;
      } else {
        return;
      }
    }

    if (this.skipAttackOnce) {
      this.skipAttackOnce = false;
    } else {
      const wantAttack =
        Phaser.Input.Keyboard.JustDown(this.attackKeys.space) ||
        Phaser.Input.Keyboard.JustDown(this.attackKeys.z);

      if (wantAttack && !this.attacking) {
        this.startAttack();
      }
    }

    let vx = 0;
    let vy = 0;

    if (!this.attacking) {
      if (cursors.left.isDown || wasd.left.isDown) vx -= 1;
      if (cursors.right.isDown || wasd.right.isDown) vx += 1;
      if (cursors.up.isDown || wasd.up.isDown) vy -= 1;
      if (cursors.down.isDown || wasd.down.isDown) vy += 1;
    } else {
      if (cursors.left.isDown || wasd.left.isDown) vx -= ATTACK_MOVE_FACTOR;
      if (cursors.right.isDown || wasd.right.isDown) vx += ATTACK_MOVE_FACTOR;
      if (cursors.up.isDown || wasd.up.isDown) vy -= ATTACK_MOVE_FACTOR;
      if (cursors.down.isDown || wasd.down.isDown) vy += ATTACK_MOVE_FACTOR;
    }

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy) || 1;
      const speed = this.attacking ? this.moveSpeed * 0.35 : this.moveSpeed;
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;

      if (!this.attacking) {
        this.updateFacing(vx, vy);
      }
      this.setVelocity(vx, vy);
    } else if (!this.attacking) {
      const now = this.scene.time.now;
      if (now >= this.iframeUntil - PLAYER_IFRAME_MS + 120) {
        this.setVelocity(0, 0);
      }
    }

    if (!this.attacking) {
      this.updateWalkAnim(vx, vy);
    }

    if (!this.attacking && this.iframeUntil > this.scene.time.now) {
      const t = this.scene.time.now;
      this.setTint(Math.floor(t / 50) % 2 === 0 ? 0xff8888 : 0xffffff);
    }
  }

  private updateFacing(vx: number, vy: number): void {
    if (Math.abs(vx) > Math.abs(vy)) {
      this.facing = vx < 0 ? 'left' : 'right';
    } else if (Math.abs(vy) > 0) {
      this.facing = vy < 0 ? 'up' : 'down';
    }
  }

  private updateWalkAnim(vx: number, vy: number): void {
    const moving = Math.abs(vx) + Math.abs(vy) > 1;

    if (!moving) {
      this.anims.stop();
      this.showIdleFrame();
      return;
    }

    if (this.facing === 'right') {
      this.setFlipX(true);
      this.play(this.ak('walk-left'), true);
    } else if (this.facing === 'left') {
      this.setFlipX(false);
      this.play(this.ak('walk-left'), true);
    } else if (this.facing === 'up') {
      this.setFlipX(false);
      this.play(this.ak('walk-up'), true);
    } else {
      this.setFlipX(false);
      this.play(this.ak('walk-down'), true);
    }
  }

  private showIdleFrame(): void {
    if (this.facing === 'right') {
      this.setFlipX(true);
      this.setFrame('walk_left_0');
    } else if (this.facing === 'left') {
      this.setFlipX(false);
      this.setFrame('walk_left_0');
    } else if (this.facing === 'up') {
      this.setFlipX(false);
      this.setFrame('walk_up_0');
    } else {
      this.setFlipX(false);
      this.setFrame('walk_down_0');
    }
  }

  private startAttack(): void {
    GameAudio.get(this.scene)?.slash();
    this.attacking = true;
    this.setVelocity(0, 0);

    let animKey: string;
    if (this.facing === 'right') {
      this.setFlipX(false);
      animKey = this.ak('attack-right');
    } else if (this.facing === 'left') {
      this.setFlipX(false);
      animKey = this.ak('attack-left');
    } else if (this.facing === 'up') {
      this.setFlipX(false);
      animKey = this.ak('attack-up');
    } else {
      this.setFlipX(false);
      animKey = this.ak('attack-down');
    }

    this.play(animKey, false);
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
    if (anim.key === this.ak('death')) {
      this.dead = true;
      this.dying = false;
      // Hold last death frame, then signal GAME OVER
      this.anims.stop();
      this.setFrame('death_4');
      this.onDeath?.();
      return;
    }
    if (anim.key.startsWith(`${this.hero.anim}-attack-`)) {
      this.attacking = false;
      if (!this.dead && !this.dying && !this.stunned) this.showIdleFrame();
    }
  }

  destroy(fromScene?: boolean): void {
    this.clearHitbox();
    super.destroy(fromScene);
  }
}
