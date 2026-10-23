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

const ROOT_ID = 'ss2-inventory-overlay';

/**
 * DOM inventory / equipment panel (HK Traditional Chinese).
 *
 * Same class of fix as GameOverDom / StageClearDom: real HTML buttons sit
 * outside Phaser input, so clicks work while arcade physics is soft-paused
 * and under Scale.FIT. Backdrop uses pointer-events:none so the touch 「包」
 * button on the canvas can still toggle the panel closed.
 *
 * Panel is shifted right so it does not clip the left skill/bag/mods HUD.
 * Bag list scrolls when there are many items.
 */
export class InventoryPanel {
  private handlers: InventoryPanelHandlers;
  private root: HTMLDivElement | null = null;
  private modsEl: HTMLDivElement | null = null;
  private equipEl: HTMLDivElement | null = null;
  private bagEl: HTMLDivElement | null = null;
  private visible = false;

  constructor(_scene: unknown, handlers: InventoryPanelHandlers) {
    this.handlers = handlers;
  }

  isOpen(): boolean {
    return this.visible;
  }

  open(inv: Inventory): void {
    this.ensureDom();
    this.visible = true;
    if (this.root) this.root.style.display = 'flex';
    this.refresh(inv);
    const w = window as Window & { __SS2_INVENTORY__?: object };
    w.__SS2_INVENTORY__ = {
      visible: true,
      close: () => this.handlers.onClose(),
      hide: () => this.close(),
    };
  }

  close(): void {
    this.visible = false;
    if (this.root) this.root.style.display = 'none';
    const w = window as Window & { __SS2_INVENTORY__?: { visible?: boolean } };
    if (w.__SS2_INVENTORY__) w.__SS2_INVENTORY__.visible = false;
  }

  toggle(inv: Inventory): void {
    if (this.visible) this.close();
    else this.open(inv);
  }

  refresh(inv: Inventory): void {
    if (!this.visible) return;
    this.ensureDom();
    if (this.modsEl) {
      const line = inv.modsHudLine();
      this.modsEl.textContent = line;
      this.modsEl.style.display = line ? 'block' : 'none';
    }
    this.renderEquip(inv);
    this.renderBag(inv);
  }

  destroy(): void {
    this.close();
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.modsEl = null;
    this.equipEl = null;
    this.bagEl = null;
    const w = window as Window & { __SS2_INVENTORY__?: unknown };
    delete w.__SS2_INVENTORY__;
  }

  private ensureDom(): void {
    if (this.root && document.body.contains(this.root)) return;

    const existing = document.getElementById(ROOT_ID);
    if (existing?.parentNode) existing.parentNode.removeChild(existing);

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('data-testid', 'inventory-overlay');
    // pointer-events:none so canvas touch 「包」 still receives taps.
    // padding-left clears the left Phaser HUD (HP / skill / bag / mods).
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99990',
      'display:none',
      'align-items:center',
      'justify-content:flex-end',
      'padding:12px max(12px, 3vw) 12px max(148px, 22vw)',
      'box-sizing:border-box',
      'background:rgba(0,0,0,0.45)',
      'pointer-events:none',
      'touch-action:manipulation',
      'user-select:none',
      '-webkit-user-select:none',
      'font-family:monospace,system-ui,sans-serif',
      'color:#e8f0ff',
    ].join(';');

    const panel = document.createElement('div');
    panel.setAttribute('data-testid', 'inventory-panel');
    panel.style.cssText = [
      'pointer-events:auto',
      'width:min(320px,92vw)',
      'max-height:min(340px,88vh)',
      'display:flex',
      'flex-direction:column',
      'overflow:hidden',
      'background:rgba(18,24,32,0.96)',
      'border:2px solid rgba(106,144,184,0.95)',
      'border-radius:8px',
      'padding:10px 12px 12px',
      'box-sizing:border-box',
      'box-shadow:0 8px 28px rgba(0,0,0,0.45)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-shrink:0;';

    const title = document.createElement('div');
    title.textContent = '背包／裝備';
    title.style.cssText = 'font-size:14px;color:#e8f0ff;';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '關閉';
    closeBtn.setAttribute('data-testid', 'inventory-close');
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.style.cssText = styleActionBtn('#2a3040', '#ffd0a0', true);
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.handlers.onClose();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const mods = document.createElement('div');
    mods.style.cssText = 'font-size:11px;color:#a8e0c0;margin-bottom:8px;flex-shrink:0;';

    const equip = document.createElement('div');
    equip.style.cssText = 'flex-shrink:0;';

    const bag = document.createElement('div');
    bag.style.cssText =
      'flex:1;min-height:0;display:flex;flex-direction:column;margin-top:4px;';

    const hint = document.createElement('div');
    hint.textContent = '點裝備欄卸下 · 點背包裝備 · I／Tab／包 關閉';
    hint.style.cssText = 'font-size:9px;color:#8899aa;margin-top:10px;flex-shrink:0;';

    panel.appendChild(header);
    panel.appendChild(mods);
    panel.appendChild(equip);
    panel.appendChild(bag);
    panel.appendChild(hint);

    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());

    root.appendChild(panel);
    document.body.appendChild(root);

    this.root = root;
    this.modsEl = mods;
    this.equipEl = equip;
    this.bagEl = bag;
  }

  private renderEquip(inv: Inventory): void {
    if (!this.equipEl) return;
    this.equipEl.replaceChildren();

    const heading = document.createElement('div');
    heading.textContent = '—— 裝備 ——';
    heading.style.cssText = 'font-size:10px;color:#9ab4d0;margin:4px 0 6px;';
    this.equipEl.appendChild(heading);

    for (const slot of SLOT_ORDER) {
      const item = inv.getEquipped(slot);
      this.equipEl.appendChild(this.makeEquipRow(slot, item));
    }
  }

  private renderBag(inv: Inventory): void {
    if (!this.bagEl) return;
    this.bagEl.replaceChildren();

    const bag = inv.getBag();
    const heading = document.createElement('div');
    heading.textContent = `—— 背包（${bag.length}）——`;
    heading.style.cssText = 'font-size:10px;color:#9ab4d0;margin:6px 0;flex-shrink:0;';
    this.bagEl.appendChild(heading);

    if (!bag.length) {
      const empty = document.createElement('div');
      const hasGear = SLOT_ORDER.some((s) => !!inv.getEquipped(s));
      empty.textContent = hasGear
        ? '（空）已裝備中 — 按「卸下」可放回背包再替換'
        : '（空）開寶箱或擊敗敵人取得裝備';
      empty.style.cssText = 'font-size:10px;color:#667788;padding:6px 2px;';
      this.bagEl.appendChild(empty);
        return;
    }

    const list = document.createElement('div');
    list.setAttribute('data-testid', 'inventory-bag-list');
    list.style.cssText = [
      'flex:1',
      'min-height:72px',
      'max-height:min(148px,32vh)',
      'overflow-y:auto',
      'overflow-x:hidden',
      '-webkit-overflow-scrolling:touch',
      'padding-right:2px',
    ].join(';');

    for (const item of bag) {
      list.appendChild(this.makeBagRow(item));
    }
    this.bagEl.appendChild(list);
  }

  private makeEquipRow(slot: EquipSlot, item: RolledItem | undefined): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'margin:0 0 5px',
      'padding:8px 10px',
      'min-height:34px',
      'box-sizing:border-box',
      'border-radius:5px',
      `background:${item ? '#1e2a38' : '#181e28'}`,
      `border:1px solid ${item ? '#5a7a9a' : '#333848'}`,
      item ? 'cursor:pointer' : 'cursor:default',
    ].join(';');
    row.setAttribute('data-testid', `inventory-equip-${slot}`);
    if (item) row.setAttribute('data-action', 'unequip');

    const label = SLOT_LABEL_ZH[slot];
    const name = item ? rarityPrefix(item) + item.nameZh : '（空）';
    const mods = item ? shortMods(item) : '';
    const text = document.createElement('div');
    text.textContent = `${label}  ${name}${mods ? '  ' + mods : ''}`;
    text.style.cssText = [
      'flex:1',
      'font-size:11px',
      `color:${item ? rarityColor(item) : '#556677'}`,
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
    ].join(';');

    row.appendChild(text);

    if (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '卸下';
      btn.setAttribute('data-testid', `inventory-unequip-${slot}`);
      btn.setAttribute('data-action', 'unequip');
      btn.style.cssText = styleActionBtn('#2a3040', '#ffcc88', true);
      const fire = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.handlers.onUnequip(slot);
      };
      btn.addEventListener('click', fire);
      row.addEventListener('click', fire);
      row.appendChild(btn);
    }

    return row;
  }

  private makeBagRow(item: RolledItem): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'margin:0 0 5px',
      'padding:8px 10px',
      'min-height:32px',
      'box-sizing:border-box',
      'border-radius:5px',
      'background:#1a222c',
      'border:1px solid #3a4858',
      'cursor:pointer',
    ].join(';');
    row.setAttribute('data-testid', `inventory-bag-${item.uid}`);
    row.setAttribute('data-action', 'equip');

    const slotTag = SLOT_LABEL_ZH[item.slot];
    const text = document.createElement('div');
    text.textContent = `[${slotTag}] ${rarityPrefix(item)}${item.nameZh}  ${shortMods(item)}`;
    text.style.cssText = [
      'flex:1',
      'font-size:11px',
      `color:${rarityColor(item)}`,
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
    ].join(';');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '裝備';
    btn.setAttribute('data-testid', `inventory-equip-btn-${item.uid}`);
    btn.setAttribute('data-action', 'equip');
    btn.style.cssText = styleActionBtn('#1a3a28', '#88ffaa', true);

    const fire = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.handlers.onEquip(item.uid);
    };
    btn.addEventListener('click', fire);
    row.addEventListener('click', fire);

    row.appendChild(text);
    row.appendChild(btn);
    return row;
  }
}

function styleActionBtn(bg: string, color: string, large = false): string {
  return [
    large ? 'font:12px monospace' : 'font:10px monospace',
    large ? 'padding:7px 12px' : 'padding:4px 8px',
    'min-height:28px',
    'cursor:pointer',
    'border-radius:5px',
    `background:${bg}`,
    `border:1px solid ${color}`,
    `color:${color}`,
    'pointer-events:auto',
    'touch-action:manipulation',
    'flex-shrink:0',
  ].join(';');
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
