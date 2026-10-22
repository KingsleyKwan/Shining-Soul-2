import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { TilePathfinder } from '../ai/TilePathfinder';
import { GameAudio, AUDIO_REGISTRY_KEY } from '../audio/GameAudio';
import { getHero, SELECTED_HERO_KEY } from '../data/players';
import { formatItemToast, rollItem } from '../data/loot/roll';
import { Inventory } from '../systems/Inventory';
import { InputState } from '../input/InputState';
import { TouchControls } from '../ui/TouchControls';

/** Anything the player slash can damage. */
type Hostile = Enemy | Boss;

type RoomId = 'a' | 'b';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Two-chamber dungeon (one Tiled map).
 * Room A = combat (Pastes + Gully). Room B = quiet (1 Paste + chest).
 * Door objects teleport with a short fade; camera bounds clamp per room.
 */
export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemies!: Phaser.GameObjects.Group;
  private boss?: Boss;
  private hostiles!: Phaser.GameObjects.Group;
  private touch!: TouchControls;
  private inputState!: InputState;
  private leaving = false;
  private hitThisSwing = new Set<Hostile>();
  private hpHud!: Phaser.GameObjects.Text;
  private roomHud!: Phaser.GameObjects.Text;
  private goldHud!: Phaser.GameObjects.Text;
  private gold = 0;
  private inventory = new Inventory();
  private invHud!: Phaser.GameObjects.Text;
  private chestOpened = false;
  private chestPos?: { x: number; y: number };
  private chestGfx?: Phaser.GameObjects.Graphics;
  private chestLabel?: Phaser.GameObjects.Text;
  private chestPrompt?: Phaser.GameObjects.Text;
  private gameOver = false;
  private bossDefeated = false;
  private transitioning = false;
  private currentRoom: RoomId = 'a';
  private rooms!: Record<RoomId, Rect>;
  private pathfinder!: TilePathfinder;
  private audio!: GameAudio;
  private muteHud!: Phaser.GameObjects.Text;
  private spawns!: {
    player: { x: number; y: number };
    spawnA: { x: number; y: number };
    spawnB: { x: number; y: number };
    enemiesA: { x: number; y: number }[];
    enemiesB: { x: number; y: number }[];
    boss?: { x: number; y: number };
    chest?: { x: number; y: number };
    doors: { x: number; y: number; w: number; h: number; target: string; room: RoomId }[];
  };

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.gameOver = false;
    this.bossDefeated = false;
    this.transitioning = false;
    this.currentRoom = 'a';
    this.chestOpened = false;
    this.gold = 0;
    this.inventory = new Inventory();
    this.leaving = false;

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

    this.audio = new GameAudio(this);
    this.registry.set(AUDIO_REGISTRY_KEY, this.audio);

    const worldW = map.widthInPixels;
    const worldH = map.heightInPixels;
    // Full map physics bounds; camera clamps per room
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.rooms = {
      a: { x: 0, y: 0, w: worldW / 2, h: worldH },
      b: { x: worldW / 2, y: 0, w: worldW / 2, h: worldH },
    };

    this.spawns = this.readSpawns(map, worldW, worldH);

    const hero = getHero(this.registry.get(SELECTED_HERO_KEY) as string);
    this.player = new Player(this, this.spawns.player.x, this.spawns.player.y, hero);
    this.player.setHitboxHandler((zone) => this.wireHitbox(zone));
    this.player.setHudHandlers({
      onHpChange: (hp, max) => this.refreshHpHud(hp, max),
      onDeath: () => this.showGameOver(),
    });
    this.physics.add.collider(this.player, walls);
    // Brief spawn grace so Room A boss/slimes do not delete a fresh run in seconds.
    this.player.grantSpawnGrace(2000);

    this.enemies = this.add.group({ runChildUpdate: true });
    this.hostiles = this.add.group();

    for (const p of this.spawns.enemiesA) {
      this.spawnPaste(p.x, p.y, 3, walls);
    }
    for (const p of this.spawns.enemiesB) {
      this.spawnPaste(p.x, p.y, 2, walls); // weaker room-B paste
    }

    if (this.spawns.boss) {
      this.boss = new Boss(this, this.spawns.boss.x, this.spawns.boss.y, 14);
      this.boss.setTarget(this.player);
      this.boss.setPathfinder(this.pathfinder);
      this.boss.setOnDefeated(() => this.showBossVictory());
      this.boss.setOnLootDrop((dx, dy) => this.tryEnemyDrop(dx, dy, 0.55));
      this.hostiles.add(this.boss);
      this.physics.add.collider(this.boss, walls);
    }

    if (this.spawns.chest) {
      this.placeChest(this.spawns.chest.x, this.spawns.chest.y);
    }

    this.setupDoors();
    this.applyRoomCamera('a');

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.touch = new TouchControls(this);
    this.inputState = new InputState(this);

    const help = this.touch.enabled
      ? 'Stick · hold ATK charge · E · R · ☰'
      : 'WASD · hold Space/Z charge · E chest · M · R · Esc';

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

    this.roomHud = this.add
      .text(8, 40, '', {
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
      .text(8, 56, `Class ${this.player.hero.label}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#d0ffd0',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.goldHud = this.add
      .text(8, 72, '', {
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
      .text(8, 104, '', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#c8e8ff',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshInvHud();

    this.chestPrompt = this.add
      .text(0, 0, 'E / Space — Open', {
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
      .text(8, 88, '', {
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
  }

  private refreshMuteHud(): void {
    const muted = this.audio?.isMuted() ?? false;
    this.muteHud?.setText(muted ? 'Muted (M)' : 'Audio on (M)');
    this.muteHud?.setColor(muted ? '#ff8888' : '#aaaacc');
  }

  update(_time: number, delta: number): void {
    this.inputState.update(this.touch.poll());

    if (this.inputState.restartPressed) {
      this.restartRun();
      return;
    }
    if (this.inputState.menuPressed) {
      this.backToSelect();
      return;
    }

    if (!this.gameOver && !this.transitioning) {
      this.updateChestInteract();
      this.player.handleInput(this.inputState, delta);
    }
  }

  private restartRun(): void {
    if (this.leaving) return;
    this.leaving = true;
    // Defer out of the input callback so ScenePlugin shutdown is clean.
    this.time.delayedCall(0, () => {
      this.scene.restart();
    });
  }

  private backToSelect(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.time.delayedCall(0, () => {
      this.scene.start('SelectScene');
    });
  }

  private spawnPaste(
    x: number,
    y: number,
    hp: number,
    walls: Phaser.Tilemaps.TilemapLayer,
  ): void {
    const enemy = new Enemy(this, x, y, hp);
    enemy.setTarget(this.player);
    enemy.setPathfinder(this.pathfinder);
    enemy.setOnLootDrop((dx, dy) => this.tryEnemyDrop(dx, dy, 0.28));
    this.enemies.add(enemy);
    this.hostiles.add(enemy);
    this.physics.add.collider(enemy, walls);
  }

  private placeChest(x: number, y: number): void {
    this.chestPos = { x, y };
    this.chestGfx = this.add.graphics().setDepth(5);
    this.chestLabel = this.add
      .text(x, y - 18, 'chest', {
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
      this.chestLabel.setText(opened ? 'opened' : 'chest');
      this.chestLabel.setColor(opened ? '#a0a0a0' : '#ffe8b0');
    }
  }

  private nearChest(): boolean {
    if (!this.chestPos || this.player.isDead()) return false;
    return Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.chestPos.x,
      this.chestPos.y,
    ) <= 36;
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

    const item = rollItem(Math.random, {
      preferWeapon: true,
      allowedWeaponTypes: this.player.playerData.weapons.allowedTypes,
    });
    this.giveItem(item);

    const parts: string[] = [];
    if (healed > 0) parts.push(`+${healed} HP`);
    else parts.push('HP full');
    parts.push(`+${goldGain} gold`);
    parts.push(formatItemToast(item));
    this.showLootToast(parts.join('  ·  '));
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
    this.refreshInvHud();
  }

  private refreshInvHud(): void {
    const w = this.inventory.getEquippedWeapon();
    const line = this.inventory.hudLine();
    const zh = w ? w.nameZh : '無裝備';
    this.invHud?.setText(`${line}\n${zh}`);
  }

  private refreshGoldHud(): void {
    this.goldHud?.setText(`Gold ${this.gold}`);
  }

  private showLootToast(msg: string): void {
    const { width } = this.scale;
    const toast = this.add
      .text(width / 2, 72, msg, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffe066',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(160)
      .setAlpha(0);

    this.tweens.add({
      targets: toast,
      alpha: 1,
      y: 64,
      duration: 250,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(1100, () => {
          if (!toast.active) return;
          this.tweens.add({
            targets: toast,
            alpha: 0,
            y: 56,
            duration: 280,
            onComplete: () => toast.destroy(),
          });
        });
      },
    });
  }

  private setupDoors(): void {
    for (const d of this.spawns.doors) {
      const zone = this.add.zone(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h);
      this.physics.add.existing(zone, true);
      this.physics.add.overlap(this.player, zone, () => {
        this.tryUseDoor(d.target, d.room);
      });
    }
  }

  private tryUseDoor(targetSpawn: string, destRoom: RoomId): void {
    if (this.transitioning || this.gameOver || this.player.isDead()) return;
    if (this.currentRoom === destRoom) return;

    const dest =
      targetSpawn === 'spawn_b'
        ? this.spawns.spawnB
        : targetSpawn === 'spawn_a'
          ? this.spawns.spawnA
          : null;
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
  }

  private refreshHpHud(hp: number, max: number): void {
    this.hpHud?.setText(`HP ${hp}/${max}`);
    this.hpHud?.setColor(hp <= 1 ? '#ff6666' : hp <= 2 ? '#ffcc66' : '#ffd0d0');
  }

  private refreshRoomHud(): void {
    const label = this.currentRoom === 'a' ? 'Room A — Combat Hall' : 'Room B — Side Chamber';
    this.roomHud?.setText(label);
  }

  private showBossVictory(): void {
    if (this.bossDefeated || this.gameOver) return;
    this.bossDefeated = true;
    this.audio.bossDefeat();

    const { width } = this.scale;
    const banner = this.add
      .text(width / 2, 48, 'Captain Gully defeated!', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffe066',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(150)
      .setAlpha(0);

    this.tweens.add({
      targets: banner,
      alpha: 1,
      y: 40,
      duration: 400,
      ease: 'Back.easeOut',
    });
  }

  private showGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    // Allow a fresh restart even if a prior leaving flag got stuck mid-shutdown.
    this.leaving = false;

    const { width, height } = this.scale;
    // Full-screen interactive hit target (depth below touch UI 1200, above world).
    // Prior bug: non-interactive overlay + input.once could miss taps / race leaving.
    const bg = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, height / 2 - 12, 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ff8888',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    const hint = this.add
      .text(width / 2, height / 2 + 20, 'R / 點按重開 · Esc / ☰ 選角', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e8eef5',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    // Defer accept so the death-frame pointer / held ATK cannot eat the first restart.
    let accept = false;
    this.time.delayedCall(350, () => {
      accept = true;
      hint.setText('R / 點按重開 · Esc / ☰ 選角');
    });
    hint.setText('…');

    const tryRestart = () => {
      if (!accept || this.leaving) return;
      this.restartRun();
    };
    const trySelect = () => {
      if (!accept || this.leaving) return;
      this.backToSelect();
    };

    bg.on('pointerdown', tryRestart);

    // Direct keyboard (more reliable than JustDown alone after long fights).
    this.input.keyboard?.on('keydown-R', tryRestart);
    this.input.keyboard?.on('keydown-ESC', trySelect);
  }

  private propString(
    o: Phaser.Types.Tilemaps.TiledObject,
    key: string,
  ): string | undefined {
    const props = o.properties as { name: string; value: unknown }[] | undefined;
    if (!Array.isArray(props)) return undefined;
    const p = props.find((x) => x.name === key);
    return p ? String(p.value) : undefined;
  }

  private readSpawns(
    map: Phaser.Tilemaps.Tilemap,
    worldW: number,
    worldH: number,
  ): GameScene['spawns'] {
    const half = worldW / 2;
    const fallback: GameScene['spawns'] = {
      player: { x: half / 2, y: worldH / 2 },
      spawnA: { x: half - 80, y: worldH / 2 },
      spawnB: { x: half + 80, y: worldH / 2 },
      enemiesA: [
        { x: half / 2 + 96, y: worldH / 2 },
        { x: half / 2 - 128, y: worldH / 2 + 32 },
      ],
      enemiesB: [{ x: half + half / 2, y: worldH / 2 + 32 }],
      boss: { x: half / 2, y: worldH / 2 - 64 },
      chest: { x: half + half / 2, y: worldH / 2 - 64 },
      doors: [
        {
          x: half - 48,
          y: worldH / 2 - 16,
          w: 32,
          h: 32,
          target: 'spawn_b',
          room: 'b',
        },
        {
          x: half + 16,
          y: worldH / 2 - 16,
          w: 32,
          h: 32,
          target: 'spawn_a',
          room: 'a',
        },
      ],
    };

    const layer = map.getObjectLayer('spawns');
    if (!layer) return fallback;

    const center = (o: Phaser.Types.Tilemaps.TiledObject) => ({
      x: (o.x ?? 0) + (o.width ?? 0) / 2,
      y: (o.y ?? 0) + (o.height ?? 0) / 2,
    });

    const byName = (n: string) => layer.objects.find((o) => o.name === n);

    const playerObj = byName('player');
    const spawnA = byName('spawn_a');
    const spawnB = byName('spawn_b');
    const bossObj = layer.objects.find((o) => o.type === 'boss' || o.name === 'boss');
    const chestObj = layer.objects.find((o) => o.type === 'chest' || o.name === 'chest');

    const enemiesA: { x: number; y: number }[] = [];
    const enemiesB: { x: number; y: number }[] = [];
    for (const o of layer.objects) {
      const isEnemy =
        o.type === 'enemy' ||
        o.type === 'dummy' ||
        (o.name?.startsWith('enemy') ?? false) ||
        (o.name?.startsWith('dummy') ?? false);
      if (!isEnemy) continue;
      const room = this.propString(o, 'room');
      const c = center(o);
      if (room === 'b' || (o.name?.startsWith('enemy_b') ?? false)) {
        enemiesB.push(c);
      } else {
        enemiesA.push(c);
      }
    }

    const doors = layer.objects
      .filter((o) => o.type === 'door' || o.name?.startsWith('door_'))
      .map((o) => ({
        x: o.x ?? 0,
        y: o.y ?? 0,
        w: o.width ?? 32,
        h: o.height ?? 32,
        target: this.propString(o, 'target') ?? 'spawn_b',
        room: (this.propString(o, 'room') as RoomId) ?? 'b',
      }));

    return {
      player: playerObj ? center(playerObj) : fallback.player,
      spawnA: spawnA ? center(spawnA) : fallback.spawnA,
      spawnB: spawnB ? center(spawnB) : fallback.spawnB,
      enemiesA: enemiesA.length ? enemiesA : fallback.enemiesA,
      enemiesB: enemiesB.length ? enemiesB : fallback.enemiesB,
      boss: bossObj ? center(bossObj) : fallback.boss,
      chest: chestObj ? center(chestObj) : fallback.chest,
      doors: doors.length ? doors : fallback.doors,
    };
  }

  private wireHitbox(zone: Phaser.GameObjects.Zone): void {
    this.hitThisSwing.clear();
    this.physics.add.overlap(zone, this.hostiles, (_z, obj) => {
      const hostile = obj as Hostile;
      if (!hostile.active || this.hitThisSwing.has(hostile)) return;
      this.hitThisSwing.add(hostile);
      const dmg = (zone.getData('damage') as number | undefined) ?? this.player.getSlashDamage(0);
      hostile.takeDamage(dmg, this.player.x, this.player.y);
    });
  }
}
