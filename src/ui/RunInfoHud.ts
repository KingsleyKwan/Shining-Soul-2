import Phaser from 'phaser';
import type { RoomId } from '../systems/MapGenerator';
import { Inventory } from '../systems/Inventory';

/** Screen-space rect of one dungeon room (world pixels, same size per room). */
export type RunInfoRoomRect = { x: number; y: number; w: number; h: number };

export type RunInfoMap = {
  rooms: Record<RoomId, RunInfoRoomRect>;
  current: RoomId;
  explored: ReadonlySet<RoomId>;
  cleared: ReadonlySet<RoomId>;
  /** Boss has fallen — the arena node reads as cleared and keeps its mark. */
  bossDown: boolean;
  /** Warm fort vs cold corridor, so node colors follow the stage. */
  cold: boolean;
};

const ROOM_IDS: readonly RoomId[] = ['a', 'c', 'b', 'boss'];

/** One-character marks. Full names stay on the room HUD. */
const ROOM_MARK: Record<RoomId, string> = {
  a: '入',
  c: '廊',
  b: '箱',
  boss: '王',
};

const MAP_W = 108;
const MAP_H = 72;

const GEAR_EMPTY = '「空」';
const NAME_MAX = 6;

/**
 * Always-on stage HUD: a four-room minimap and a compact gear summary.
 * Scroll-fixed, not interactive, so it never steals the stick or 包／R／☰.
 *
 * Minimap sits top-center, clear of the touch cluster at y≈22 on the right.
 * Gear sits under the status stack on desktop, and above the lower-left
 * thumb zone on touch (attack buttons stay on the right).
 */
export class RunInfoHud {
  private readonly mapGfx: Phaser.GameObjects.Graphics;
  private readonly gearBg: Phaser.GameObjects.Graphics;
  private readonly gearText: Phaser.GameObjects.Text;
  private readonly labels: Record<RoomId, Phaser.GameObjects.Text>;
  private touch: boolean;

  constructor(scene: Phaser.Scene, opts: { touch: boolean }) {
    this.touch = opts.touch;
    const mapAt = mapOrigin(scene.scale.width);
    this.mapGfx = scene.add.graphics().setScrollFactor(0).setDepth(100);

    this.labels = {} as Record<RoomId, Phaser.GameObjects.Text>;
    for (const id of ROOM_IDS) {
      this.labels[id] = scene.add
        .text(mapAt.x, mapAt.y, ROOM_MARK[id], {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#8a98a8',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(102);
    }

    const gearAt = gearOrigin(scene.scale.height, this.touch);
    this.gearBg = scene.add.graphics().setScrollFactor(0).setDepth(100);
    this.gearText = scene.add
      .text(gearAt.x, gearAt.y, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#e7f2dc',
        lineSpacing: 1,
      })
      .setScrollFactor(0)
      .setDepth(101);

    this.drawGearChrome();
  }

  /** Game objects that must render on the unzoomed UI camera. */
  uiObjects(): Phaser.GameObjects.GameObject[] {
    return [this.mapGfx, this.gearBg, this.gearText, ...ROOM_IDS.map((id) => this.labels[id])];
  }

  /** Reposition gear / minimap after EXPAND canvas size changes. */
  layout(touch: boolean): void {
    this.touch = touch;
    const gearAt = gearOrigin(this.gearText.scene.scale.height, this.touch);
    this.gearText.setPosition(gearAt.x, gearAt.y);
    this.drawGearChrome();
  }

  syncMap(view: RunInfoMap): void {
    const g = this.mapGfx;
    const ox = mapOrigin(g.scene.scale.width);
    g.clear();
    g.fillStyle(0x0c1016, 0.78);
    g.fillRoundedRect(ox.x, ox.y, MAP_W, MAP_H, 3);
    g.lineStyle(1, view.cold ? 0x7a90c0 : 0x9aaa78, 0.55);
    g.strokeRoundedRect(ox.x, ox.y, MAP_W, MAP_H, 3);

    const layout = layoutNodes(view.rooms, ox.x, ox.y);
    g.lineStyle(1, 0x5a6878, 0.9);
    for (let i = 0; i < ROOM_IDS.length; i++) {
      for (let j = i + 1; j < ROOM_IDS.length; j++) {
        const a = ROOM_IDS[i]!;
        const b = ROOM_IDS[j]!;
        if (!roomsTouch(view.rooms[a], view.rooms[b])) continue;
        const na = layout[a];
        const nb = layout[b];
        const bothSeen = view.explored.has(a) && view.explored.has(b);
        g.lineStyle(2, bothSeen ? (view.cold ? 0x9ec0e8 : 0xc6d898) : 0x3a4454, 0.95);
        g.lineBetween(na.cx, na.cy, nb.cx, nb.cy);
      }
    }

    for (const id of ROOM_IDS) {
      const n = layout[id];
      const seen = view.explored.has(id);
      const cleared = id === 'boss' ? view.bossDown : view.cleared.has(id);
      const current = id === view.current;
      const fill = nodeFill(id, seen, cleared, current, view.cold);
      g.fillStyle(fill, seen ? 0.95 : 0.9);
      g.fillRect(n.x, n.y, n.w, n.h);
      if (current) {
        g.lineStyle(1, 0xfff6c8, 1);
        g.strokeRect(n.x + 0.5, n.y + 0.5, n.w - 1, n.h - 1);
      }
      if (id === 'boss') {
        drawDiamond(g, n.cx, n.y + 4, seen ? 0xffe0a8 : 0x6a5060);
      }
      if (cleared) {
        drawCheck(g, n.x + n.w - 7, n.y + n.h - 5);
      }
      const label = this.labels[id];
      label.setPosition(n.cx, n.cy + (id === 'boss' ? 2 : 0));
      label.setColor(seen ? '#f4f8f0' : '#6a7584');
    }
  }

  syncGear(inv: Inventory): void {
    const weapon = shortName(inv.getEquipped('weapon')?.nameZh);
    const armor = shortName(inv.getEquipped('armor')?.nameZh);
    const accessory = shortName(inv.getEquipped('accessory')?.nameZh);
    const mods = inv.getMods();
    this.gearText.setText(
      [
        `武 ${weapon}`,
        `甲 ${armor}`,
        `飾 ${accessory}`,
        `傷${fmtSigned(mods.damage)} 速${fmtSigned(mods.speed)} 力${fmtSigned(mods.str)} 命${fmtSigned(mods.maxHp)}`,
      ].join('\n'),
    );
    this.drawGearChrome();
  }

  destroy(): void {
    this.mapGfx.destroy();
    this.gearBg.destroy();
    this.gearText.destroy();
    for (const id of ROOM_IDS) this.labels[id].destroy();
  }

  private drawGearChrome(): void {
    const padX = 4;
    const padY = 3;
    const x = this.gearText.x - padX;
    const y = this.gearText.y - padY;
    const w = Math.max(88, this.gearText.width + padX * 2);
    const h = Math.max(36, this.gearText.height + padY * 2);
    const g = this.gearBg;
    g.clear();
    g.fillStyle(0x000000, 0.66);
    g.fillRoundedRect(x, y, w, h, 3);
    g.lineStyle(1, 0x8aa090, 0.4);
    g.strokeRoundedRect(x, y, w, h, 3);
  }
}

function mapOrigin(width: number): { x: number; y: number } {
  return { x: Math.round((width - MAP_W) / 2), y: 2 };
}

function gearOrigin(height: number, touch: boolean): { x: number; y: number } {
  if (touch) {
    // Bottom-left, above the thumb zone. Attack buttons live on the right.
    return { x: 6, y: height - 132 };
  }
  // Under the mute line (y≈52, one line). Stays left of the top-center minimap.
  return { x: 6, y: 76 };
}

type NodeBox = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function layoutNodes(
  rooms: Record<RoomId, RunInfoRoomRect>,
  originX: number,
  originY: number,
): Record<RoomId, NodeBox> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ROOM_IDS) {
    const r = rooms[id];
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const spanW = Math.max(1, maxX - minX);
  const spanH = Math.max(1, maxY - minY);
  const pad = 7;
  const innerW = MAP_W - pad * 2;
  const innerH = MAP_H - pad * 2;
  const scale = Math.min(innerW / spanW, innerH / spanH);
  const usedW = spanW * scale;
  const usedH = spanH * scale;
  const ox = originX + (MAP_W - usedW) / 2;
  const oy = originY + (MAP_H - usedH) / 2;
  const gap = 2;
  const out = {} as Record<RoomId, NodeBox>;
  for (const id of ROOM_IDS) {
    const r = rooms[id];
    const x = ox + (r.x - minX) * scale;
    const y = oy + (r.y - minY) * scale;
    const w = Math.max(8, r.w * scale - gap);
    const h = Math.max(8, r.h * scale - gap);
    out[id] = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }
  return out;
}

function roomsTouch(a: RunInfoRoomRect, b: RunInfoRoomRect): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx === a.w && dy === 0) || (dy === a.h && dx === 0);
}

function nodeFill(
  id: RoomId,
  seen: boolean,
  cleared: boolean,
  current: boolean,
  cold: boolean,
): number {
  if (id === 'boss') {
    if (!seen) return 0x3a2434;
    if (cleared) return 0x6aaa78;
    if (current) return cold ? 0xffb0c8 : 0xff8898;
    return cold ? 0x8a3868 : 0xa04858;
  }
  if (!seen) return 0x242a32;
  if (current) return cold ? 0xd2e6ff : 0xd4ec86;
  if (cleared) return cold ? 0x5a9a78 : 0x6aaa58;
  return cold ? 0x3a6898 : 0x4e7a3c;
}

function drawDiamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number): void {
  g.fillStyle(color, 0.95);
  g.fillTriangle(cx, cy - 3, cx - 3, cy, cx, cy + 3);
  g.fillTriangle(cx, cy - 3, cx + 3, cy, cx, cy + 3);
}

function drawCheck(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.lineStyle(1, 0xf4ffe8, 1);
  g.lineBetween(x, y, x + 2, y + 2);
  g.lineBetween(x + 2, y + 2, x + 5, y - 2);
}

function shortName(name: string | undefined): string {
  if (!name) return GEAR_EMPTY;
  const chars = Array.from(name);
  if (chars.length <= NAME_MAX) return name;
  return chars.slice(0, NAME_MAX).join('');
}

function fmtSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}
