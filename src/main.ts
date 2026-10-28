import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { SelectScene } from './scenes/SelectScene';
import { StoryScene } from './scenes/StoryScene';
import { VillageScene } from './scenes/VillageScene';
import { StageSelectScene } from './scenes/StageSelectScene';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 480,
  height: 320,
  backgroundColor: '#1a2a1a',
  pixelArt: true,
  roundPixels: true,
  fps: { target: 60, forceSetTimeOut: false },
  render: { antialias: false, powerPreference: 'high-performance' },
  // Long-press on the stick should not open the browser menu.
  disableContextMenu: true,
  input: {
    // Pointer 0 is the mouse. Touches use 1..N — stick + 技 + ATK + E need four.
    activePointers: 5,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, SelectScene, StoryScene, VillageScene, StageSelectScene, GameScene],
};

const game = new Phaser.Game(config);

/** Stable bridge for DOM GAME OVER (and QA consoles) — outside scene lifecycle. */
const w = window as Window & { __SS2_GAME__?: Phaser.Game };
w.__SS2_GAME__ = game;

export { game };
