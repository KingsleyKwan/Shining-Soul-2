import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { TilePathfinder } from '../ai/TilePathfinder';
import { GameAudio } from '../audio/GameAudio';
import { getHero, SELECTED_HERO_KEY } from '../data/players';
import {
  SELECTED_STAGE_KEY,
  coerceStageId,
  getStage,
  nextStageId,
  type StageId,
} from '../data/stages';
import { formatItemToast, rollItem } from '../data/loot/roll';
import { RARITY_COLOR, rarityTagZh } from '../data/loot/types';
import { HitFeedback } from '../systems/HitFeedback';
import { Inventory, type EquipSlot } from '../systems/Inventory';
import { generateDungeon } from '../systems/MapGenerator';
import * as SaveManager from '../systems/SaveManager';
import { InputState } from '../input/InputState';
import { TouchControls } from '../ui/TouchControls';
import { InventoryPanel } from '../ui/InventoryPanel';
import { RunInfoHud } from '../ui/RunInfoHud';
import { hideGameOverDom, showGameOverDom } from '../ui/GameOverDom';
import { hideStageClearDom, showStageClearDom } from '../ui/StageClearDom';
import { hideLootToastDom, showLootToastDom } from '../ui/LootToastDom';

/** Anything the player slash can damage. */
type Hostile = Enemy | Boss;

/** a entry, c combat corridor, b chest, boss arena. */
type RoomId = 'a' | 'c' | 'b' | 'boss';

const ROOM_ORDER: RoomId[] = ['a', 'c', 'b', 'boss'];

const ROOM_LABELS: Record<StageId, Record<RoomId, string>> = {
  1: {
    a: '要塞入口',
    c: '哥不林迴廊',
    b: '寶箱房',
    boss: '蓋利隊長 · 競技場',
  },
  2: {
    a: '深層入口',
    c: '寒迴廊',
    b: '寶箱房',
    boss: '深淵競技場',
  },
};

/** Darken a 0xRRGGBB multiply tint so walls sit under the floor. */

/** Default Paste HP when the map object has no hp property. */
const PASTE_HP: Record<RoomId, number> = {
  a: 2,
  c: 3,
  b: 2,
  boss: 3,
};

/** Added to each door trigger width and height, split evenly around the opening. */
const DOOR_TRIGGER_GROW = 24;
/** Soft room clamp, in pixels. Exit-door overlaps skip this so the trigger can fire. */
const ROOM_CLAMP_INSET = 4;

/**
 * Preferred world zoom on the base 480×320 view (shows 384×256 of a 768×512 room).
 * On tall/wide EXPAND canvases we raise zoom so the camera never shows void
 * outside the current room bounds.
 */
const CAMERA_ZOOM = 1.25;

const TILE = 16;
/** Top lip is two tiles (cap + inner wall). Sides and the bottom lip are one. */
const TOP_WALL = TILE * 2;
/** East/west door rows and north/south door columns, in room-local pixels. */
const DOOR_LOCAL_Y0 = 14 * TILE;
const DOOR_LOCAL_Y1 = 18 * TILE;
const DOOR_LOCAL_X0 = 22 * TILE;
const DOOR_LOCAL_X1 = 24 * TILE;

type DoorSides = { n: boolean; e: boolean; s: boolean; w: boolean };

type DecorTheme = {
  shadow: number;
  skirt: number;
  pattern: number;
  patternAlt: number;
  flame: number;
  flameCore: number;
  stone: number;
  wood: number;
  woodDark: number;
  banner: number;
  pole: number;
};

/** Absolute colors for the decoration pass. Tile tints do not multiply Graphics. */
const DECOR_THEME: Record<StageId, DecorTheme> = {
  1: {
    shadow: 0x140e08,
    skirt: 0xe6d090,
    pattern: 0x3a3018,
    patternAlt: 0xf0e2a8,
    flame: 0xff6a1a,
    flameCore: 0xffe090,
    stone: 0x6a5840,
    wood: 0x8a5a28,
    woodDark: 0x3e2814,
    banner: 0x8e3030,
    pole: 0x3a2a18,
  },
  2: {
    shadow: 0x060814,
    skirt: 0xb8d4f4,
    pattern: 0x142038,
    patternAlt: 0xd0e4ff,
    flame: 0x3ec0ff,
    flameCore: 0xeef8ff,
    stone: 0x4a5870,
    wood: 0x3a4860,
    woodDark: 0x1a2434,
    banner: 0x3048a8,
    pole: 0x1c2838,
  },
};

type Rect = { x: number; y: number; w: number; h: number };
type SpawnPoint = { x: number; y: number };
type EnemySpawn = SpawnPoint & { room: RoomId; hp: number };
type DoorSpawn = {
  x: number;
  y: number;
  w: number;
  h: number;
  target: string;
  room: RoomId;
};

function isRoomId(value: string | undefined): value is RoomId {
  return value === 'a' || value === 'c' || value === 'b' || value === 'boss';
}

/** New layout every create (new game, restart, stage-clear 重新開始). */
function rollDungeonSeed(): number {
  const clock = Date.now() >>> 0;
  const noise = Math.floor(Math.random() * 0x7fffffff);
  return (clock ^ noise) >>> 0;
}

/**
 * One-stage dungeon. Each run stamps a new connected room graph
 * (entry, combat, chest, boss) into Tiled JSON and clamps the camera per room.
 * Door objects teleport with a short fade. The player is soft-clamped to the
 * current room so a doorway cannot be walked through without that teleport.
 * Pastes and the boss simulate only in their own room. After Captain Gully falls,
 * an exit portal in the arena opens the stage-clear overlay.
 */
export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemies!: Phaser.GameObjects.Group;
  private boss?: Boss;
  /** Arcade group: overlap needs collisionCategory / collisionMask (plain Groups lack both). */
  private hostiles!: Phaser.Physics.Arcade.Group;
  private touch!: TouchControls;
  private inputState!: InputState;
  private leaving = false;
  private hpHud!: Phaser.GameObjects.Text;
  private skillHud!: Phaser.GameObjects.Text;
  private roomHud!: Phaser.GameObjects.Text;
  private goldHud!: Phaser.GameObjects.Text;
  private gold = 0;
  private inventory = new Inventory();
  private runInfo?: RunInfoHud;
  private inventoryPanel!: InventoryPanel;
  private inventoryOpen = false;
  private chestOpened = false;
  private chestPos?: { x: number; y: number };
  private chestGfx?: Phaser.GameObjects.Graphics;
  private chestLabel?: Phaser.GameObjects.Text;
  private chestPrompt?: Phaser.GameObjects.Text;
  private gameOver = false;
  private bossDefeated = false;
  private stageClearVisible = false;
  /** Ignore the exit until the player walks off it (繼續 dismiss). */
  private exitSuppress = false;
  private exitActive = false;
  private transitioning = false;
  private currentRoom: RoomId = 'a';
  /** Seed of the dungeon generated for this run. Shown on the room HUD. */
  private runSeed = 0;
  /** Stage chosen on StageSelectScene (default 1). */
  private runStage: StageId = 1;
  /** Combat rooms that already played the clear sting this run. */
  private clearedRooms = new Set<RoomId>();
  /** Rooms the camera has visited. The minimap starts dim outside this set. */
  private exploredRooms = new Set<RoomId>();
  private rooms!: Record<RoomId, Rect>;
  private pathfinder!: TilePathfinder;
  private audio!: GameAudio;
  private hitFeedback!: HitFeedback;
  private muteHud!: Phaser.GameObjects.Text;
  /** Unzoomed overlay camera — keeps HUD/touch in viewport while main cover-zooms. */
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private readonly uiObjects = new Set<Phaser.GameObjects.GameObject>();
  private vignetteGfx?: Phaser.GameObjects.Graphics;
  private spawns!: {
    player: SpawnPoint;
    /** Arrival points keyed by Tiled object name (spawn_a, spawn_c_west, …). */
    points: Record<string, SpawnPoint>;
    enemies: EnemySpawn[];
    boss?: SpawnPoint;
    chest?: SpawnPoint;
    exit?: SpawnPoint;
    doors: DoorSpawn[];
  };

  constructor() {
    super('GameScene');
  }

  create(): void {
    // Always clear DOM overlays left from a prior death or stage clear.
    hideGameOverDom();
    hideStageClearDom();
    hideLootToastDom();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.persistSave();
      hideGameOverDom();
      hideStageClearDom();
      hideLootToastDom();
    });
    // World camera may cover-zoom; HUD/touch live on a separate zoom-1 camera.
    this.bootstrapUiCamera();
    this.gameOver = false;
    this.bossDefeated = false;
    this.stageClearVisible = false;
    this.exitSuppress = false;
    this.exitActive = false;
    this.transitioning = false;
    this.currentRoom = 'a';
    this.clearedRooms.clear();
    this.exploredRooms.clear();
    this.chestOpened = false;
    this.gold = 0;
    this.inventory = new Inventory();
    this.inventoryOpen = false;
    this.leaving = false;
    this.loadPersistedState();

    this.runStage = coerceStageId(this.registry.get(SELECTED_STAGE_KEY));
    this.registry.set(SELECTED_STAGE_KEY, this.runStage);
    const stageDef = getStage(this.runStage);
    const generated = generateDungeon(rollDungeonSeed(), {
      ...stageDef.mapOptions,
      propDensity: stageDef.visual.propDensity,
      floorStyle: stageDef.visual.floorStyle,
    });
    this.runSeed = generated.seed;
    const mapKey = 'dungeon-run';
    this.cache.tilemap.remove(mapKey);
    this.cache.tilemap.add(mapKey, {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: generated.tiled,
    });
    const map = this.make.tilemap({ key: mapKey });
    const tileset = map.addTilesetImage('dungeon-tiles', 'dungeon-tiles');
    if (!tileset) {
      throw new Error('Failed to add tileset "dungeon-tiles"');
    }

    const ground = map.createLayer('ground', tileset, 0, 0);
    const walls = map.createLayer('walls', tileset, 0, 0);
    if (!ground || !walls) {
      throw new Error('Missing ground/walls layers in dungeon map');
    }

    ground.setDepth(0);
    walls.setDepth(1);
    walls.setCollisionByExclusion([-1]);
    this.pathfinder = new TilePathfinder(walls);

    // Shared AudioManager — survives restart; SHUTDOWN clears BGM so loops never stack.
    this.audio = GameAudio.attach(this);
    this.hitFeedback = new HitFeedback(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio?.shutdown();
      this.hitFeedback.destroy();
    });

    const worldW = map.widthInPixels;
    const worldH = map.heightInPixels;
    this.applyStageLook(ground, walls, worldW, worldH);
    // Full map physics bounds; camera clamps per room
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.rooms = this.readRooms(map);
    this.spawns = this.readSpawns(map);
    this.decorateRooms();

    const hero = getHero(this.registry.get(SELECTED_HERO_KEY) as string);
    this.player = new Player(this, this.spawns.player.x, this.spawns.player.y, hero);
    this.player.setHitboxHandler((zone) => this.wireHitbox(zone));
    this.player.setHudHandlers({
      onHpChange: (hp, max) => this.refreshHpHud(hp, max),
      onDeath: () => this.showGameOver(),
    });
    this.physics.add.collider(this.player, walls);
    // Brief spawn grace so a nearby Paste cannot delete a fresh run.
    this.player.grantSpawnGrace(2000);
    this.applyLoadedGear();

    this.enemies = this.add.group({ runChildUpdate: true });
    // Physics group so slash / charge / Prim bolt / Raizen flurry overlap can call takeDamage.
    // Empty defaults: Pastes and the boss already have bodies — do not enable a second one
    // or stamp max velocity / world-bounds over the constructor settings.
    this.hostiles = this.physics.add.group();
    this.hostiles.defaults = {} as Phaser.Physics.Arcade.Group['defaults'];

    for (const p of this.spawns.enemies) {
      this.spawnPaste(p.x, p.y, p.hp, p.room, walls);
    }

    if (this.spawns.boss) {
      this.boss = new Boss(this, this.spawns.boss.x, this.spawns.boss.y, 14);
      this.boss.spawnRoom = 'boss';
      this.boss.setTarget(this.player);
      this.boss.setPathfinder(this.pathfinder);
      this.boss.setOnDefeated(() => this.showBossVictory());
      this.boss.setOnLootDrop((dx, dy) => this.tryEnemyDrop(dx, dy, 0.55));
      // Hidden until applyRoomCamera — create always starts in Entry.
      this.boss.setRoomPresent(false);
      this.hostiles.add(this.boss);
      this.physics.add.collider(this.boss, walls);
    }

    if (this.spawns.chest) {
      this.placeChest(this.spawns.chest.x, this.spawns.chest.y);
    }

    this.setupDoors();
    const startRoom = this.roomAt(this.spawns.player.x, this.spawns.player.y) ?? 'a';
    this.applyRoomCamera(startRoom);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    // Fractional zoom jitters when the camera snaps to whole pixels.
    this.cameras.main.setRoundPixels(false);
    this.addCameraVignette();

    this.touch = new TouchControls(this);
    this.inputState = new InputState(this);

    const helpLine = this.touch.enabled
      ? '浮動搖桿 · 長按攻擊 · 技 · E · 包 · R · ☰'
      : 'WASD · 長按 Space/Z · Q · E 寶箱 · I/Tab 包 · M · R · Esc';
    const help = this.add
      .text(this.scale.width / 2, this.scale.height - 4, helpLine, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#d8e8d8',
        backgroundColor: '#00000088',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(110);
    this.promoteUi(help);
    this.tweens.add({
      targets: help,
      alpha: 0,
      delay: 4200,
      duration: 400,
      onComplete: () => help.destroy(),
    });

    const hudPad = { x: 3, y: 1 };
    this.hpHud = this.add
      .text(6, 2, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffd0d0',
        backgroundColor: '#00000099',
        padding: hudPad,
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshHpHud(this.player.hp, this.player.maxHp);

    this.skillHud = this.add
      .text(6, 16, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffffff',
        backgroundColor: '#00000099',
        padding: hudPad,
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshSkillHud();

    this.roomHud = this.add
      .text(6, 28, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: stageDef.visual.nameplateColor,
        backgroundColor: '#00000099',
        padding: hudPad,
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshRoomHud();

    this.goldHud = this.add
      .text(6, 40, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffe066',
        backgroundColor: '#00000099',
        padding: hudPad,
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshGoldHud();

    this.runInfo = new RunInfoHud(this, { touch: this.touch.enabled });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.runInfo?.destroy();
      this.runInfo = undefined;
    });
    this.refreshRunInfo();

    const onGameResize = (): void => {
      this.ensureUiCamera();
      if (this.currentRoom) this.applyRoomCamera(this.currentRoom);
      this.redrawVignette();
      this.touch?.layout();
      this.runInfo?.layout(this.touch?.enabled ?? false);
      this.runInfo && this.refreshRunInfo();
    };
    this.scale.on('resize', onGameResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onGameResize);
    });

    this.inventoryPanel = new InventoryPanel(this, {
      onEquip: (uid) => this.equipBagItem(uid),
      onUnequip: (slot) => this.unequipSlot(slot),
      onClose: () => this.setInventoryOpen(false),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inventoryPanel?.destroy();
    });

    this.chestPrompt = this.add
      .text(0, 0, 'E 開啟', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#fff8d0',
        backgroundColor: '#000000aa',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);

    this.muteHud = this.add
      .text(6, 52, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#aaaacc',
        backgroundColor: '#00000099',
        padding: { x: 3, y: 1 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshMuteHud();

    // Fixed HUD + touch stay on uiCam (zoom 1); main may cover-zoom the world.
    this.promoteUi(
      this.hpHud,
      this.skillHud,
      this.roomHud,
      this.goldHud,
      this.muteHud,
      this.vignetteGfx,
      ...this.touch.uiObjects(),
      ...this.runInfo.uiObjects(),
    );

    this.showStageNameplate();
    // Unlock / resume after the first gesture (browser autoplay policy).
    // Pointer covers taps; keyboard is optional and skipped when the plugin is absent.
    this.input.once('pointerdown', () => this.audio.ensurePlaying());
    this.input.keyboard?.once('keydown', () => this.audio.ensurePlaying());
    this.input.keyboard?.on('keydown-M', () => {
      this.audio.toggleMute();
      this.refreshMuteHud();
    });

    // Hero is known and gold / gear are loaded — keep a refresh from dropping them.
    this.persistSave();
  }

  /** Restore gold and gear. Corrupt or missing saves stay at the fresh defaults. */
  private loadPersistedState(): void {
    try {
      const saved = SaveManager.load();
      if (!saved) return;
      this.gold = saved.gold;
      this.inventory = Inventory.fromJSON({
        bag: saved.bag,
        equipped: saved.equipped,
      });
      const current = this.registry.get(SELECTED_HERO_KEY);
      if (!SaveManager.isHeroId(current)) {
        this.registry.set(SELECTED_HERO_KEY, saved.heroId);
      }
    } catch (err) {
      console.warn('[SS2] loadPersistedState skipped', err);
      this.gold = 0;
      this.inventory = new Inventory();
    }
  }

  /** Re-apply equipped mods after the player exists (max HP / speed / damage). */
  private applyLoadedGear(): void {
    const hasGear =
      this.inventory.getEquipped('weapon') ||
      this.inventory.getEquipped('armor') ||
      this.inventory.getEquipped('accessory');
    if (!hasGear) return;
    this.player.applyGearMods(this.inventory.getMods());
  }

  /** Gold and gear only. Must not restart the scene or rebuild the dungeon. */
  private persistSave(): void {
    try {
      const current = this.registry.get(SELECTED_HERO_KEY);
      const heroId = SaveManager.isHeroId(current) ? current : 'eric';
      const snap = this.inventory.toJSON();
      const existing = SaveManager.load();
      SaveManager.save(
        SaveManager.mergeProfile(existing, {
          heroId,
          gold: this.gold,
          bag: snap.bag,
          equipped: snap.equipped,
          unlockedStages: SaveManager.getUnlockedStages(existing),
        }),
      );
    } catch (err) {
      console.warn('[SS2] persistSave skipped', err);
    }
  }

  private refreshMuteHud(): void {
    const muted = this.audio?.isMuted() ?? false;
    const seed = this.runSeed ? ` · #${this.runSeed}` : '';
    this.muteHud?.setText(muted ? `靜音 (M)${seed}` : `音效開 (M)${seed}`);
    this.muteHud?.setColor(muted ? '#ff8888' : '#aaaacc');
  }

  update(_time: number, delta: number): void {
    try {
      this.inputState.update(this.touch.poll());
      this.refreshSkillHud();

      // R / touch R restarts, including during GAME OVER — but never while
      // the bag is open. Equipping used to fall through the old pass-through
      // overlay onto the R button and reload the stage.
      if (!this.inventoryOpen && this.inputState.restartPressed) {
        this.restartRun();
        return;
      }
      if (this.inputState.menuPressed) {
        if (this.inventoryOpen) {
          this.setInventoryOpen(false);
          return;
        }
        this.backToSelect();
        return;
      }

      if (
        this.inputState.inventoryPressed &&
        !this.gameOver &&
        !this.stageClearVisible &&
        !this.transitioning
      ) {
        this.setInventoryOpen(!this.inventoryOpen);
      }

      if (this.exitSuppress && this.player && this.spawns?.exit) {
        const far = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          this.spawns.exit.x,
          this.spawns.exit.y,
        );
        if (far > 48) this.exitSuppress = false;
      }

      // Soft-pause combat while the inventory panel is open (mobile-friendly).
      if (
        !this.gameOver &&
        !this.transitioning &&
        !this.stageClearVisible &&
        !this.inventoryOpen
      ) {
        this.updateChestInteract();
        this.player.handleInput(this.inputState, delta);
        if (!this.player.isDead()) this.maintainRoomConstraint();
      } else if (this.inventoryOpen && this.player && !this.player.isDead()) {
        this.player.setVelocity(0, 0);
      }
      if (!this.gameOver) this.maybeRoomClear();
    } catch (err) {
      console.error('[SS2] GameScene.update error', err);
    }
  }

  private restartRun(): void {
    this.nuclearLeave('restart');
  }

  private backToSelect(): void {
    this.nuclearLeave('select');
  }

  private backToVillage(): void {
    this.nuclearLeave('village');
  }

  /**
   * Leave GAME OVER via DOM / capture-key / update().
   * Browser setTimeout (not Phaser clocks). Select uses stop+start.
   * Restart: restart() then verify; if still inactive, stop + delayed start.
   */
  private nuclearLeave(mode: 'restart' | 'select' | 'village'): void {
    if (this.leaving) return;
    this.leaving = true;
    this.stageClearVisible = false;
    this.exitSuppress = false;
    this.inventoryOpen = false;
    try {
      this.inventoryPanel?.close();
    } catch {
      /* ignore */
    }
    hideGameOverDom();
    hideStageClearDom();
    this.teardownGameOverInput();

    const game = this.game;
    const hero = this.registry.get(SELECTED_HERO_KEY);
    const stage = this.registry.get(SELECTED_STAGE_KEY) ?? this.runStage;

    try {
      this.physics.world.resume();
    } catch {
      /* ignore */
    }

    setTimeout(() => {
      if (hero !== undefined) game.registry.set(SELECTED_HERO_KEY, hero);
      if (stage !== undefined) game.registry.set(SELECTED_STAGE_KEY, stage);

      if (mode === 'select' || mode === 'village') {
        try {
          game.scene.stop('GameScene');
        } catch {
          /* ignore */
        }
        game.scene.start(mode === 'village' ? 'VillageScene' : 'SelectScene');
        return;
      }

      // Restart path
      try {
        const sc = game.scene.getScene('GameScene') as Phaser.Scene | undefined;
        if (sc?.sys?.isActive()) {
          sc.scene.restart();
        } else {
          game.scene.start('GameScene');
        }
      } catch (err) {
        console.error('[SS2] restart attempt failed', err);
        try {
          game.scene.start('GameScene');
        } catch (err2) {
          console.error('[SS2] start GameScene failed', err2);
        }
      }

      // Verify — recover if left inactive/visible-only (status CREATING/SHUTDOWN).
      setTimeout(() => {
        if (game.scene.isActive('GameScene')) return;
        console.warn('[SS2] GameScene inactive after restart — force stop/start');
        try {
          game.scene.stop('GameScene');
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            if (hero !== undefined) game.registry.set(SELECTED_HERO_KEY, hero);
            if (stage !== undefined) game.registry.set(SELECTED_STAGE_KEY, stage);
            game.scene.start('GameScene');
          } catch (err) {
            console.error('[SS2] force start failed', err);
          }
        }, 50);
      }, 120);
    }, 0);
  }

  private teardownGameOverInput(): void {
    hideGameOverDom();
    hideStageClearDom();
  }

  private spawnPaste(
    x: number,
    y: number,
    hp: number,
    room: RoomId,
    walls: Phaser.Tilemaps.TilemapLayer,
  ): void {
    const enemy = new Enemy(this, x, y, hp);
    enemy.spawnRoom = room;
    enemy.setTarget(this.player);
    enemy.setPathfinder(this.pathfinder);
    enemy.setOnLootDrop((dx, dy) => this.tryEnemyDrop(dx, dy, 0.28));
    enemy.setRoomPresent(room === this.currentRoom);
    this.enemies.add(enemy);
    this.hostiles.add(enemy);
    this.physics.add.collider(enemy, walls);
  }

  private placeChest(x: number, y: number): void {
    this.chestPos = { x, y };
    this.chestGfx = this.add.graphics().setDepth(5);
    this.chestLabel = this.add
      .text(x, y - 18, '寶箱', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffe8b0',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.drawChest(false);
  }

  private drawChest(opened: boolean): void {
    const pos = this.chestPos;
    const g = this.chestGfx;
    if (!pos || !g) return;
    const { x, y } = pos;
    g.clear();
    if (!opened) {
      // Closed chest
      g.fillStyle(0x8a5a28, 1);
      g.fillRect(x - 8, y - 6, 16, 12);
      g.fillStyle(0xc4a050, 1);
      g.fillRect(x - 8, y - 8, 16, 4);
      g.lineStyle(1, 0x3a2810, 1);
      g.strokeRect(x - 8, y - 8, 16, 14);
      g.fillStyle(0xffe066, 1);
      g.fillCircle(x, y - 1, 1.5);
    } else {
      // Open: lid tipped back, darker empty body
      g.fillStyle(0x6a4020, 1);
      g.fillRect(x - 8, y - 4, 16, 10);
      g.fillStyle(0xa87830, 1);
      // lid open (angled bar behind)
      g.fillRect(x - 9, y - 14, 18, 5);
      g.lineStyle(1, 0x3a2810, 1);
      g.strokeRect(x - 8, y - 4, 16, 10);
      g.strokeRect(x - 9, y - 14, 18, 5);
      g.fillStyle(0x1a1008, 1);
      g.fillRect(x - 5, y - 2, 10, 5);
    }
    if (this.chestLabel) {
      this.chestLabel.setText(opened ? '已開啟' : '寶箱');
      this.chestLabel.setColor(opened ? '#a0a0a0' : '#ffe8b0');
    }
  }

  private nearChest(): boolean {
    if (!this.chestPos || this.player.isDead()) return false;
    // Generous reach — body offset + slime body-block made 36px unreliable.
    return Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.chestPos.x,
      this.chestPos.y,
    ) <= 64;
  }

  private updateChestInteract(): void {
    const near = this.nearChest();
    if (this.chestPrompt) {
      if (near && !this.chestOpened && this.chestPos) {
        this.chestPrompt.setVisible(true);
        this.chestPrompt.setPosition(this.chestPos.x, this.chestPos.y - 28);
      } else {
        this.chestPrompt.setVisible(false);
      }
    }
    if (!near || this.chestOpened) return;

    if (this.inputState.interactPressed) {
      if (this.inputState.spacePressed) this.player.suppressNextAttack();
      this.openChest();
    }
  }

  private openChest(): void {
    if (this.chestOpened || !this.chestPos) return;
    this.chestOpened = true;
    this.drawChest(true);
    if (this.chestPrompt) this.chestPrompt.setVisible(false);
    this.audio.chest();
    this.audio.pickup();

    const healed = this.player.heal(2);
    const goldGain = 25;
    this.gold += goldGain;
    this.refreshGoldHud();
    this.persistSave();

    const item = rollItem(Math.random, {
      preferWeapon: true,
      allowedWeaponTypes: this.player.playerData.weapons.allowedTypes,
      betterRarity: true,
    });
    this.giveItem(item);

    const parts: string[] = [];
    if (healed > 0) parts.push(`+${healed} 生命`);
    else parts.push('生命已滿');
    parts.push(`+${goldGain} 金幣`);
    parts.push(formatItemToast(item));
    this.showLootToast(parts.filter(Boolean).join(' · '), RARITY_COLOR[item.rarity]);
  }

  private tryEnemyDrop(x: number, y: number, chance: number): void {
    if (this.gameOver || Math.random() > chance) return;
    this.audio.pickup();
    const item = rollItem(Math.random, {
      allowedWeaponTypes: this.player.playerData.weapons.allowedTypes,
    });
    this.giveItem(item);
    this.showLootToast(formatItemToast(item), RARITY_COLOR[item.rarity]);
    // Brief spark at death position
    const spark = this.add.circle(x, y - 8, 4, 0xffe066, 0.9).setDepth(30);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      y: y - 24,
      duration: 500,
      onComplete: () => spark.destroy(),
    });
  }

  private giveItem(item: ReturnType<typeof rollItem>): void {
    this.inventory.add(item);
    this.player.applyGearMods(this.inventory.getMods());
    this.persistSave();
    this.refreshInvHud();
  }

  /** Gear summary only. Does not reload the stage. */
  private refreshInvHud(): void {
    this.runInfo?.syncGear(this.inventory);
  }

  private refreshRunInfo(): void {
    const hud = this.runInfo;
    if (!hud || !this.rooms) return;
    hud.syncMap({
      rooms: this.rooms,
      current: this.currentRoom,
      explored: this.exploredRooms,
      cleared: this.clearedRooms,
      bossDown: this.bossDefeated,
      cold: this.runStage === 2,
    });
    hud.syncGear(this.inventory);
  }

  private setInventoryOpen(open: boolean): void {
    if (open === this.inventoryOpen) {
      if (open) this.inventoryPanel?.refresh(this.inventory);
      return;
    }
    this.inventoryOpen = open;
    if (open) {
      this.player?.setVelocity(0, 0);
      this.player?.suppressNextAttack();
      try {
        this.physics.world.pause();
      } catch {
        /* ignore */
      }
      this.inventoryPanel.open(this.inventory);
    } else {
      this.inventoryPanel.close();
      this.refreshInvHud();
      // Do not resume if GAME OVER / stage clear already owns the pause.
      if (!this.gameOver && !this.stageClearVisible) {
        try {
          this.physics.world.resume();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Bag → slot, reapply mods, save, refresh. Never restarts the scene. */
  private equipBagItem(uid: string): void {
    const before = this.inventory.getBag().find((it) => it.uid === uid);
    if (!this.inventory.equipFromBag(uid)) return;
    this.player.applyGearMods(this.inventory.getMods());
    this.persistSave();
    this.refreshInvHud();
    this.inventoryPanel.refresh(this.inventory);
    if (before) {
      this.showLootToast(
        `裝備 ${rarityTagZh(before.rarity)}${before.nameZh}`,
        RARITY_COLOR[before.rarity],
      );
    }
  }

  /** Slot → bag, reapply mods, save, refresh. Never restarts the scene. */
  private unequipSlot(slot: EquipSlot): void {
    const prev = this.inventory.getEquipped(slot);
    if (!this.inventory.unequip(slot)) return;
    this.player.applyGearMods(this.inventory.getMods());
    this.persistSave();
    this.refreshInvHud();
    this.inventoryPanel.refresh(this.inventory);
    if (prev) {
      this.showLootToast(
        `卸下 ${rarityTagZh(prev.rarity)}${prev.nameZh}`,
        RARITY_COLOR[prev.rarity],
      );
    }
  }

  private refreshGoldHud(): void {
    const hero = this.player?.hero.label ?? '';
    this.goldHud?.setText(hero ? `金幣 ${this.gold} · ${hero}` : `金幣 ${this.gold}`);
  }

  private showLootToast(msg: string, color?: string): void {
    // DOM toast at bottom-center — clears top hint HUD and inventory overlay.
    showLootToastDom(msg, color ? { color } : undefined);
  }

  private setupDoors(): void {
    const pad = DOOR_TRIGGER_GROW / 2;
    for (const d of this.spawns.doors) {
      d.x -= pad;
      d.y -= pad;
      d.w += DOOR_TRIGGER_GROW;
      d.h += DOOR_TRIGGER_GROW;

      const zone = this.add.zone(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h);
      this.physics.add.existing(zone, true);
      const body = zone.body as Phaser.Physics.Arcade.StaticBody;
      // Zone static bodies stay at a default size unless sized and refreshed.
      body.setSize(d.w, d.h);
      body.updateFromGameObject();
      this.physics.add.overlap(this.player, zone, () => {
        this.tryUseDoor(d.target, d.room);
      });
    }
  }

  private tryUseDoor(targetSpawn: string, destRoom: RoomId): void {
    if (this.transitioning || this.gameOver || this.stageClearVisible || this.player.isDead()) return;
    if (this.currentRoom === destRoom) return;

    const dest = this.spawns.points[targetSpawn];
    if (!dest) return;

    this.transitioning = true;
    this.player.setVelocity(0, 0);
    this.audio.door();

    const cam = this.cameras.main;
    cam.fadeOut(180, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      this.player.setPosition(dest.x, dest.y);
      this.applyRoomCamera(destRoom);
      this.refreshRoomHud();
      cam.fadeIn(180, 0, 0, 0);
      cam.once('camerafadeincomplete', () => {
        this.transitioning = false;
      });
    });
  }

  private applyRoomCamera(room: RoomId): void {
    this.currentRoom = room;
    this.exploredRooms.add(room);
    const r = this.rooms[room];
    const cam = this.cameras.main;
    cam.setRoundPixels(false);
    cam.setZoom(this.roomCoverZoom(r.w, r.h));
    cam.setBounds(r.x, r.y, r.w, r.h);
    this.syncHostileRooms();
    this.syncRoomBgm();
    this.refreshRunInfo();
  }

  /**
   * Prefer CAMERA_ZOOM, but never less than the zoom that covers the room
   * with the live canvas — stops black void on tall portrait EXPAND sizes.
   */
  private roomCoverZoom(roomW: number, roomH: number): number {
    const viewW = Math.max(1, this.scale.width);
    const viewH = Math.max(1, this.scale.height);
    const cover = Math.max(viewW / roomW, viewH / roomH);
    return Math.max(CAMERA_ZOOM, cover);
  }

  /** Stage bed, or the boss loop once Gully's room is the one on screen. */
  private syncRoomBgm(): void {
    if (!this.audio) return;
    const bossHere = this.currentRoom === 'boss' && !!this.boss && !this.bossDefeated;
    const bed = getStage(this.runStage).bgm;
    this.audio.startBgm(bossHere ? 'boss' : bed);
  }

  /** Warm fort vs cold corridor: tint, fog, and the camera clear color. */
  private applyStageLook(
    ground: Phaser.Tilemaps.TilemapLayer,
    walls: Phaser.Tilemaps.TilemapLayer,
    worldW: number,
    worldH: number,
  ): void {
    const theme = getStage(this.runStage).visual;
    this.cameras.main.setBackgroundColor(theme.bgColor);
    ground.setTint(theme.groundTint);
    walls.setTint(theme.wallTint);
    const fog = this.add.rectangle(
      worldW / 2,
      worldH / 2,
      worldW,
      worldH,
      theme.fogColor,
      theme.fogAlpha,
    );
    fog.setDepth(2);
    fog.setScrollFactor(1);
  }

  /**
   * Main camera cover-zooms the room so EXPAND portrait never shows void.
   * A second camera at zoom 1 owns scrollFactor-0 HUD / touch so they stay on-screen.
   */
  private bootstrapUiCamera(): void {
    this.uiObjects.clear();
    this.ensureUiCamera();
    // DisplayList emits ADDED_TO_SCENE (not scene.sys.events).
    this.children.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAddedToScene, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.children.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAddedToScene, this);
    });
  }

  private ensureUiCamera(): void {
    const w = Math.max(1, this.scale.width);
    const h = Math.max(1, this.scale.height);
    const alive = !!this.uiCam && this.cameras.cameras.includes(this.uiCam);
    if (!alive) {
      this.uiCam = this.cameras.add(0, 0, w, h);
      this.uiCam.setName('ui');
    } else {
      this.uiCam.setSize(w, h);
    }
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);
    this.uiCam.roundPixels = false;
  }

  private onAddedToScene(go: Phaser.GameObjects.GameObject): void {
    if (!this.uiCam || this.uiObjects.has(go)) return;
    this.uiCam.ignore(go);
  }

  /**
   * Route objects to the unzoomed UI camera only.
   * Phaser Camera.id is already a bitmask (1, 2, 4, …) — never `1 << id`.
   */
  private promoteUi(
    ...objs: Array<Phaser.GameObjects.GameObject | undefined | null>
  ): void {
    if (!this.uiCam) return;
    const mainBit = this.cameras.main.id;
    const uiBit = this.uiCam.id;
    for (const o of objs) {
      if (!o) continue;
      this.uiObjects.add(o);
      // Ignore on world cam; clear any earlier uiCam.ignore from onAddedToScene.
      o.cameraFilter = (o.cameraFilter | mainBit) & ~uiBit;
    }
  }

  /** Screen-fixed frame so a room does not read as a bare rectangle in the void. */
  private addCameraVignette(): void {
    this.vignetteGfx = this.add.graphics().setScrollFactor(0).setDepth(50);
    this.redrawVignette();
  }

  private redrawVignette(): void {
    const g = this.vignetteGfx;
    if (!g?.active) return;
    const w = this.scale.width;
    const h = this.scale.height;
    g.clear();
    const bands = 6;
    const step = 5;
    for (let i = 0; i < bands; i++) {
      const alpha = 0.18 * (1 - i / bands);
      g.fillStyle(0x000000, alpha);
      const t = i * step;
      g.fillRect(0, t, w, step);
      g.fillRect(0, h - t - step, w, step);
      g.fillRect(t, 0, step, h);
      g.fillRect(w - t - step, 0, step, h);
    }
  }

  /**
   * Floor depth pass after the tile layers exist: skirting, wall shadows,
   * a sparse pattern, and corner props. Collision and doors stay on the tilemap.
   */
  private decorateRooms(): void {
    const theme = DECOR_THEME[this.runStage];
    const floor = this.add.graphics().setDepth(0.6);
    const props = this.add.graphics().setDepth(1.4);
    const sides = this.roomDoorSides();
    for (const id of ROOM_ORDER) {
      const rng = mulberry32((this.runSeed ^ decorSalt(id)) >>> 0);
      paintRoomDecor(floor, props, id, this.rooms[id], theme, sides[id], rng);
    }
  }

  /** Which walls of each room are a doorway, so skirting does not seal the opening. */
  private roomDoorSides(): Record<RoomId, DoorSides> {
    const out = {} as Record<RoomId, DoorSides>;
    for (const id of ROOM_ORDER) out[id] = { n: false, e: false, s: false, w: false };
    for (let i = 0; i < ROOM_ORDER.length; i++) {
      for (let j = i + 1; j < ROOM_ORDER.length; j++) {
        const a = ROOM_ORDER[i]!;
        const b = ROOM_ORDER[j]!;
        const ra = this.rooms[a];
        const rb = this.rooms[b];
        const dx = rb.x - ra.x;
        const dy = rb.y - ra.y;
        if (dy === 0 && dx === ra.w) {
          out[a].e = true;
          out[b].w = true;
        } else if (dy === 0 && dx === -ra.w) {
          out[a].w = true;
          out[b].e = true;
        } else if (dx === 0 && dy === ra.h) {
          out[a].s = true;
          out[b].n = true;
        } else if (dx === 0 && dy === -ra.h) {
          out[a].n = true;
          out[b].s = true;
        }
      }
    }
    return out;
  }

  /** Large stage name, then fade. Not interactive, so movement is never blocked. */
  private showStageNameplate(): void {
    const stage = getStage(this.runStage);
    const { width, height } = this.scale;
    const plate = this.add
      .text(width / 2, height * 0.4, stage.nameZh, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: stage.visual.nameplateColor,
        stroke: '#000000',
        strokeThickness: 6,
        backgroundColor: '#00000099',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(90);
    this.promoteUi(plate);
    this.tweens.add({
      targets: plate,
      alpha: 0,
      delay: 1600,
      duration: 450,
      onComplete: () => plate.destroy(),
    });
  }

  /** Resolve sting the frame the last Paste in the current room starts dying. */
  private maybeRoomClear(): void {
    const room = this.currentRoom;
    if (room === 'boss' || this.clearedRooms.has(room) || !this.enemies) return;
    let any = false;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (enemy.spawnRoom !== room) continue;
      any = true;
      if (!enemy.isDead()) return;
    }
    if (!any) return;
    this.clearedRooms.add(room);
    this.audio?.roomClear();
    this.refreshRunInfo();
  }

  /** Park Pastes and the boss unless their spawn room is on screen. */
  private syncHostileRooms(): void {
    if (!this.hostiles) return;
    const room = this.currentRoom;
    for (const child of this.hostiles.getChildren()) {
      const hostile = child as Enemy | Boss;
      if (!hostile.scene) continue;
      hostile.setRoomPresent(hostile.spawnRoom === room);
    }
  }

  /**
   * Backup door test plus a soft clamp so the full-map physics world cannot
   * carry the player into the next room without a teleport.
   */
  private maintainRoomConstraint(): void {
    if (this.transitioning || this.gameOver || this.stageClearVisible || this.player.isDead()) return;
    if (this.tryDoorsByPosition()) return;
    this.clampPlayerToRoom();
    if (!this.transitioning) this.tryDoorsByPosition();
  }

  /** Sprite position after this frame's physics step (postUpdate has not run yet). */
  private resolvedPlayerPoint(): { x: number; y: number } {
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return { x: this.player.x, y: this.player.y };
    return {
      x: this.player.x + (body.position.x - body.prevFrame.x),
      y: this.player.y + (body.position.y - body.prevFrame.y),
    };
  }

  private playerInDoor(d: DoorSpawn): boolean {
    const p = this.resolvedPlayerPoint();
    if (p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h) return true;
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return false;
    return (
      body.right >= d.x &&
      body.left <= d.x + d.w &&
      body.bottom >= d.y &&
      body.top <= d.y + d.h
    );
  }

  private playerOverlapsExitDoor(): boolean {
    for (const d of this.spawns.doors) {
      if (d.room === this.currentRoom) continue;
      if (this.playerInDoor(d)) return true;
    }
    return false;
  }

  /** Point-in-door backup for the physics overlap, which misses some zone bodies. */
  private tryDoorsByPosition(): boolean {
    if (this.transitioning || this.gameOver || this.stageClearVisible || this.player.isDead()) return false;
    for (const d of this.spawns.doors) {
      if (this.currentRoom === d.room) continue;
      if (!this.playerInDoor(d)) continue;
      this.tryUseDoor(d.target, d.room);
      if (this.transitioning) return true;
    }
    return false;
  }

  private clampPlayerToRoom(): void {
    if (this.transitioning || this.playerOverlapsExitDoor()) return;
    const r = this.rooms[this.currentRoom];
    if (!r) return;

    const minX = r.x + ROOM_CLAMP_INSET;
    const maxX = r.x + r.w - ROOM_CLAMP_INSET;
    const minY = r.y + ROOM_CLAMP_INSET;
    const maxY = r.y + r.h - ROOM_CLAMP_INSET;
    const p = this.resolvedPlayerPoint();
    const x = Phaser.Math.Clamp(p.x, minX, maxX);
    const y = Phaser.Math.Clamp(p.y, minY, maxY);
    if (x === p.x && y === p.y) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (p.x < minX && body.velocity.x < 0) body.velocity.x = 0;
    else if (p.x > maxX && body.velocity.x > 0) body.velocity.x = 0;
    if (p.y < minY && body.velocity.y < 0) body.velocity.y = 0;
    else if (p.y > maxY && body.velocity.y > 0) body.velocity.y = 0;
    this.player.setPosition(x, y);
    body.updateFromGameObject();
    // postUpdate adds (position - prevFrame) back onto the sprite.
    body.prevFrame.set(body.position.x, body.position.y);
    body.prev.set(body.position.x, body.position.y);
  }

  private refreshSkillHud(): void {
    const hud = this.skillHud;
    if (!hud?.active || !this.player?.active) return;
    const skill = this.player.getActiveSkill();
    const rem = this.player.getSkillCooldownRemainingMs();
    const status = rem <= 0 ? '就緒' : `${(Math.ceil(rem / 100) / 10).toFixed(1)}s`;
    const text = `技 ${skill.labelZh} [Q] ${status}`;
    if (hud.text !== text) hud.setText(text);
    hud.setTint(rem <= 0 ? 0xffe8a0 : 0xa8b0c4);
  }

  private refreshHpHud(hp: number, max: number): void {
    const hud = this.hpHud;
    if (!hud || !hud.active || !hud.scene) return;
    try {
      hud.setText(`生命 ${hp}/${max}`);
      // Avoid setColor during fragile WebGL/text-canvas frames — use tint instead.
      hud.setTint(hp <= 1 ? 0xff6666 : hp <= 2 ? 0xffcc66 : 0xffd0d0);
    } catch (err) {
      console.warn('[SS2] refreshHpHud skipped', err);
    }
  }

  private refreshRoomHud(): void {
    const stageName = getStage(this.runStage).shortName;
    const roomName = ROOM_LABELS[this.runStage][this.currentRoom] ?? this.currentRoom;
    let label = `${stageName} · ${roomName}`;
    if (this.currentRoom === 'boss' && this.bossDefeated) label += ' · 出口已開';
    this.roomHud?.setText(label);
  }

  private showBossVictory(): void {
    if (this.bossDefeated || this.gameOver) return;
    this.bossDefeated = true;
    this.audio.bossDefeat();
    this.activateExit();
    this.refreshRoomHud();
    this.refreshRunInfo();
    this.showLootToast('蓋利隊長已擊破 · 出口已開啟');
  }

  /** Glowing exit. Overlap (only after the boss falls) opens the stage-clear panel. */
  private activateExit(): void {
    const pos = this.spawns.exit;
    if (!pos || this.exitActive) return;
    this.exitActive = true;

    const glow = this.add.circle(pos.x, pos.y, 12, 0x3ee0ff, 0.7).setDepth(4);
    const ring = this.add.circle(pos.x, pos.y, 16, 0x000000, 0).setDepth(4);
    ring.setStrokeStyle(2, 0xd8ffff, 0.95);
    this.tweens.add({
      targets: glow,
      scale: 1.45,
      alpha: 0.2,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(pos.x, pos.y - 22, '出口', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d8ffff',
        stroke: '#001018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(12);

    const zone = this.add.zone(pos.x, pos.y, 40, 40);
    this.physics.add.existing(zone, true);
    this.physics.add.overlap(this.player, zone, () => this.tryStageClear());
  }

  private tryStageClear(): void {
    if (!this.exitActive || this.exitSuppress || this.stageClearVisible) return;
    if (!this.bossDefeated || this.gameOver || this.transitioning || this.leaving) return;
    if (this.player.isDead()) return;
    this.showStageClear();
  }

  private showStageClear(): void {
    if (this.stageClearVisible || this.gameOver || this.leaving) return;
    this.setInventoryOpen(false);
    this.stageClearVisible = true;
    this.player.setVelocity(0, 0);
    try {
      this.physics.world.pause();
    } catch {
      /* ignore */
    }

    // Unlock the next stage immediately and persist before the panel shows.
    const nxt = nextStageId(this.runStage);
    if (nxt !== null) {
      this.unlockAndPersist(nxt);
    }
    // Stage 1 clear → quest flag for village turn-in.
    if (this.runStage === 1) {
      this.markGoblinCleared();
    }

    const actions: Parameters<typeof showStageClearDom>[0] = {
      restart: () => this.restartRun(),
      select: () => this.backToSelect(),
      continue: () => this.dismissStageClear(),
      returnVillage: () => this.backToVillage(),
    };
    if (nxt !== null) {
      const nextName = getStage(nxt).nameZh;
      actions.nextStage = () => this.goNextStage(nxt);
      actions.nextStageLabel = `下一關 · ${nextName}`;
    }
    showStageClearDom(actions);
  }

  /** Merge unlock into the current profile and write localStorage now. */
  private unlockAndPersist(stageId: StageId): void {
    try {
      const current = this.registry.get(SELECTED_HERO_KEY);
      const heroId = SaveManager.isHeroId(current) ? current : 'eric';
      const snap = this.inventory.toJSON();
      const existing = SaveManager.load();
      const base = SaveManager.mergeProfile(existing, {
        heroId,
        gold: this.gold,
        bag: snap.bag,
        equipped: snap.equipped,
        unlockedStages: SaveManager.getUnlockedStages(existing),
      });
      SaveManager.save(SaveManager.unlockStage(base, stageId));
    } catch (err) {
      console.warn('[SS2] unlockAndPersist skipped', err);
    }
  }

  /** Persist goblin fort clear for village King turn-in dialogue. */
  private markGoblinCleared(): void {
    try {
      const current = this.registry.get(SELECTED_HERO_KEY);
      const heroId = SaveManager.isHeroId(current) ? current : 'eric';
      const snap = this.inventory.toJSON();
      const existing = SaveManager.load();
      SaveManager.save(
        SaveManager.mergeProfile(existing, {
          heroId,
          gold: this.gold,
          bag: snap.bag,
          equipped: snap.equipped,
          unlockedStages: SaveManager.getUnlockedStages(existing),
          goblinCleared: true,
          villageVisited: true,
          seenIntro: true,
        }),
      );
    } catch (err) {
      console.warn('[SS2] markGoblinCleared skipped', err);
    }
  }

  /** 下一關 — keep hero/gold/gear, jump to the unlocked stage. */
  private goNextStage(stageId: StageId): void {
    this.registry.set(SELECTED_STAGE_KEY, stageId);
    this.restartRun();
  }

  /** 繼續 — close the panel and let the player walk the cleared stage. */
  private dismissStageClear(): void {
    if (this.leaving) return;
    hideStageClearDom();
    this.stageClearVisible = false;
    this.exitSuppress = true;
    try {
      this.physics.world.resume();
    } catch {
      /* ignore */
    }
  }

  private showGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.leaving = false;
    this.setInventoryOpen(false);
    // Death in Entry must not leave Captain Gully's sprite or HP plate on screen.
    this.syncHostileRooms();
    this.stageClearVisible = false;
    hideStageClearDom();

    // Freeze world so a wedged update loop is less likely; input is DOM-only now.
    try {
      this.physics.world.pause();
    } catch {
      /* ignore */
    }

    // DOM overlay is the only reliable input surface (outside Phaser lifecycle).
    showGameOverDom({
      restart: () => this.restartRun(),
      select: () => this.backToSelect(),
    });
  }

  private propBag(
    o: Phaser.Types.Tilemaps.TiledObject,
  ): { name: string; value: unknown }[] {
    const props = o.properties as { name: string; value: unknown }[] | Record<string, unknown> | undefined;
    if (Array.isArray(props)) return props;
    if (props && typeof props === 'object') {
      return Object.entries(props).map(([name, value]) => ({ name, value }));
    }
    return [];
  }

  private propString(
    o: Phaser.Types.Tilemaps.TiledObject,
    key: string,
  ): string | undefined {
    const p = this.propBag(o).find((x) => x.name === key);
    return p ? String(p.value) : undefined;
  }

  private propNumber(
    o: Phaser.Types.Tilemaps.TiledObject,
    key: string,
  ): number | undefined {
    const p = this.propBag(o).find((x) => x.name === key);
    if (!p) return undefined;
    const n = Number(p.value);
    return Number.isFinite(n) ? n : undefined;
  }

  private mapPropList(map: Phaser.Tilemaps.Tilemap): { name: string; value: unknown }[] {
    const props = map.properties as { name: string; value: unknown }[] | Record<string, unknown> | undefined;
    if (Array.isArray(props)) return props;
    if (props && typeof props === 'object') {
      return Object.entries(props).map(([name, value]) => ({ name, value }));
    }
    return [];
  }

  /** Room rects from map properties (roomA / roomC / roomB / roomBoss = "x,y,w,h"). */
  private readRooms(map: Phaser.Tilemaps.Tilemap): Record<RoomId, Rect> {
    const found: Partial<Record<RoomId, Rect>> = {};
    const keyFor: Record<string, RoomId> = {
      roomA: 'a',
      roomC: 'c',
      roomB: 'b',
      roomBoss: 'boss',
    };
    for (const p of this.mapPropList(map)) {
      const id = keyFor[p.name];
      if (!id) continue;
      const rect = this.parseRect(String(p.value));
      if (rect) found[id] = rect;
    }
    const rooms = {} as Record<RoomId, Rect>;
    for (const id of ROOM_ORDER) {
      const rect = found[id];
      if (!rect) throw new Error(`Dungeon map is missing room rect ${id}`);
      rooms[id] = rect;
    }
    return rooms;
  }

  private parseRect(raw: string): Rect | null {
    const parts = raw.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [x, y, w, h] = parts;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  private roomAt(x: number, y: number): RoomId | null {
    for (const id of ROOM_ORDER) {
      const r = this.rooms[id];
      if (!r) continue;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
    }
    return null;
  }

  private enemyRoom(o: Phaser.Types.Tilemaps.TiledObject, at: SpawnPoint): RoomId {
    const tagged = this.propString(o, 'room');
    if (isRoomId(tagged)) return tagged;
    const name = o.name ?? '';
    if (name.startsWith('enemy_boss') || name.includes('_boss')) return 'boss';
    if (name.startsWith('enemy_b')) return 'b';
    if (name.startsWith('enemy_c')) return 'c';
    if (name.startsWith('enemy_a')) return 'a';
    return this.roomAt(at.x, at.y) ?? 'a';
  }

  /**
   * Spawns and doors come only from the generated object layer.
   * Fixed tile coordinates would drop the player into the wrong room
   * once the layout is no longer the old A|C|Boss row.
   */
  private readSpawns(map: Phaser.Tilemaps.Tilemap): GameScene['spawns'] {
    const layer = map.getObjectLayer('spawns');
    if (!layer) throw new Error('Dungeon map is missing the spawns layer');

    const center = (o: Phaser.Types.Tilemaps.TiledObject): SpawnPoint => ({
      x: (o.x ?? 0) + (o.width ?? 0) / 2,
      y: (o.y ?? 0) + (o.height ?? 0) / 2,
    });

    const playerObj = layer.objects.find((o) => o.name === 'player');
    const bossObj = layer.objects.find((o) => o.type === 'boss' || o.name === 'boss');
    const chestObj = layer.objects.find((o) => o.type === 'chest' || o.name === 'chest');
    const exitObj = layer.objects.find((o) => o.type === 'exit' || o.name === 'exit');
    if (!playerObj || !bossObj || !chestObj || !exitObj) {
      throw new Error('Dungeon map is missing player, boss, chest, or exit');
    }

    const points: Record<string, SpawnPoint> = {};
    for (const o of layer.objects) {
      const name = o.name ?? '';
      const isSpawn = o.type === 'spawn' || name.startsWith('spawn_');
      if (!isSpawn || name === 'player' || !name) continue;
      points[name] = center(o);
    }

    const enemies: EnemySpawn[] = [];
    for (const o of layer.objects) {
      const isEnemy =
        o.type === 'enemy' ||
        o.type === 'dummy' ||
        (o.name?.startsWith('enemy') ?? false) ||
        (o.name?.startsWith('dummy') ?? false);
      if (!isEnemy) continue;
      const at = center(o);
      const room = this.enemyRoom(o, at);
      const hp = this.propNumber(o, 'hp') ?? PASTE_HP[room];
      enemies.push({ ...at, room, hp });
    }
    if (enemies.length === 0) throw new Error('Dungeon map has no enemies');

    const doors: DoorSpawn[] = [];
    for (const o of layer.objects) {
      if (!(o.type === 'door' || (o.name?.startsWith('door_') ?? false))) continue;
      const room = this.propString(o, 'room');
      const target = this.propString(o, 'target');
      if (!isRoomId(room) || !target || !points[target]) {
        throw new Error(`Door ${o.name ?? ''} is missing a destination`);
      }
      doors.push({
        x: o.x ?? 0,
        y: o.y ?? 0,
        w: o.width ?? 32,
        h: o.height ?? 32,
        target,
        room,
      });
    }
    if (doors.length === 0) throw new Error('Dungeon map has no doors');

    return {
      player: center(playerObj),
      points,
      enemies,
      boss: center(bossObj),
      chest: center(chestObj),
      exit: center(exitObj),
      doors,
    };
  }

  private wireHitbox(zone: Phaser.GameObjects.Zone): void {
    // Per-swing set: a new spawn (Raizen pulse, or the next slash) can hit again.
    // A bolt keeps its own set so a later swing does not re-arm it.
    const hit = new Set<Hostile>();
    this.physics.add.overlap(zone, this.hostiles, (_z, obj) => {
      const hostile = obj as Hostile;
      if (!hostile.active || hit.has(hostile)) return;
      hit.add(hostile);
      const dmg = (zone.getData('damage') as number | undefined) ?? this.player.getSlashDamage(0);
      const iframeMs = zone.getData('iframeMs') as number | undefined;
      const landed =
        typeof iframeMs === 'number'
          ? hostile.takeDamage(dmg, this.player.x, this.player.y, iframeMs)
          : hostile.takeDamage(dmg, this.player.x, this.player.y);
      if (landed) this.hitFeedback.onPlayerLandedHit();
    });
  }
}

function decorSalt(id: RoomId): number {
  if (id === 'a') return 0x41a1;
  if (id === 'c') return 0xc0c0;
  if (id === 'b') return 0xb0b1;
  return 0xb055;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gapSpans(
  start: number,
  end: number,
  gap0: number,
  gap1: number,
  open: boolean,
): Array<[number, number]> {
  if (!open || gap1 <= start || gap0 >= end) return [[start, end]];
  const a = Math.max(start, gap0);
  const b = Math.min(end, gap1);
  const out: Array<[number, number]> = [];
  if (a > start) out.push([start, a]);
  if (b < end) out.push([b, end]);
  return out;
}

function onDoorCross(lx: number, ly: number): boolean {
  const vertical = lx >= 20 && lx <= 24 && ly >= 2 && ly <= 30;
  const horizontal = ly >= 13 && ly <= 18 && lx >= 1 && lx <= 46;
  return vertical || horizontal;
}

function paintHBands(
  g: Phaser.GameObjects.Graphics,
  x0: number,
  x1: number,
  y: number,
  h: number,
  gap0: number,
  gap1: number,
  open: boolean,
): void {
  for (const [a, b] of gapSpans(x0, x1, gap0, gap1, open)) {
    if (b - a > 0) g.fillRect(a, y, b - a, h);
  }
}

function paintVBands(
  g: Phaser.GameObjects.Graphics,
  y0: number,
  y1: number,
  x: number,
  w: number,
  gap0: number,
  gap1: number,
  open: boolean,
): void {
  for (const [a, b] of gapSpans(y0, y1, gap0, gap1, open)) {
    if (b - a > 0) g.fillRect(x, a, w, b - a);
  }
}

/**
 * Inner edge, drop shadow, sparse floor marks, and corner props.
 * Props stay off the door cross so lanes MapGenerator left open stay open.
 */
function paintRoomDecor(
  floor: Phaser.GameObjects.Graphics,
  props: Phaser.GameObjects.Graphics,
  id: RoomId,
  room: Rect,
  theme: DecorTheme,
  sides: DoorSides,
  rng: () => number,
): void {
  const ix = room.x + TILE;
  const iy = room.y + TOP_WALL;
  const right = room.x + room.w - TILE;
  const bottom = room.y + room.h - TILE;
  const gapX0 = room.x + DOOR_LOCAL_X0;
  const gapX1 = room.x + DOOR_LOCAL_X1;
  const gapY0 = room.y + DOOR_LOCAL_Y0;
  const gapY1 = room.y + DOOR_LOCAL_Y1;

  const step = id === 'boss' ? 28 : 44;
  const keep = id === 'boss' ? 0.72 : 0.42;
  for (let y = iy + 22; y < bottom - 16; y += step) {
    for (let x = ix + 22; x < right - 16; x += step) {
      if (rng() > keep) continue;
      const lx = (x - room.x) / TILE;
      const ly = (y - room.y) / TILE;
      if (onDoorCross(lx, ly)) continue;
      const px = x + Math.floor(rng() * 7) - 3;
      const py = y + Math.floor(rng() * 7) - 3;
      const kind = rng();
      if (kind < 0.34) {
        floor.lineStyle(1, theme.patternAlt, 0.22);
        floor.lineBetween(px, py - 3, px + 3, py);
        floor.lineBetween(px + 3, py, px, py + 3);
        floor.lineBetween(px, py + 3, px - 3, py);
        floor.lineBetween(px - 3, py, px, py - 3);
      } else if (kind < 0.67) {
        floor.lineStyle(1, theme.pattern, 0.35);
        floor.lineBetween(px, py, px + 6, py + 2);
        floor.lineBetween(px + 6, py + 2, px + 3, py + 6);
      } else {
        floor.fillStyle(theme.patternAlt, 0.2);
        floor.fillRect(px, py, 2, 2);
        floor.fillStyle(theme.pattern, 0.28);
        floor.fillRect(px + 4, py + 1, 1, 1);
        floor.fillRect(px + 1, py + 4, 1, 1);
      }
    }
  }

  floor.fillStyle(theme.shadow, 0.32);
  paintHBands(floor, ix, right, iy, 8, gapX0, gapX1, sides.n);
  paintHBands(floor, ix, right, bottom - 7, 7, gapX0, gapX1, sides.s);
  paintVBands(floor, iy, bottom, ix, 7, gapY0, gapY1, sides.w);
  paintVBands(floor, iy, bottom, right - 7, 7, gapY0, gapY1, sides.e);

  floor.fillStyle(theme.skirt, 0.55);
  paintHBands(floor, ix, right, iy, 2, gapX0, gapX1, sides.n);
  paintHBands(floor, ix, right, bottom - 2, 2, gapX0, gapX1, sides.s);
  paintVBands(floor, iy, bottom, ix, 2, gapY0, gapY1, sides.w);
  paintVBands(floor, iy, bottom, right - 2, 2, gapY0, gapY1, sides.e);

  const inset = 18;
  const corners = [
    { x: ix + inset, y: iy + inset },
    { x: right - inset, y: iy + inset },
    { x: ix + inset, y: bottom - inset },
    { x: right - inset, y: bottom - inset },
  ];
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const count = id === 'boss' ? 4 : 2;
  const kinds: Array<'brazier' | 'crate' | 'banner'> =
    id === 'boss' ? ['brazier', 'banner', 'brazier', 'crate'] : ['brazier', 'crate', 'banner'];
  for (let i = 0; i < count; i++) {
    const corner = corners[order[i]!]!;
    const kind = kinds[i % kinds.length]!;
    if (kind === 'brazier') drawBrazier(props, corner.x, corner.y, theme);
    else if (kind === 'crate') drawCrate(props, corner.x, corner.y, theme);
    else drawBanner(props, corner.x, corner.y, theme);
  }
  if (id === 'boss') {
    drawBrazier(props, ix + 78, iy + 22, theme);
    drawBrazier(props, right - 78, iy + 22, theme);
    drawBanner(props, ix + 36, bottom - 36, theme);
    drawCrate(props, right - 40, bottom - 34, theme);
  }
}

function drawBrazier(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  theme: DecorTheme,
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  g.fillStyle(theme.stone, 1);
  g.fillRect(ix - 5, iy - 2, 10, 5);
  g.fillStyle(0x000000, 0.35);
  g.fillRect(ix - 3, iy - 1, 6, 2);
  g.fillStyle(theme.pole, 1);
  g.fillRect(ix - 4, iy + 3, 2, 3);
  g.fillRect(ix + 2, iy + 3, 2, 3);
  g.fillStyle(theme.flame, 0.95);
  g.fillRect(ix - 2, iy - 8, 4, 6);
  g.fillStyle(theme.flameCore, 1);
  g.fillRect(ix - 1, iy - 6, 2, 3);
  g.fillStyle(theme.flame, 0.28);
  g.fillCircle(ix, iy - 6, 5);
}

function drawCrate(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  theme: DecorTheme,
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  g.fillStyle(theme.wood, 1);
  g.fillRect(ix - 5, iy - 5, 11, 10);
  g.fillStyle(theme.woodDark, 1);
  g.fillRect(ix - 5, iy - 5, 11, 2);
  g.fillRect(ix - 5, iy + 3, 11, 2);
  g.lineStyle(1, theme.woodDark, 0.9);
  g.lineBetween(ix - 4, iy - 3, ix + 4, iy + 2);
  g.lineBetween(ix + 4, iy - 3, ix - 4, iy + 2);
}

function drawBanner(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  theme: DecorTheme,
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  g.fillStyle(theme.pole, 1);
  g.fillRect(ix - 1, iy - 14, 2, 16);
  g.fillStyle(theme.banner, 1);
  g.fillRect(ix + 1, iy - 13, 8, 6);
  g.fillStyle(0x000000, 0.28);
  g.fillRect(ix + 1, iy - 9, 8, 1);
  g.fillStyle(theme.banner, 1);
  g.fillTriangle(ix + 1, iy - 7, ix + 5, iy - 4, ix + 9, iy - 7);
}
