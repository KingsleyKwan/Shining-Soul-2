import Phaser from 'phaser';
import type { RolledItem } from '../data/loot/types';
import {
  Inventory,
  SLOT_LABEL_ZH,
  SLOT_ORDER,
  type EquipSlot,
} from '../systems/Inventory';

export type InventoryPanelHandlers = {
  onEquip: (uid: string) => void;
  onUnequip: (slot: EquipSlot) => void;
  onClose: () => void;
};

const DEPTH = 1400;
const PANEL_W = 300;
const PANEL_H = 268;
const SLOT_H = 28;
const BAG_ROW_H = 22;
const MAX_BAG_VISIBLE = 5;

/**
 * Camera-fixed inventory / equipment panel (HK Traditional Chinese).
 * Soft-pauses combat via GameScene while visible; click/tap to equip or unequip.
 */
export class InventoryPanel {
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly modsText: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly closeBtn: Phaser.GameObjects.Text;
  private slotRows: Phaser.GameObjects.Container[] = [];
  private bagRows: Phaser.GameObjects.Container[] = [];
  private handlers: InventoryPanelHandlers;
  private visible = false;

  constructor(scene: Phaser.Scene, handlers: InventoryPanelHandlers) {
    this.scene = scene;
    this.handlers = handlers;

    const { width, height } = scene.scale;
    this.dim = scene.add
      .rectangle(width / 2, height / 2, width + 4, height + 4, 0x000000, 0.45)
      .setScrollFactor(0)
      .setDepth(DEPTH - 1)
      .setInteractive()
      .setVisible(false);
    // Block clicks through to the world; dim does not close (avoid mis-taps).
    this.dim.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
    });

    const cx = width / 2;
    const cy = Phaser.Math.Clamp(height / 2, PANEL_H / 2 + 4, height - PANEL_H / 2 - 4);

    this.bg = scene.add
      .rectangle(0, 0, PANEL_W, PANEL_H, 0x121820, 0.96)
      .setStrokeStyle(2, 0x6a90b8, 0.95);

    this.title = scene.add
      .text(-PANEL_W / 2 + 10, -PANEL_H / 2 + 8, '背包／裝備', {
        fontFamily: 'monospace, system-ui, sans-serif',
        fontSize: '13px',
        color: '#e8f0ff',
      })
      .setOrigin(0, 0);

    this.closeBtn = scene.add
      .text(PANEL_W / 2 - 10, -PANEL_H / 2 + 8, '關閉', {
        fontFamily: 'monospace, system-ui, sans-serif',
        fontSize: '12px',
        color: '#ffd0a0',
        backgroundColor: '#2a3040',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.handlers.onClose();
    });

    this.modsText = scene.add
      .text(-PANEL_W / 2 + 10, -PANEL_H / 2 + 28, '', {
        fontFamily: 'monospace, system-ui, sans-serif',
        fontSize: '10px',
        color: '#a8e0c0',
      })
      .setOrigin(0, 0);

    this.hint = scene.add
      .text(-PANEL_W / 2 + 10, PANEL_H / 2 - 16, '點裝備欄卸下 · 點背包裝備 · I／Tab 關閉', {
        fontFamily: 'monospace, system-ui, sans-serif',
        fontSize: '9px',
        color: '#8899aa',
      })
      .setOrigin(0, 0);

    this.root = scene.add
      .container(cx, cy, [this.bg, this.title, this.closeBtn, this.modsText, this.hint])
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setVisible(false);
  }

  isOpen(): boolean {
    return this.visible;
  }

  open(inv: Inventory): void {
    this.visible = true;
    this.dim.setVisible(true);
    this.root.setVisible(true);
    this.refresh(inv);
  }

  close(): void {
    this.visible = false;
    this.dim.setVisible(false);
    this.root.setVisible(false);
  }

  toggle(inv: Inventory): void {
    if (this.visible) this.close();
    else this.open(inv);
  }

  refresh(inv: Inventory): void {
    this.clearDynamic();
    this.modsText.setText(inv.modsHudLine());

    let y = -PANEL_H / 2 + 48;
    this.root.add(
      this.scene.add
        .text(-PANEL_W / 2 + 10, y, '—— 裝備 ——', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#9ab4d0',
        })
        .setOrigin(0, 0),
    );
    y += 16;

    for (const slot of SLOT_ORDER) {
      const item = inv.getEquipped(slot);
      const row = this.makeEquipRow(slot, item, y);
      this.slotRows.push(row);
      this.root.add(row);
      y += SLOT_H + 2;
    }

    y += 4;
    this.root.add(
      this.scene.add
        .text(-PANEL_W / 2 + 10, y, `—— 背包（${inv.getBag().length}）——`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#9ab4d0',
        })
        .setOrigin(0, 0),
    );
    y += 14;

    const bag = inv.getBag();
    if (!bag.length) {
      this.root.add(
        this.scene.add
          .text(-PANEL_W / 2 + 14, y + 4, '（空）開寶箱或擊敗敵人取得裝備', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#667788',
          })
          .setOrigin(0, 0),
      );
      return;
    }

    const shown = bag.slice(0, MAX_BAG_VISIBLE);
    for (const item of shown) {
      const row = this.makeBagRow(item, y);
      this.bagRows.push(row);
      this.root.add(row);
      y += BAG_ROW_H + 2;
    }
    if (bag.length > MAX_BAG_VISIBLE) {
      this.root.add(
        this.scene.add
          .text(-PANEL_W / 2 + 14, y, `…還有 ${bag.length - MAX_BAG_VISIBLE} 件`, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#778899',
          })
          .setOrigin(0, 0),
      );
    }
  }

  destroy(): void {
    this.clearDynamic();
    this.root.destroy(true);
    this.dim.destroy();
  }

  private clearDynamic(): void {
    for (const row of this.slotRows) row.destroy(true);
    for (const row of this.bagRows) row.destroy(true);
    this.slotRows = [];
    this.bagRows = [];
    // Remove leftover section labels (children beyond fixed chrome).
    const keep = new Set<Phaser.GameObjects.GameObject>([
      this.bg,
      this.title,
      this.closeBtn,
      this.modsText,
      this.hint,
    ]);
    for (const child of [...this.root.list]) {
      if (!keep.has(child)) {
        child.destroy(true);
      }
    }
  }

  private makeEquipRow(slot: EquipSlot, item: RolledItem | undefined, y: number): Phaser.GameObjects.Container {
    const w = PANEL_W - 20;
    const bg = this.scene.add
      .rectangle(0, 0, w, SLOT_H, item ? 0x1e2a38 : 0x181e28, 0.95)
      .setStrokeStyle(1, item ? 0x5a7a9a : 0x333848, 0.9)
      .setInteractive({ useHandCursor: !!item });

    const label = SLOT_LABEL_ZH[slot];
    const name = item ? rarityPrefix(item) + item.nameZh : '（空）';
    const mods = item ? shortMods(item) : '';
    const text = this.scene.add
      .text(-w / 2 + 6, 0, `${label}  ${name}${mods ? '  ' + mods : ''}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: item ? rarityColor(item) : '#556677',
      })
      .setOrigin(0, 0.5);

    const action = this.scene.add
      .text(w / 2 - 6, 0, item ? '卸下' : '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffcc88',
      })
      .setOrigin(1, 0.5);

    const row = this.scene.add.container(-PANEL_W / 2 + 10 + w / 2, y + SLOT_H / 2, [
      bg,
      text,
      action,
    ]);

    if (item) {
      const hit = () => this.handlers.onUnequip(slot);
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        hit();
      });
      action.setInteractive({ useHandCursor: true });
      action.on('pointerdown', (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        hit();
      });
    }
    return row;
  }

  private makeBagRow(item: RolledItem, y: number): Phaser.GameObjects.Container {
    const w = PANEL_W - 20;
    const bg = this.scene.add
      .rectangle(0, 0, w, BAG_ROW_H, 0x1a222c, 0.95)
      .setStrokeStyle(1, 0x3a4858, 0.85)
      .setInteractive({ useHandCursor: true });

    const slotTag = SLOT_LABEL_ZH[item.slot];
    const text = this.scene.add
      .text(-w / 2 + 6, 0, `[${slotTag}] ${rarityPrefix(item)}${item.nameZh}  ${shortMods(item)}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: rarityColor(item),
      })
      .setOrigin(0, 0.5);

    const action = this.scene.add
      .text(w / 2 - 6, 0, '裝備', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#88ffaa',
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });

    const row = this.scene.add.container(-PANEL_W / 2 + 10 + w / 2, y + BAG_ROW_H / 2, [
      bg,
      text,
      action,
    ]);

    const hit = () => this.handlers.onEquip(item.uid);
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      hit();
    });
    action.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      hit();
    });
    return row;
  }
}

function rarityPrefix(item: RolledItem): string {
  if (item.rarity === 'rare') return '★';
  if (item.rarity === 'magic') return '◆';
  return '';
}

function rarityColor(item: RolledItem): string {
  if (item.rarity === 'rare') return '#ffd24a';
  if (item.rarity === 'magic') return '#88ccff';
  return '#d8e0e8';
}

function shortMods(item: RolledItem): string {
  const m = item.mods;
  const parts: string[] = [];
  if (m.damage) parts.push(`傷${m.damage > 0 ? '+' : ''}${m.damage}`);
  if (m.speed) parts.push(`速${m.speed > 0 ? '+' : ''}${m.speed}`);
  if (m.str) parts.push(`力${m.str > 0 ? '+' : ''}${m.str}`);
  if (m.maxHp) parts.push(`命${m.maxHp > 0 ? '+' : ''}${m.maxHp}`);
  return parts.length ? `(${parts.join(' ')})` : '';
}
