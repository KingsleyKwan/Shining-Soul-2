import Phaser from 'phaser';
import type { TouchFrame } from '../ui/TouchControls';

/**
 * Frame of move / attack / skill / interact / restart / menu.
 * GameScene owns one of these and refills it every update from the keyboard
 * plugin (if it exists) and from TouchControls. Neither source is required.
 */
export class InputState {
  moveX = 0;
  moveY = 0;
  /** Space, Z, or the ATK button — edge on press (legacy / chest suppress). */
  attackPressed = false;
  /** ATK held this frame (keyboard Space/Z or touch ATK). */
  attackHeld = false;
  /** ATK just released this frame. */
  attackReleased = false;
  /** Q or the 技 button. Edge-triggered. */
  skillPressed = false;
  /** Keyboard Space edge. Near a chest this opens it and suppresses the slash. */
  spacePressed = false;
  /** E, Space, or the E button. Edge-triggered. */
  interactPressed = false;
  restartPressed = false;
  menuPressed = false;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private keySpace?: Phaser.Input.Keyboard.Key;
  private keyZ?: Phaser.Input.Keyboard.Key;
  private keyQ?: Phaser.Input.Keyboard.Key;
  private keyE?: Phaser.Input.Keyboard.Key;
  private keyR?: Phaser.Input.Keyboard.Key;
  private keyEsc?: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) return;

    this.cursors = kb.createCursorKeys();
    this.wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyZ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.keyQ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyE = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyR = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyEsc = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  update(touch: TouchFrame): void {
    let x = touch.moveX;
    let y = touch.moveY;
    const cursors = this.cursors;
    const wasd = this.wasd;
    if (cursors && wasd) {
      if (cursors.left.isDown || wasd.left.isDown) x -= 1;
      if (cursors.right.isDown || wasd.right.isDown) x += 1;
      if (cursors.up.isDown || wasd.up.isDown) y -= 1;
      if (cursors.down.isDown || wasd.down.isDown) y += 1;
    }
    this.moveX = Phaser.Math.Clamp(x, -1, 1);
    this.moveY = Phaser.Math.Clamp(y, -1, 1);

    const space = justDown(this.keySpace);
    const zDown = justDown(this.keyZ);
    const kbAtkHeld = !!(this.keySpace?.isDown || this.keyZ?.isDown);
    const kbAtkReleased = justUp(this.keySpace) || justUp(this.keyZ);

    this.spacePressed = space;
    this.attackPressed = space || zDown || touch.attack;
    this.attackHeld = kbAtkHeld || touch.attackHeld;
    this.attackReleased = kbAtkReleased || touch.attackReleased;
    this.skillPressed = justDown(this.keyQ) || touch.skill;
    this.interactPressed = justDown(this.keyE) || space || touch.interact;
    this.restartPressed = justDown(this.keyR) || touch.restart;
    this.menuPressed = justDown(this.keyEsc) || touch.menu;
  }
}

function justDown(key: Phaser.Input.Keyboard.Key | undefined): boolean {
  return !!key && Phaser.Input.Keyboard.JustDown(key);
}

function justUp(key: Phaser.Input.Keyboard.Key | undefined): boolean {
  return !!key && Phaser.Input.Keyboard.JustUp(key);
}
