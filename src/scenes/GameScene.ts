import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { TilePathfinder } from '../ai/TilePathfinder';
import { GameAudio } from '../audio/GameAudio';
import { getHero, SELECTED_HERO_KEY } from '../data/players';
import { formatItemToast, rollItem } from '../data/loot/roll';
import { HitFeedback } from '../systems/HitFeedback';
import { Inventory, type EquipSlot } from '../systems/Inventory';
import * as SaveManager from '../systems/SaveManager';
import { InputState } from '../input/InputState';
import { TouchControls } from '../ui/TouchControls';
import { InventoryPanel } from '../ui/InventoryPanel';
import { hideGameOverDom, showGameOverDom } from '../ui/GameOverDom';
import { hideStageClearDom, showStageClearDom } from '../ui/StageClearDom';
import { hideLootToastDom, showLootToastDom } from '../ui/LootToastDom';

/** Anything the player slash can damage. */
type Hostile = Enemy | Boss;

/** a entry, c combat corridor, b chest, boss arena. */
type RoomId = 'a' | 'c' | 'b' | 'boss';

const ROOM_ORDER: RoomId[] = ['a', 'c', 'b', 'boss'];

const ROOM_LABELS: Record<RoomId, string> = {
  a: '營地大廳',
  c: '戰鬥迴廊',
  b: '寶箱房',
  boss: '蓋利隊長 · 競技場',
};

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

/**
 * One-stage dungeon (one Tiled map, camera clamps per room).
 * Entry → combat corridor → chest room, and corridor → boss arena.
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
  private invHud!: Phaser.GameObjects.Text;
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
  private rooms!: Record<RoomId, Rect>;
  private pathfinder!: TilePathfinder;
  private audio!: GameAudio;
  private hitFeedback!: HitFeedback;
  private muteHud!: Phaser.GameObjects.Text;
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
    this.gameOver = false;
    this.bossDefeated = false;
    this.stageClearVisible = false;
    this.exitSuppress = false;
    this.exitActive = false;
    this.transitioning = false;
    this.currentRoom = 'a';
    this.chestOpened = false;
    this.gold = 0;
    this.inventory = new Inventory();
    this.inventoryOpen = false;
    this.leaving = false;
    this.loadPersistedState();

    const map = this.make.tilemap({ key: 'dungeon-room' });
    const tileset = map.addTilesetImage('dungeon-tiles', 'dungeon-tiles');
    if (!tileset) {
      throw new Error('Failed to add tileset "dungeon-tiles"');
    }

    const ground = map.createLayer('ground', tileset, 0, 0);
    const walls = map.createLayer('walls', tileset, 0, 0);
    if (!ground || !walls) {
      throw new Error('Missing ground/walls layers in dungeon-room map');
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
    // Full map physics bounds; camera clamps per room
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.rooms = this.readRooms(map);
    this.spawns = this.readSpawns(map, this.rooms);

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

    this.touch = new TouchControls(this);
    this.inputState = new InputState(this);

    const help = this.touch.enabled
      ? '浮動搖桿 · 長按攻擊 · 技 · E · 包 · R · ☰'
      : 'WASD · 長按 Space/Z · Q · E 寶箱 · I/Tab 包 · M · R · Esc';

    this.add
      .text(8, 8, help, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#d8e8d8',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.hpHud = this.add
      .text(8, 24, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffd0d0',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshHpHud(this.player.hp, this.player.maxHp);

    this.skillHud = this.add
      .text(8, 40, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshSkillHud();

    this.roomHud = this.add
      .text(8, 56, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c8e0ff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshRoomHud();

    this.add
      .text(8, 72, `職業 ${this.player.hero.label}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#d0ffd0',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.goldHud = this.add
      .text(8, 88, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffe066',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshGoldHud();

    this.invHud = this.add
      .text(8, 120, '', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#c8e8ff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshInvHud();

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
      .text(8, 104, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#aaaacc',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshMuteHud();

    this.audio.startBgm();
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

  private persistSave(): void {
    try {
      const current = this.registry.get(SELECTED_HERO_KEY);
      const heroId = SaveManager.isHeroId(current) ? current : 'eric';
      const snap = this.inventory.toJSON();
      SaveManager.save({
        version: 1,
        heroId,
        gold: this.gold,
        bag: snap.bag,
        equipped: snap.equipped,
      });
    } catch (err) {
      console.warn('[SS2] persistSave skipped', err);
    }
  }

  private refreshMuteHud(): void {
    const muted = this.audio?.isMuted() ?? false;
    this.muteHud?.setText(muted ? '靜音 (M)' : '音效開 (M)');
    this.muteHud?.setColor(muted ? '#ff8888' : '#aaaacc');
  }

  update(_time: number, delta: number): void {
    try {
      this.inputState.update(this.touch.poll());
      this.refreshSkillHud();

      // Always process restart/menu — including during GAME OVER.
      if (this.inputState.restartPressed) {
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

  /**
   * Leave GAME OVER via DOM / capture-key / update().
   * Browser setTimeout (not Phaser clocks). Select uses stop+start.
   * Restart: restart() then verify; if still inactive, stop + delayed start.
   */
  private nuclearLeave(mode: 'restart' | 'select'): void {
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

    try {
      this.physics.world.resume();
    } catch {
      /* ignore */
    }

    setTimeout(() => {
      if (hero !== undefined) game.registry.set(SELECTED_HERO_KEY, hero);

      if (mode === 'select') {
        try {
          game.scene.stop('GameScene');
        } catch {
          /* ignore */
        }
        game.scene.start('SelectScene');
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

    const healed = this.player.heal(2);
    const goldGain = 25;
    this.gold += goldGain;
    this.refreshGoldHud();
    this.persistSave();

    const item = rollItem(Math.random, {
      preferWeapon: true,
      allowedWeaponTypes: this.player.playerData.weapons.allowedTypes,
    });
    this.giveItem(item);

    const parts: string[] = [];
    if (healed > 0) parts.push(`+${healed} 生命`);
    else parts.push('生命已滿');
    parts.push(`+${goldGain} 金幣`);
    parts.push(formatItemToast(item));
    this.showLootToast(parts.filter(Boolean).join(' · '));
  }

  private tryEnemyDrop(x: number, y: number, chance: number): void {
    if (this.gameOver || Math.random() > chance) return;
    const item = rollItem(Math.random, {
      allowedWeaponTypes: this.player.playerData.weapons.allowedTypes,
    });
    this.giveItem(item);
    this.showLootToast(formatItemToast(item));
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

  private refreshInvHud(): void {
    const line = this.inventory.hudLine();
    const mods = this.inventory.modsHudLine();
    this.invHud?.setText(mods ? `${line}\n${mods}` : line);
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
      // Panel sits right of the left HUD; hide bag/mods line so it is not clipped under dim.
      this.invHud?.setVisible(false);
      this.inventoryPanel.open(this.inventory);
    } else {
      this.inventoryPanel.close();
      this.invHud?.setVisible(true);
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

  private equipBagItem(uid: string): void {
    const before = this.inventory.getBag().find((it) => it.uid === uid);
    if (!this.inventory.equipFromBag(uid)) return;
    this.player.applyGearMods(this.inventory.getMods());
    this.persistSave();
    this.refreshInvHud();
    this.inventoryPanel.refresh(this.inventory);
    if (before) this.showLootToast(`裝備 ${before.nameZh}`);
  }

  private unequipSlot(slot: EquipSlot): void {
    const prev = this.inventory.getEquipped(slot);
    if (!this.inventory.unequip(slot)) return;
    this.player.applyGearMods(this.inventory.getMods());
    this.persistSave();
    this.refreshInvHud();
    this.inventoryPanel.refresh(this.inventory);
    if (prev) this.showLootToast(`卸下 ${prev.nameZh}`);
  }

  private refreshGoldHud(): void {
    this.goldHud?.setText(`金幣 ${this.gold}`);
  }

  private showLootToast(msg: string): void {
    // DOM toast at bottom-center — clears top hint HUD and inventory overlay.
    showLootToastDom(msg);
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
    const r = this.rooms[room];
    this.cameras.main.setBounds(r.x, r.y, r.w, r.h);
    this.syncHostileRooms();
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
    let label = ROOM_LABELS[this.currentRoom] ?? this.currentRoom;
    if (this.currentRoom === 'boss' && this.bossDefeated) label += ' · 出口已開';
    this.roomHud?.setText(label);
  }

  private showBossVictory(): void {
    if (this.bossDefeated || this.gameOver) return;
    this.bossDefeated = true;
    this.audio.bossDefeat();
    this.activateExit();
    this.refreshRoomHud();
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
    showStageClearDom({
      restart: () => this.restartRun(),
      select: () => this.backToSelect(),
      continue: () => this.dismissStageClear(),
    });
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
    const tw = map.tileWidth || 16;
    const th = map.tileHeight || 16;
    const rw = 48 * tw;
    const rh = 32 * th;
    const rooms: Record<RoomId, Rect> = {
      a: { x: 0, y: 0, w: rw, h: rh },
      c: { x: rw, y: 0, w: rw, h: rh },
      b: { x: rw, y: rh, w: rw, h: rh },
      boss: { x: rw * 2, y: 0, w: rw, h: rh },
    };
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
      if (rect) rooms[id] = rect;
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

  private readSpawns(
    map: Phaser.Tilemaps.Tilemap,
    rooms: Record<RoomId, Rect>,
  ): GameScene['spawns'] {
    const tile = (tx: number, ty: number): SpawnPoint => ({
      x: tx * (map.tileWidth || 16) + (map.tileWidth || 16) / 2,
      y: ty * (map.tileHeight || 16) + (map.tileHeight || 16) / 2,
    });
    const doorAt = (tx: number, ty: number, wTiles: number, hTiles: number, target: string, room: RoomId): DoorSpawn => ({
      x: tx * (map.tileWidth || 16),
      y: ty * (map.tileHeight || 16),
      w: wTiles * (map.tileWidth || 16),
      h: hTiles * (map.tileHeight || 16),
      target,
      room,
    });

    // Mirrors tools/make_dungeon_map.py so a missing object layer still has a path.
    const fallback: GameScene['spawns'] = {
      player: tile(10, 16),
      points: {
        spawn_a: tile(40, 15),
        spawn_c_west: tile(56, 15),
        spawn_c_east: tile(86, 15),
        spawn_c_south: tile(70, 21),
        spawn_b: tile(70, 42),
        spawn_boss: tile(105, 15),
      },
      enemies: [
        { ...tile(18, 26), room: 'a', hp: 2 },
        { ...tile(62, 7), room: 'c', hp: 3 },
        { ...tile(78, 8), room: 'c', hp: 3 },
        { ...tile(56, 28), room: 'c', hp: 3 },
        { ...tile(88, 58), room: 'b', hp: 2 },
      ],
      boss: tile(126, 18),
      chest: tile(80, 50),
      exit: tile(116, 5),
      doors: [
        doorAt(45, 14, 3, 4, 'spawn_c_west', 'c'),
        doorAt(48, 14, 3, 4, 'spawn_a', 'a'),
        doorAt(92, 14, 3, 4, 'spawn_boss', 'boss'),
        doorAt(96, 14, 3, 4, 'spawn_c_east', 'c'),
        doorAt(69, 28, 3, 4, 'spawn_b', 'b'),
        doorAt(69, 32, 3, 3, 'spawn_c_south', 'c'),
      ],
    };

    const layer = map.getObjectLayer('spawns');
    if (!layer) return fallback;

    const center = (o: Phaser.Types.Tilemaps.TiledObject): SpawnPoint => ({
      x: (o.x ?? 0) + (o.width ?? 0) / 2,
      y: (o.y ?? 0) + (o.height ?? 0) / 2,
    });

    const playerObj = layer.objects.find((o) => o.name === 'player');
    const bossObj = layer.objects.find((o) => o.type === 'boss' || o.name === 'boss');
    const chestObj = layer.objects.find((o) => o.type === 'chest' || o.name === 'chest');
    const exitObj = layer.objects.find((o) => o.type === 'exit' || o.name === 'exit');

    const points: Record<string, SpawnPoint> = {};
    for (const o of layer.objects) {
      const name = o.name ?? '';
      const isSpawn = o.type === 'spawn' || name.startsWith('spawn_');
      if (!isSpawn || name === 'player' || !name) continue;
      points[name] = center(o);
    }
    for (const [name, point] of Object.entries(fallback.points)) {
      if (!points[name]) points[name] = point;
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

    const doors: DoorSpawn[] = [];
    for (const o of layer.objects) {
      if (!(o.type === 'door' || (o.name?.startsWith('door_') ?? false))) continue;
      const room = this.propString(o, 'room');
      const target = this.propString(o, 'target');
      if (!isRoomId(room) || !target) continue;
      doors.push({
        x: o.x ?? 0,
        y: o.y ?? 0,
        w: o.width ?? 32,
        h: o.height ?? 32,
        target,
        room,
      });
    }

    const bossRoom = rooms.boss;
    const exitFallback: SpawnPoint = {
      x: bossRoom.x + bossRoom.w * 0.45,
      y: bossRoom.y + 5 * (map.tileHeight || 16),
    };

    return {
      player: playerObj ? center(playerObj) : fallback.player,
      points,
      enemies,
      boss: bossObj ? center(bossObj) : fallback.boss,
      chest: chestObj ? center(chestObj) : fallback.chest,
      exit: exitObj ? center(exitObj) : exitFallback,
      doors: doors.length ? doors : fallback.doors,
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
