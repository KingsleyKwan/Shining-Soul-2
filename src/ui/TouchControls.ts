import Phaser from 'phaser';

/** One frame of on-screen controls. Button edges are consumed by a single poll. */
export type TouchFrame = {
  moveX: number;
  moveY: number;
  /** ATK just pressed (edge). */
  attack: boolean;
  /** ATK held this frame. */
  attackHeld: boolean;
  /** ATK just released (edge). */
  attackReleased: boolean;
  /** 技 just pressed (edge). */
  skill: boolean;
  interact: boolean;
  restart: boolean;
  menu: boolean;
  /** 包 just pressed (edge) — inventory / equipment panel. */
  inventory: boolean;
};

type EdgeName = 'attack' | 'skill' | 'interact' | 'restart' | 'menu' | 'inventory';

type HeldButton = {
  circle: Phaser.GameObjects.Arc;
  fill: number;
  idleAlpha: number;
};

const UI_DEPTH = 1200;

/**
 * Floating virtual joystick (left half) + fixed action buttons (right).
 * Shown only on touch-capable devices.
 *
 * Stick UX:
 * - First touch down anywhere on the **left half** of the screen becomes the
 *   stick origin (base + thumb appear there).
 * - Drag from that point = direction (up/down/left/right).
 * - Release = hide stick / zero input.
 * - Right-side ATK／技／包／E buttons are never stolen by the stick zone.
 *
 * Desktop keyboard WASD is unchanged (handled outside this class).
 *
 * Hit areas must be centered on (radius, radius): Phaser translates the pointer
 * into object space then adds displayOrigin before Circle.Contains. A hit area
 * at (0, 0) therefore misses the visual center (common cause of "dead" ATK/E).
 */
export class TouchControls {
  readonly enabled: boolean;

  private readonly scene: Phaser.Scene;
  private moveX = 0;
  private moveY = 0;
  private edges: Record<EdgeName, boolean> = {
    attack: false,
    skill: false,
    interact: false,
    restart: false,
    menu: false,
    inventory: false,
  };
  private attackHeld = false;
  private attackReleased = false;
  private attackPointerId: number | null = null;
  private stickPointerId: number | null = null;
  /** Origin of the active floating stick (set on pointerdown). */
  private baseX = 0;
  private baseY = 0;
  private baseRadius = 36;
  private maxTravel = 28;
  private stickBase?: Phaser.GameObjects.Arc;
  private thumb?: Phaser.GameObjects.Arc;
  private stickZone?: Phaser.GameObjects.Zone;
  private held = new Map<number, HeldButton>();
  /** Action buttons that must reflow when EXPAND changes canvas size. */
  private buttons: {
    circle: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    anchor: (w: number, h: number) => { x: number; y: number };
  }[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.enabled = isTouchCapable(scene);
    if (!this.enabled) return;

    this.baseRadius = 36;
    this.maxTravel = 28;

    // Invisible left-half capture zone — first touch here = stick origin.
    // Right half is reserved for ATK／技／包／E so those buttons keep priority.
    this.stickZone = scene.add.zone(0, 0, 1, 1);
    this.stickZone.setScrollFactor(0);
    this.stickZone.setDepth(UI_DEPTH - 1);
    this.stickZone.setInteractive();
    this.stickZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.beginStick(pointer);
    });

    // Stick visuals start hidden; shown at the touch origin on pointerdown.
    this.stickBase = scene.add.circle(0, 0, this.baseRadius, 0x8ea4bc, 0.32);
    this.stickBase.setStrokeStyle(2, 0xffffff, 0.5);
    this.stickBase.setScrollFactor(0);
    this.stickBase.setDepth(UI_DEPTH);
    this.stickBase.setVisible(false);
    this.stickBase.disableInteractive();

    this.thumb = scene.add.circle(0, 0, 14, 0xf4f8fc, 0.9);
    this.thumb.setStrokeStyle(2, 0xffffff, 0.85);
    this.thumb.setScrollFactor(0);
    this.thumb.setDepth(UI_DEPTH + 1);
    this.thumb.setVisible(false);
    this.thumb.disableInteractive();

    this.makeButton((w, h) => ({ x: w - 48, y: h - 58 }), 30, '攻擊', 12, 0xb42323, 'attack', 46);
    this.makeButton((w, h) => ({ x: w - 112, y: h - 42 }), 24, 'E', 14, 0xc4922a, 'interact', 36);
    // Above E so it does not cover ATK / E / R / ☰.
    this.makeButton((w, h) => ({ x: w - 112, y: h - 90 }), 22, '技', 14, 0x4a3aa8, 'skill', 30);
    this.makeButton((w, _h) => ({ x: w - 68, y: 22 }), 18, 'R', 12, 0x163044, 'restart', 28);
    this.makeButton((w, _h) => ({ x: w - 24, y: 22 }), 18, '☰', 14, 0x163044, 'menu', 28);
    // Inventory / equipment (left of R so it stays clear of ATK / E / 技).
    this.makeButton((w, _h) => ({ x: w - 112, y: 22 }), 18, '包', 11, 0x2a4a3a, 'inventory', 28);
    this.layout();
  }

  /** Reflow stick zone + action buttons to the live canvas (EXPAND / rotate). */
  layout(): void {
    if (!this.enabled) return;
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const halfW = w * 0.5;
    if (this.stickZone?.active) {
      this.stickZone.setPosition(halfW * 0.5, h * 0.5);
      this.stickZone.setSize(halfW, h);
      // Refresh hit area after setSize.
      this.stickZone.setInteractive();
    }
    for (const btn of this.buttons) {
      const at = btn.anchor(w, h);
      if (btn.circle.active) btn.circle.setPosition(at.x, at.y);
      if (btn.label.active) btn.label.setPosition(at.x, at.y);
    }
  }

  /** Move vector in [-1, 1] plus one-frame edges for ATK / 技 / E / R / menu. */
  poll(): TouchFrame {
    this.syncStick();
    this.syncButtons();
    const frame: TouchFrame = {
      moveX: this.moveX,
      moveY: this.moveY,
      attack: this.edges.attack,
      attackHeld: this.attackHeld,
      attackReleased: this.attackReleased,
      skill: this.edges.skill,
      interact: this.edges.interact,
      restart: this.edges.restart,
      menu: this.edges.menu,
      inventory: this.edges.inventory,
    };
    this.edges.attack = false;
    this.edges.skill = false;
    this.edges.interact = false;
    this.edges.restart = false;
    this.edges.menu = false;
    this.edges.inventory = false;
    this.attackReleased = false;
    return frame;
  }

  private beginStick(pointer: Phaser.Input.Pointer): void {
    if (this.stickPointerId !== null) return;
    // Guard: never capture touches that land on the right half (buttons live there).
    if (pointer.x >= this.scene.scale.width * 0.5) return;
    this.stickPointerId = pointer.id;
    this.baseX = pointer.x;
    this.baseY = pointer.y;
    if (this.stickBase?.active) {
      this.stickBase.setPosition(this.baseX, this.baseY);
      this.stickBase.setVisible(true);
    }
    if (this.thumb?.active) {
      this.thumb.setPosition(this.baseX, this.baseY);
      this.thumb.setVisible(true);
    }
    this.moveX = 0;
    this.moveY = 0;
  }

  private makeButton(
    anchor: (w: number, h: number) => { x: number; y: number },
    radius: number,
    label: string,
    fontSize: number,
    fill: number,
    edge: EdgeName,
    hitRadius: number,
  ): void {
    const idleAlpha = 0.78;
    const at = anchor(this.scene.scale.width, this.scene.scale.height);
    const circle = this.scene.add.circle(at.x, at.y, radius, fill, idleAlpha);
    circle.setStrokeStyle(2, 0xffffff, 0.7);
    circle.setScrollFactor(0);
    // Interactive circle above the label so topOnly never skips the hit target.
    // Depth above stickZone so right-side buttons win when overlapping mid-screen.
    circle.setDepth(UI_DEPTH + 4);
    enableCircleHit(circle, radius, hitRadius);
    circle.setData('touchUi', edge);
    circle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Edge, same idea as Keyboard.JustDown — holding does not repeat.
      this.edges[edge] = true;
      circle.setFillStyle(fill, 1);
      this.held.set(pointer.id, { circle, fill, idleAlpha });
      if (edge === 'attack') {
        this.attackHeld = true;
        this.attackPointerId = pointer.id;
      }
    });

    const text = this.scene.add
      .text(at.x, at.y, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 3);
    this.buttons.push({ circle, label: text, anchor });
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
    if (this.attackPointerId !== null) {
      const p = this.scene.input.manager.pointers[this.attackPointerId];
      if (!p?.isDown) {
        if (this.attackHeld) this.attackReleased = true;
        this.attackHeld = false;
        this.attackPointerId = null;
      }
    }
    if (this.held.size === 0) return;
    const pointers = this.scene.input.manager.pointers;
    for (const [id, btn] of [...this.held]) {
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

    const dead = max * 0.18;
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
    if (this.stickBase?.active) this.stickBase.setVisible(false);
    if (this.thumb?.active) this.thumb.setVisible(false);
  }
}

/**
 * Phaser hit-tests in local space AFTER adding displayOrigin.
 * For a circle of paint radius `radius` (origin 0.5), the visual center is
 * therefore (radius, radius) in hit-area space — not (0, 0).
 */
function enableCircleHit(
  circle: Phaser.GameObjects.Arc,
  radius: number,
  hitRadius: number,
): void {
  circle.setInteractive(
    new Phaser.Geom.Circle(radius, radius, hitRadius),
    Phaser.Geom.Circle.Contains,
  );
}

/** Touch screen, coarse pointer, or Phaser's own touch flag. */
export function isTouchCapable(scene: Phaser.Scene): boolean {
  if (scene.sys.game.device.input.touch) return true;
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
