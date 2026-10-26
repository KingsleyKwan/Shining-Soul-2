import Phaser from 'phaser';

/** One swing, or several overlaps in the same instant, becomes a single pulse. Wall clock. */
const COALESCE_MS = 80;
/** Near-freeze length. Real timer, so it still ends if a time scale is stuck. */
const HITSTOP_MS = 60;
/**
 * Arcade `World.timeScale`: 1 = normal, larger = slower.
 * A high value is a near-freeze. TweenManager uses the opposite convention.
 */
const HITSTOP_PHYSICS_SCALE = 60;
/** TweenManager.timeScale: smaller = slower. Paired with the physics factor. */
const HITSTOP_TWEEN_SCALE = 1 / HITSTOP_PHYSICS_SCALE;

const SHAKE_MS = 55;

/**
 * Light hitstop + camera shake when a player attack actually deals damage.
 * GameScene owns one instance. Does not replace the heavier hurt shake on the player.
 */
export class HitFeedback {
  private lastTriggerAt = Number.NEGATIVE_INFINITY;
  private restoreTimer: number | null = null;
  private savedPhysicsScale: number | null = null;
  private savedTweenScale: number | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Call only after `takeDamage` returns true.
   * @param intensity Default 1. Nudges shake strength; the result stays in 0.002–0.003.
   */
  onPlayerLandedHit(intensity = 1): void {
    if (!this.sceneIsActive()) return;

    const now = performance.now();
    if (now - this.lastTriggerAt < COALESCE_MS) return;
    this.lastTriggerAt = now;

    this.shakeLight(intensity);
    this.beginHitstop();
  }

  /** Put time scales back if a hitstop has not finished. Safe during scene shutdown. */
  destroy(): void {
    this.clearTimer();
    this.restoreTimeScales();
  }

  private sceneIsActive(): boolean {
    try {
      return !!this.scene.sys?.isActive();
    } catch {
      return false;
    }
  }

  private sceneIsDestroyed(): boolean {
    try {
      const sys = this.scene.sys;
      if (!sys) return true;
      return sys.settings.status === Phaser.Scenes.DESTROYED;
    } catch {
      return true;
    }
  }

  private shakeLight(intensity: number): void {
    const cam = this.scene.cameras?.main;
    if (!cam) return;
    const factor = Number.isFinite(intensity) ? Phaser.Math.Clamp(intensity, 0, 2) : 1;
    // intensity 1 → 0.0025. Lighter than PlayerBase's hurt shake (80ms, 0.004).
    const amount = Phaser.Math.Clamp(0.002 + 0.0005 * factor, 0.002, 0.003);
    cam.shake(SHAKE_MS, amount);
  }

  private beginHitstop(): void {
    // Debounce makes this rare. Never snapshot the already-frozen scales.
    if (this.restoreTimer !== null) return;

    let world: Phaser.Physics.Arcade.World;
    try {
      world = this.scene.physics.world;
    } catch {
      return;
    }
    // Inventory, game over, and stage clear already pause the world.
    if (!world || world.isPaused) return;

    this.savedPhysicsScale = world.timeScale;
    this.savedTweenScale = this.scene.tweens.timeScale;
    world.timeScale = HITSTOP_PHYSICS_SCALE;
    this.scene.tweens.timeScale = HITSTOP_TWEEN_SCALE;

    this.restoreTimer = window.setTimeout(() => {
      this.restoreTimer = null;
      // Destroyed: systems are gone. Shutdown (isActive false, world still alive)
      // still restores — destroy() usually already did, and a second restore is a no-op.
      if (!this.sceneIsActive() && this.sceneIsDestroyed()) {
        this.savedPhysicsScale = null;
        this.savedTweenScale = null;
        return;
      }
      this.restoreTimeScales();
    }, HITSTOP_MS);
  }

  private restoreTimeScales(): void {
    const physicsScale = this.savedPhysicsScale;
    const tweenScale = this.savedTweenScale;
    this.savedPhysicsScale = null;
    this.savedTweenScale = null;
    if (physicsScale === null && tweenScale === null) return;

    try {
      const world = this.scene.physics?.world;
      if (world && physicsScale !== null) world.timeScale = physicsScale;
      if (tweenScale !== null && this.scene.tweens) this.scene.tweens.timeScale = tweenScale;
    } catch {
      /* Scene systems already gone. */
    }
  }

  private clearTimer(): void {
    if (this.restoreTimer === null) return;
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
  }
}
