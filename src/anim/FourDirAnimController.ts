import type Phaser from 'phaser';
import type { AnimSetKeys, AnimState, Facing } from '../data/types';

/**
 * 4-direction animation state machine: Idle / Walk / Attack / Hurt / Faint.
 * Shared logic; swap sheets by passing different AnimSetKeys from PlayerData.
 *
 * Right-facing walk/idle mirrors the left sheet via flipX (matches original atlases).
 */
export class FourDirAnimController {
  private state: AnimState = 'idle';
  private facing: Facing = 'down';

  constructor(
    private readonly sprite: Phaser.Physics.Arcade.Sprite,
    private readonly anim: AnimSetKeys,
  ) {}

  get currentState(): AnimState {
    return this.state;
  }

  get currentFacing(): Facing {
    return this.facing;
  }

  setFacing(facing: Facing): void {
    this.facing = facing;
  }

  /** Prefixed anim key, e.g. prim-walk-down */
  key(suffix: string): string {
    return `${this.anim.prefix}-${suffix}`;
  }

  isAttackKey(animKey: string): boolean {
    return animKey.startsWith(`${this.anim.prefix}-attack-`);
  }

  isDeathKey(animKey: string): boolean {
    return animKey === this.key('death');
  }

  /** Update facing from a velocity / move vector (dominant axis). */
  updateFacingFromVector(vx: number, vy: number): Facing {
    if (Math.abs(vx) > Math.abs(vy)) {
      this.facing = vx < 0 ? 'left' : 'right';
    } else if (Math.abs(vy) > 0) {
      this.facing = vy < 0 ? 'up' : 'down';
    }
    return this.facing;
  }

  playIdle(): void {
    this.state = 'idle';
    this.sprite.anims.stop();
    this.showIdleFrame();
  }

  playWalk(moving: boolean): void {
    if (!moving) {
      this.playIdle();
      return;
    }
    this.state = 'walk';
    if (this.facing === 'right') {
      this.sprite.setFlipX(true);
      this.sprite.play(this.key('walk-left'), true);
    } else if (this.facing === 'left') {
      this.sprite.setFlipX(false);
      this.sprite.play(this.key('walk-left'), true);
    } else if (this.facing === 'up') {
      this.sprite.setFlipX(false);
      this.sprite.play(this.key('walk-up'), true);
    } else {
      this.sprite.setFlipX(false);
      this.sprite.play(this.key('walk-down'), true);
    }
  }

  playAttack(): string {
    this.state = 'attack';
    this.sprite.setFlipX(false);
    let suffix: string;
    switch (this.facing) {
      case 'right':
        suffix = 'attack-right';
        break;
      case 'left':
        suffix = 'attack-left';
        break;
      case 'up':
        suffix = 'attack-up';
        break;
      default:
        suffix = 'attack-down';
        break;
    }
    const animKey = this.key(suffix);
    this.sprite.play(animKey, false);
    return animKey;
  }

  playHurt(): void {
    this.state = 'hurt';
    this.sprite.setFlipX(false);
    const suffix =
      this.facing === 'up'
        ? 'hurt-up'
        : this.facing === 'left'
          ? 'hurt-left'
          : this.facing === 'right'
            ? 'hurt-right'
            : 'hurt-down';
    this.sprite.play(this.key(suffix), true);
  }

  /** Faint / death knockdown. */
  playFaint(): void {
    this.state = 'faint';
    this.sprite.setFlipX(false);
    this.sprite.clearTint();
    this.sprite.play(this.key('death'), false);
  }

  holdDeathFrame(): void {
    this.sprite.anims.stop();
    this.sprite.setFrame(this.anim.deathLastFrame);
  }

  showIdleFrame(): void {
    const frame = this.anim.idleFrames[this.facing];
    if (this.facing === 'right') {
      this.sprite.setFlipX(true);
    } else {
      this.sprite.setFlipX(false);
    }
    this.sprite.setFrame(frame);
  }
}
