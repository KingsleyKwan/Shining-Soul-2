import Phaser from 'phaser';

/** One frame of on-screen controls. Button edges are consumed by a single poll. */
export type TouchFrame = {
  moveX: number;
  moveY: number;
  attack: boolean;
  interact: boolean;
  restart: boolean;
  menu: boolean;
};

type EdgeName = 'attack' | 'interact' | 'restart' | 'menu';

type HeldButton = {
  circle: Phaser.GameObjects.Arc;
  fill: number;
  idleAlpha: number;
};

const UI_DEPTH = 1200;

/**
 * Camera-fixed joystick (bottom-left) and buttons.
 * Shown only on touch-capable devices. After pointerdown on the stick, the
 * Phaser pointer id is captured so the thumb keeps tracking outside the base.
 */
export class TouchControls {
  readonly enabled: boolean;

  private readonly scene: Phaser.Scene;
  private moveX = 0;
  private moveY = 0;
  private edges: Record<EdgeName, boolean> = {
    attack: false,
    interact: false,
    restart: false,
    menu: false,
  };
  private stickPointerId: number | null = null;
  private domPointerId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private maxTravel = 24;
  private thumb?: Phaser.GameObjects.Arc;
  private held = new Map<number, HeldButton>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.enabled = isTouchCapable(scene);
    if (!this.enabled) return;

    const w = scene.scale.width;
    const h = scene.scale.height;
    this.baseX = 64;
    this.baseY = h - 62;
    this.maxTravel = 24;

    const base = scene.add.circle(this.baseX, this.baseY, 36, 0x8ea4bc, 0.32);
    base.setStrokeStyle(2, 0xffffff, 0.5);
    base.setScrollFactor(0);
    base.setDepth(UI_DEPTH);
    // Hit radius is larger than the painted base so a thumb can grab it easily.
    base.setInteractive(new Phaser.Geom.Circle(0, 0, 50), Phaser.Geom.Circle.Contains);
    base.setData('touchUi', 'stick');
    base.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.stickPointerId !== null) return;
      this.stickPointerId = pointer.id;
      this.captureDomPointer(pointer);
      this.placeThumb(pointer.x, pointer.y);
    });

    this.thumb = scene.add.circle(this.baseX, this.baseY, 14, 0xf4f8fc, 0.9);
    this.thumb.setStrokeStyle(2, 0xffffff, 0.85);
    this.thumb.setScrollFactor(0);
    this.thumb.setDepth(UI_DEPTH + 1);

    this.makeButton(w - 46, h - 56, 28, 'ATK', 10, 0xb42323, 'attack');
    this.makeButton(w - 108, h - 40, 20, 'E', 13, 0xc4922a, 'interact');
    this.makeButton(w - 68, 20, 16, 'R', 12, 0x163044, 'restart');
    this.makeButton(w - 24, 20, 16, '☰', 14, 0x163044, 'menu');

    scene.events.once('shutdown', () => this.releaseDomCapture());
  }

  /** Move vector in [-1, 1] plus one-frame edges for ATK / E / R / menu. */
  poll(): TouchFrame {
    this.syncStick();
    this.syncButtons();
    const frame: TouchFrame = {
      moveX: this.moveX,
      moveY: this.moveY,
      attack: this.edges.attack,
      interact: this.edges.interact,
      restart: this.edges.restart,
      menu: this.edges.menu,
    };
    this.edges.attack = false;
    this.edges.interact = false;
    this.edges.restart = false;
    this.edges.menu = false;
    return frame;
  }

  private makeButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    fontSize: number,
    fill: number,
    edge: EdgeName,
  ): void {
    const idleAlpha = 0.78;
    const circle = this.scene.add.circle(x, y, radius, fill, idleAlpha);
    circle.setStrokeStyle(2, 0xffffff, 0.7);
    circle.setScrollFactor(0);
    circle.setDepth(UI_DEPTH + 2);
    circle.setInteractive(new Phaser.Geom.Circle(0, 0, radius), Phaser.Geom.Circle.Contains);
    circle.setData('touchUi', edge);
    circle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Edge, same idea as Keyboard.JustDown — holding does not repeat.
      this.edges[edge] = true;
      circle.setFillStyle(fill, 1);
      this.held.set(pointer.id, { circle, fill, idleAlpha });
    });

    this.scene.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 3);
  }

  private syncStick(): void {
    if (this.stickPointerId === null) return;
    const pointer = this.scene.input.manager.pointers[this.stickPointerId];
    if (!pointer || !pointer.isDown) {
      this.releaseStick();
      return;
    }
    this.placeThumb(pointer.x, pointer.y);
  }

  private syncButtons(): void {
    if (this.held.size === 0) return;
    const pointers = this.scene.input.manager.pointers;
    for (const [id, btn] of this.held) {
      const pointer = pointers[id];
      if (pointer?.isDown) continue;
      if (btn.circle.active) btn.circle.setFillStyle(btn.fill, btn.idleAlpha);
      this.held.delete(id);
    }
  }

  private placeThumb(px: number, py: number): void {
    const rawX = px - this.baseX;
    const rawY = py - this.baseY;
    const dist = Math.hypot(rawX, rawY);
    const max = this.maxTravel;
    const clamp = dist > max && dist > 0 ? max / dist : 1;
    if (this.thumb?.active) {
      this.thumb.setPosition(this.baseX + rawX * clamp, this.baseY + rawY * clamp);
    }

    const dead = max * 0.2;
    if (dist <= dead || dist === 0) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }
    const mag = Math.min(1, (Math.min(dist, max) - dead) / (max - dead));
    this.moveX = (rawX / dist) * mag;
    this.moveY = (rawY / dist) * mag;
  }

  private releaseStick(): void {
    this.stickPointerId = null;
    this.moveX = 0;
    this.moveY = 0;
    if (this.thumb?.active) this.thumb.setPosition(this.baseX, this.baseY);
    this.releaseDomCapture();
  }

  /**
   * DOM setPointerCapture when the event is a PointerEvent.
   * Touch Events have no pointerId; Phaser still delivers touchmove to the
   * captured pointer id after the finger leaves the stick.
   */
  private captureDomPointer(pointer: Phaser.Input.Pointer): void {
    const native = pointer.event as Event | undefined;
    if (!native || !('pointerId' in native)) return;
    const pointerId = (native as PointerEvent).pointerId;
    try {
      this.scene.game.canvas.setPointerCapture(pointerId);
      this.domPointerId = pointerId;
    } catch {
      this.domPointerId = null;
    }
  }

  private releaseDomCapture(): void {
    if (this.domPointerId === null) return;
    const id = this.domPointerId;
    this.domPointerId = null;
    try {
      const canvas = this.scene.game.canvas;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      /* pointer already released */
    }
  }
}

/** Touch screen, coarse pointer, or Phaser's own touch flag. */
export function isTouchCapable(scene: Phaser.Scene): boolean {
  if (scene.sys.game.device.input.touch) return true;
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
