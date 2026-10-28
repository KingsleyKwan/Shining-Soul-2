import {
  rarityTagZh,
  type ItemMods,
  type ItemRarity,
  type RolledItem,
} from '../data/loot/types';
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
const STYLE_ID = 'ss2-inventory-styles';
const NARROW_MQ = '(max-width: 640px)';

type Selection =
  | { kind: 'bag'; uid: string }
  | { kind: 'equip'; slot: EquipSlot };

const RARITY_FULL_ZH: Record<ItemRarity, string> = {
  common: '普通',
  magic: '優良',
  rare: '稀有',
  legendary: '傳說',
};

/** Inventory-panel rarity colors (match approved mocks). */
const PANEL_RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#8aa0b8',
  magic: '#e8b84a',
  rare: '#ffd24a',
  legendary: '#ff8c3a',
};

const MOD_KEYS: Array<{ key: keyof ItemMods; label: string }> = [
  { key: 'damage', label: '傷' },
  { key: 'speed', label: '速' },
  { key: 'str', label: '力' },
  { key: 'maxHp', label: '命' },
];

/**
 * DOM inventory / equipment panel (HK Traditional Chinese).
 *
 * Redesign: two-line rows with attribute chips, tap-to-open detail card
 * (desktop: left of panel; narrow: expands under selected row), bottom-sheet
 * layout on small viewports. The dimmed backdrop captures pointers and
 * closes the panel, so touches cannot fall through onto R. I／Tab still
 * toggle through InputState.
 */
export class InventoryPanel {
  private handlers: InventoryPanelHandlers;
  private root: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private modsEl: HTMLDivElement | null = null;
  private equipEl: HTMLDivElement | null = null;
  private bagEl: HTMLDivElement | null = null;
  private desktopDetailHost: HTMLDivElement | null = null;
  private visible = false;
  private inv: Inventory | null = null;
  private selection: Selection | null = null;
  private onResize: (() => void) | null = null;

  constructor(_scene: unknown, handlers: InventoryPanelHandlers) {
    this.handlers = handlers;
  }

  isOpen(): boolean {
    return this.visible;
  }

  open(inv: Inventory): void {
    this.ensureDom();
    this.inv = inv;
    this.visible = true;
    if (this.root) this.root.style.display = 'flex';
    this.applyLayoutMode();
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
    this.selection = null;
    if (this.root) this.root.style.display = 'none';
    this.clearDesktopDetail();
    const w = window as Window & { __SS2_INVENTORY__?: { visible?: boolean } };
    if (w.__SS2_INVENTORY__) w.__SS2_INVENTORY__.visible = false;
  }

  toggle(inv: Inventory): void {
    if (this.visible) this.close();
    else this.open(inv);
  }

  refresh(inv: Inventory): void {
    if (!this.visible) return;
    this.inv = inv;
    this.ensureDom();
    if (this.modsEl) {
      const line = inv.modsHudLine();
      this.modsEl.textContent = line;
      this.modsEl.style.display = line ? 'block' : 'none';
    }
    this.pruneSelection(inv);
    this.renderEquip(inv);
    this.renderBag(inv);
    this.renderDetail(inv);
  }

  destroy(): void {
    this.close();
    if (this.onResize) {
      window.removeEventListener('resize', this.onResize);
      this.onResize = null;
    }
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.panelEl = null;
    this.modsEl = null;
    this.equipEl = null;
    this.bagEl = null;
    this.desktopDetailHost = null;
    this.inv = null;
    const w = window as Window & { __SS2_INVENTORY__?: unknown };
    delete w.__SS2_INVENTORY__;
  }

  private isNarrow(): boolean {
    return window.matchMedia(NARROW_MQ).matches;
  }

  private applyLayoutMode(): void {
    if (!this.root || !this.panelEl) return;
    const narrow = this.isNarrow();
    this.root.classList.toggle('ss2-inv-narrow', narrow);
    this.root.classList.toggle('ss2-inv-wide', !narrow);
    this.panelEl.classList.toggle('ss2-inv-sheet', narrow);
  }

  private pruneSelection(inv: Inventory): void {
    if (!this.selection) return;
    if (this.selection.kind === 'bag') {
      const uid = this.selection.uid;
      if (!inv.getBag().some((it) => it.uid === uid)) this.selection = null;
      return;
    }
    const slot = this.selection.slot;
    if (!inv.getEquipped(slot)) this.selection = null;
  }

  private ensureDom(): void {
    ensureStyles();
    if (this.root && document.body.contains(this.root)) return;

    const existing = document.getElementById(ROOT_ID);
    if (existing?.parentNode) existing.parentNode.removeChild(existing);

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'ss2-inv-root';
    root.setAttribute('data-testid', 'inventory-overlay');

    const panel = document.createElement('div');
    panel.className = 'ss2-inv-panel';
    panel.setAttribute('data-testid', 'inventory-panel');

    const handle = document.createElement('div');
    handle.className = 'ss2-inv-handle';
    handle.setAttribute('aria-hidden', 'true');

    const header = document.createElement('div');
    header.className = 'ss2-inv-head';

    const title = document.createElement('div');
    title.className = 'ss2-inv-title';
    title.textContent = '背包／裝備';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ss2-inv-btn-close';
    closeBtn.textContent = '關閉';
    closeBtn.setAttribute('data-testid', 'inventory-close');
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.handlers.onClose();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const mods = document.createElement('div');
    mods.className = 'ss2-inv-totals';

    const scroll = document.createElement('div');
    scroll.className = 'ss2-inv-scroll';

    const equip = document.createElement('div');
    equip.className = 'ss2-inv-equip';

    const bag = document.createElement('div');
    bag.className = 'ss2-inv-bag';

    scroll.appendChild(equip);
    scroll.appendChild(bag);

    const hint = document.createElement('div');
    hint.className = 'ss2-inv-footer';
    hint.textContent = '點列開詳情 · 點掣裝備／卸下 · 點空白／I／Tab 關閉';

    panel.appendChild(handle);
    panel.appendChild(header);
    panel.appendChild(mods);
    panel.appendChild(scroll);
    panel.appendChild(hint);

    const desktopDetailHost = document.createElement('div');
    desktopDetailHost.className = 'ss2-inv-desktop-detail-host';

    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());
    desktopDetailHost.addEventListener('pointerdown', (e) => e.stopPropagation());
    desktopDetailHost.addEventListener('click', (e) => e.stopPropagation());

    // Dimmed backdrop only — the panel and detail card stop propagation.
    root.addEventListener('pointerdown', (ev) => {
      if (ev.target !== root) return;
      ev.preventDefault();
      this.handlers.onClose();
    });

    root.appendChild(desktopDetailHost);
    root.appendChild(panel);
    document.body.appendChild(root);

    this.root = root;
    this.panelEl = panel;
    this.modsEl = mods;
    this.equipEl = equip;
    this.bagEl = bag;
    this.desktopDetailHost = desktopDetailHost;

    if (!this.onResize) {
      this.onResize = () => {
        if (!this.visible) return;
        this.applyLayoutMode();
        if (this.inv) this.renderDetail(this.inv);
      };
      window.addEventListener('resize', this.onResize);
    }
    this.applyLayoutMode();
  }

  private renderEquip(inv: Inventory): void {
    if (!this.equipEl) return;
    this.equipEl.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'ss2-inv-section-label';
    heading.textContent = '— 裝備 —';
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
    heading.className = 'ss2-inv-section-label';
    heading.textContent = `— 背包 (${bag.length}) —`;
    this.bagEl.appendChild(heading);

    if (!bag.length) {
      const empty = document.createElement('div');
      empty.className = 'ss2-inv-empty';
      const hasGear = SLOT_ORDER.some((s) => !!inv.getEquipped(s));
      empty.textContent = hasGear
        ? '（空）已裝備中 — 按「卸下」可放回背包再替換'
        : '（空）開寶箱或擊敗敵人取得裝備';
      this.bagEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'ss2-inv-bag-list';
    list.setAttribute('data-testid', 'inventory-bag-list');

    for (const item of bag) {
      const wrap = document.createElement('div');
      wrap.className = 'ss2-inv-bag-item-wrap';
      wrap.appendChild(this.makeBagRow(item));
      // Mobile inline detail mounts after the selected bag row.
      if (
        this.isNarrow() &&
        this.selection?.kind === 'bag' &&
        this.selection.uid === item.uid
      ) {
        wrap.appendChild(this.buildDetailCard(inv, item, 'bag'));
      }
      list.appendChild(wrap);
    }
    this.bagEl.appendChild(list);
  }

  private makeEquipRow(slot: EquipSlot, item: RolledItem | undefined): HTMLElement {
    const selected =
      this.selection?.kind === 'equip' && this.selection.slot === slot;

    const wrap = document.createElement('div');
    wrap.className = 'ss2-inv-equip-wrap';

    const row = document.createElement('div');
    row.className =
      'ss2-inv-row' +
      (item ? '' : ' ss2-inv-row-empty') +
      (selected ? ' ss2-inv-row-selected' : '');
    row.setAttribute('data-testid', `inventory-equip-${slot}`);
    if (item) row.setAttribute('data-action', 'select-equip');

    const body = document.createElement('div');
    body.className = 'ss2-inv-row-body';

    const line1 = document.createElement('div');
    line1.className = 'ss2-inv-line1';

    const slotTag = document.createElement('span');
    slotTag.className = 'ss2-inv-slot-tag';
    slotTag.textContent = SLOT_LABEL_ZH[slot];
    line1.appendChild(slotTag);
    line1.appendChild(document.createTextNode(' '));

    if (item) {
      const rarity = document.createElement('span');
      rarity.className = 'ss2-inv-rarity';
      rarity.style.color = PANEL_RARITY_COLOR[item.rarity];
      rarity.textContent = rarityTagZh(item.rarity);
      line1.appendChild(rarity);
      const name = document.createElement('span');
      name.className = 'ss2-inv-name';
      name.style.color = PANEL_RARITY_COLOR[item.rarity];
      name.textContent = item.nameZh;
      line1.appendChild(name);
    } else {
      const empty = document.createElement('span');
      empty.className = 'ss2-inv-empty-label';
      empty.textContent = '（空）';
      line1.appendChild(empty);
    }

    const line2 = document.createElement('div');
    line2.className = 'ss2-inv-line2';
    line2.textContent = item ? formatChips(item.mods) : '\u00a0';

    body.appendChild(line1);
    body.appendChild(line2);
    row.appendChild(body);

    if (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss2-inv-btn-act ss2-inv-btn-unequip';
      btn.textContent = '卸下';
      btn.setAttribute('data-testid', `inventory-unequip-${slot}`);
      btn.setAttribute('data-action', 'unequip');
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.handlers.onUnequip(slot);
      });
      row.appendChild(btn);

      body.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.select({ kind: 'equip', slot });
      });
      // Allow clicking padding of row (not button) to select.
      row.addEventListener('click', (ev) => {
        if (ev.target === btn || btn.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.select({ kind: 'equip', slot });
      });
    }

    wrap.appendChild(row);

    if (
      item &&
      this.isNarrow() &&
      this.selection?.kind === 'equip' &&
      this.selection.slot === slot &&
      this.inv
    ) {
      wrap.appendChild(this.buildDetailCard(this.inv, item, 'equip'));
    }

    return wrap;
  }

  private makeBagRow(item: RolledItem): HTMLElement {
    const selected =
      this.selection?.kind === 'bag' && this.selection.uid === item.uid;

    const row = document.createElement('div');
    row.className =
      'ss2-inv-row' + (selected ? ' ss2-inv-row-selected' : '');
    row.setAttribute('data-testid', `inventory-bag-${item.uid}`);
    row.setAttribute('data-action', 'select-bag');

    const body = document.createElement('div');
    body.className = 'ss2-inv-row-body';

    const line1 = document.createElement('div');
    line1.className = 'ss2-inv-line1';

    const rarity = document.createElement('span');
    rarity.className = 'ss2-inv-rarity';
    rarity.style.color = PANEL_RARITY_COLOR[item.rarity];
    rarity.textContent = rarityTagZh(item.rarity);
    line1.appendChild(rarity);

    const name = document.createElement('span');
    name.className = 'ss2-inv-name';
    name.style.color = PANEL_RARITY_COLOR[item.rarity];
    name.textContent = item.nameZh;
    line1.appendChild(name);
    line1.appendChild(document.createTextNode(' '));

    const slotTag = document.createElement('span');
    slotTag.className = 'ss2-inv-slot-tag';
    slotTag.textContent = `(${SLOT_LABEL_ZH[item.slot]})`;
    line1.appendChild(slotTag);

    const line2 = document.createElement('div');
    line2.className = 'ss2-inv-line2';
    line2.textContent = formatChips(item.mods) || '\u00a0';

    body.appendChild(line1);
    body.appendChild(line2);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ss2-inv-btn-act ss2-inv-btn-equip';
    btn.textContent = '裝備';
    btn.setAttribute('data-testid', `inventory-equip-btn-${item.uid}`);
    btn.setAttribute('data-action', 'equip');
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.handlers.onEquip(item.uid);
    });

    row.appendChild(body);
    row.appendChild(btn);

    row.addEventListener('click', (ev) => {
      if (ev.target === btn || btn.contains(ev.target as Node)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.select({ kind: 'bag', uid: item.uid });
    });

    return row;
  }

  private select(sel: Selection): void {
    if (
      this.selection &&
      ((sel.kind === 'bag' &&
        this.selection.kind === 'bag' &&
        this.selection.uid === sel.uid) ||
        (sel.kind === 'equip' &&
          this.selection.kind === 'equip' &&
          this.selection.slot === sel.slot))
    ) {
      // Toggle off if same row tapped again.
      this.selection = null;
    } else {
      this.selection = sel;
    }
    if (this.inv) {
      this.renderEquip(this.inv);
      this.renderBag(this.inv);
      this.renderDetail(this.inv);
    }
  }

  private clearDesktopDetail(): void {
    if (this.desktopDetailHost) this.desktopDetailHost.replaceChildren();
  }

  private renderDetail(inv: Inventory): void {
    this.clearDesktopDetail();
    if (!this.selection) return;

    // Narrow: detail is inlined during renderEquip/renderBag.
    if (this.isNarrow()) return;

    let item: RolledItem | undefined;
    let source: 'bag' | 'equip';
    if (this.selection.kind === 'bag') {
      const uid = this.selection.uid;
      item = inv.getBag().find((it) => it.uid === uid);
      source = 'bag';
    } else {
      item = inv.getEquipped(this.selection.slot);
      source = 'equip';
    }
    if (!item || !this.desktopDetailHost) return;

    const card = this.buildDetailCard(inv, item, source);
    card.classList.add('ss2-inv-detail-floating');
    this.desktopDetailHost.appendChild(card);
  }

  private buildDetailCard(
    inv: Inventory,
    item: RolledItem,
    source: 'bag' | 'equip',
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'ss2-inv-detail';
    card.setAttribute('data-testid', 'inventory-detail');

    const nameEl = document.createElement('div');
    nameEl.className = 'ss2-inv-detail-name';
    const raritySpan = document.createElement('span');
    raritySpan.style.color = PANEL_RARITY_COLOR[item.rarity];
    raritySpan.style.fontWeight = '700';
    raritySpan.textContent = rarityTagZh(item.rarity);
    nameEl.appendChild(raritySpan);
    const nameSpan = document.createElement('span');
    nameSpan.style.color = '#f0f4f8';
    nameSpan.textContent = item.nameZh;
    nameEl.appendChild(nameSpan);

    const meta = document.createElement('div');
    meta.className = 'ss2-inv-detail-meta';
    const rarityFull = document.createElement('span');
    rarityFull.style.color = PANEL_RARITY_COLOR[item.rarity];
    rarityFull.textContent = RARITY_FULL_ZH[item.rarity];
    meta.appendChild(document.createTextNode(SLOT_LABEL_ZH[item.slot]));
    meta.appendChild(sepDot());
    meta.appendChild(rarityFull);
    meta.appendChild(sepDot());
    meta.appendChild(document.createTextNode(source === 'bag' ? '背包' : '裝備'));

    const stats = document.createElement('div');
    stats.className = 'ss2-inv-detail-stats';
    stats.textContent = formatChips(item.mods) || '（無屬性）';

    card.appendChild(nameEl);
    card.appendChild(meta);
    card.appendChild(stats);

    // Compare vs currently equipped in same slot (for bag items, or when viewing
    // equipped show nothing useful — still show vs self empty skip).
    if (source === 'bag') {
      const current = inv.getEquipped(item.slot);
      card.appendChild(buildCompareBox(item, current));
    } else {
      // Viewing equipped item: no swap compare needed.
    }

    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'ss2-inv-detail-act';
    if (source === 'bag') {
      act.textContent = '裝備';
      act.setAttribute('data-action', 'equip');
      act.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.handlers.onEquip(item.uid);
      });
    } else {
      act.textContent = '卸下';
      act.classList.add('ss2-inv-detail-act-unequip');
      act.setAttribute('data-action', 'unequip');
      act.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.handlers.onUnequip(item.slot);
      });
    }
    card.appendChild(act);
    return card;
  }
}

function sepDot(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'ss2-inv-sep';
  s.textContent = '·';
  return s;
}

function fmtSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function formatChips(mods: ItemMods): string {
  const parts: string[] = [];
  for (const { key, label } of MOD_KEYS) {
    const v = mods[key];
    if (v) parts.push(`${label}${fmtSigned(v)}`);
  }
  return parts.join(' · ');
}

function buildCompareBox(
  candidate: RolledItem,
  current: RolledItem | undefined,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ss2-inv-vs';

  const title = document.createElement('div');
  const slotLabel = SLOT_LABEL_ZH[candidate.slot];
  if (current) {
    title.textContent = `對比目前${slotLabel}（${rarityTagZh(current.rarity)}${current.nameZh}）`;
  } else {
    title.textContent = `對比目前${slotLabel}（空）`;
  }
  box.appendChild(title);

  const curMods = current?.mods ?? { damage: 0, speed: 0, str: 0, maxHp: 0 };
  const deltas: HTMLElement[] = [];
  for (const { key, label } of MOD_KEYS) {
    const cand = candidate.mods[key];
    const cur = curMods[key];
    if (!cand && !cur) continue;
    const delta = cand - cur;
    const span = document.createElement('span');
    if (delta > 0) {
      span.className = 'ss2-inv-up';
      span.textContent = `${label} ${fmtSigned(delta)}↑`;
    } else if (delta < 0) {
      span.className = 'ss2-inv-down';
      span.textContent = `${label} ${fmtSigned(delta)}↓`;
    } else {
      span.className = 'ss2-inv-same';
      span.textContent = `${label} ${fmtSigned(delta)}`;
    }
    deltas.push(span);
  }

  if (deltas.length) {
    const line = document.createElement('div');
    line.className = 'ss2-inv-vs-line';
    deltas.forEach((el, i) => {
      if (i > 0) line.appendChild(document.createTextNode(' · '));
      line.appendChild(el);
    });
    box.appendChild(line);
  } else {
    const line = document.createElement('div');
    line.className = 'ss2-inv-vs-line';
    line.textContent = '無屬性變化';
    box.appendChild(line);
  }
  return box;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${ROOT_ID}.ss2-inv-root {
  position: fixed;
  inset: 0;
  z-index: 99990;
  display: none;
  align-items: stretch;
  justify-content: flex-end;
  padding: 24px max(16px, 2vw) 24px max(120px, 18vw);
  box-sizing: border-box;
  background: rgba(0,0,0,0.45);
  pointer-events: auto;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  font-family: system-ui, 'Noto Sans CJK TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;
  color: #d8e2ec;
}
#${ROOT_ID}.ss2-inv-narrow {
  padding: 0;
  align-items: flex-end;
  justify-content: stretch;
  background: rgba(0,0,0,0.5);
}
#${ROOT_ID} .ss2-inv-panel {
  pointer-events: auto;
  position: relative;
  width: min(360px, 92vw);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(18, 24, 32, 0.96);
  border: 1.5px solid #6a90b8;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(106,144,184,0.25);
  box-sizing: border-box;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-panel,
#${ROOT_ID} .ss2-inv-panel.ss2-inv-sheet {
  width: 100%;
  max-width: 100%;
  max-height: 90vh;
  height: 90vh;
  border-radius: 14px 14px 0 0;
  border-left: none;
  border-right: none;
  border-bottom: none;
  margin: 0;
}
#${ROOT_ID} .ss2-inv-handle {
  display: none;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(106,144,184,0.55);
  margin: 8px auto 4px;
  flex-shrink: 0;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-handle { display: block; }
#${ROOT_ID} .ss2-inv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(106,144,184,0.35);
  flex-shrink: 0;
}
#${ROOT_ID} .ss2-inv-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #e8f0f8;
}
#${ROOT_ID} .ss2-inv-btn-close {
  font-size: 12px;
  padding: 4px 10px;
  min-height: 28px;
  background: rgba(40,52,68,0.9);
  border: 1px solid #6a90b8;
  border-radius: 3px;
  color: #c8d8e8;
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-btn-close {
  font-size: 13px;
  padding: 8px 14px;
  min-height: 44px;
  border-radius: 6px;
}
#${ROOT_ID} .ss2-inv-totals {
  padding: 8px 12px;
  font-size: 12px;
  color: #a8c4dc;
  border-bottom: 1px solid rgba(106,144,184,0.25);
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}
#${ROOT_ID} .ss2-inv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 8px 10px 4px;
}
#${ROOT_ID} .ss2-inv-section-label {
  font-size: 11px;
  color: #7a9ab8;
  letter-spacing: 0.08em;
  margin: 6px 0 8px;
  text-align: center;
}
#${ROOT_ID} .ss2-inv-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 6px 6px;
  margin-bottom: 4px;
  background: rgba(28,36,48,0.85);
  border: 1px solid rgba(80,110,140,0.35);
  border-radius: 4px;
  min-height: 48px;
  box-sizing: border-box;
  cursor: pointer;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-row {
  padding: 10px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  min-height: 52px;
  gap: 8px;
}
#${ROOT_ID} .ss2-inv-row-empty {
  border-style: dashed;
  border-color: rgba(80,110,140,0.45);
  background: rgba(22,28,38,0.5);
  cursor: default;
}
#${ROOT_ID} .ss2-inv-row-selected {
  border-color: #8ab4d8;
  background: rgba(36,52,72,0.95);
  box-shadow: inset 0 0 0 1px rgba(138,180,216,0.35);
}
#${ROOT_ID} .ss2-inv-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
#${ROOT_ID} .ss2-inv-line1 {
  font-size: 12.5px;
  line-height: 1.35;
  color: #e4ecf4;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-line1 { font-size: 14px; }
#${ROOT_ID} .ss2-inv-rarity { font-weight: 700; }
#${ROOT_ID} .ss2-inv-slot-tag {
  color: #7a9ab8;
  font-size: 11px;
  margin-right: 2px;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-slot-tag { font-size: 12px; }
#${ROOT_ID} .ss2-inv-line2 {
  font-size: 11px;
  line-height: 1.3;
  color: #9ec0dc;
  font-family: ui-monospace, monospace;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-line2 { font-size: 12px; }
#${ROOT_ID} .ss2-inv-empty-label { color: #6a8098; font-size: 12px; }
#${ROOT_ID} .ss2-inv-empty {
  font-size: 10px;
  color: #667788;
  padding: 6px 2px;
}
#${ROOT_ID} .ss2-inv-btn-act {
  align-self: center;
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 10px;
  min-height: 28px;
  background: rgba(48,72,100,0.95);
  border: 1px solid #6a90b8;
  border-radius: 3px;
  color: #d0e0f0;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
}
#${ROOT_ID} .ss2-inv-btn-unequip {
  background: rgba(56,48,40,0.9);
  border-color: #a08060;
  color: #e8d0b0;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-btn-act {
  font-size: 13px;
  padding: 10px 14px;
  min-height: 44px;
  min-width: 64px;
  border-radius: 8px;
}
#${ROOT_ID} .ss2-inv-footer {
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(106,144,184,0.3);
  font-size: 10.5px;
  color: #6a849c;
  line-height: 1.4;
  flex-shrink: 0;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-footer {
  padding: 10px 14px 18px;
  font-size: 11px;
  text-align: center;
}
#${ROOT_ID} .ss2-inv-desktop-detail-host {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 2;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-desktop-detail-host { display: none; }
#${ROOT_ID} .ss2-inv-detail {
  pointer-events: auto;
  background: rgba(16,22,30,0.98);
  border: 1.5px solid #7aa0c8;
  border-radius: 6px;
  box-shadow: 0 10px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(122,160,200,0.3);
  padding: 12px 14px 14px;
  box-sizing: border-box;
}
#${ROOT_ID} .ss2-inv-detail-floating {
  position: absolute;
  right: calc(min(360px, 92vw) + max(16px, 2vw) + 16px);
  top: 28%;
  width: min(280px, calc(100vw - min(360px, 92vw) - 80px));
  max-width: 300px;
}
#${ROOT_ID} .ss2-inv-detail-floating::after {
  content: '';
  position: absolute;
  right: -8px;
  top: 36px;
  width: 0; height: 0;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 8px solid #7aa0c8;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-detail {
  margin-top: 4px;
  margin-bottom: 10px;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
#${ROOT_ID} .ss2-inv-detail-name {
  font-size: 14px;
  font-weight: 700;
  color: #f0f4f8;
  margin-bottom: 6px;
  line-height: 1.35;
  word-break: break-word;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-detail-name { font-size: 15px; }
#${ROOT_ID} .ss2-inv-detail-meta {
  font-size: 11.5px;
  color: #8aa8c0;
  margin-bottom: 8px;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-detail-meta { font-size: 12px; }
#${ROOT_ID} .ss2-inv-sep {
  margin: 0 4px;
  color: #5a7088;
}
#${ROOT_ID} .ss2-inv-detail-stats {
  font-size: 12.5px;
  color: #b8d4ec;
  font-family: ui-monospace, monospace;
  margin-bottom: 10px;
  line-height: 1.55;
  word-break: break-word;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-detail-stats { font-size: 13px; }
#${ROOT_ID} .ss2-inv-vs {
  font-size: 11.5px;
  color: #90a8bc;
  margin-bottom: 12px;
  padding: 6px 8px;
  background: rgba(28,40,52,0.8);
  border-radius: 3px;
  border: 1px solid rgba(80,110,140,0.3);
  line-height: 1.5;
  word-break: break-word;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-vs {
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
}
#${ROOT_ID} .ss2-inv-vs-line { margin-top: 4px; }
#${ROOT_ID} .ss2-inv-up { color: #6dca8a; font-weight: 700; }
#${ROOT_ID} .ss2-inv-down { color: #e07878; font-weight: 700; }
#${ROOT_ID} .ss2-inv-same { color: #8aa0b0; }
#${ROOT_ID} .ss2-inv-detail-act {
  display: block;
  width: 100%;
  text-align: center;
  font-size: 13px;
  padding: 8px 12px;
  background: rgba(52,80,112,0.95);
  border: 1px solid #7aa0c8;
  border-radius: 4px;
  color: #e8f0f8;
  font-weight: 700;
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
}
#${ROOT_ID} .ss2-inv-detail-act-unequip {
  background: rgba(56,48,40,0.95);
  border-color: #a08060;
  color: #e8d0b0;
}
#${ROOT_ID}.ss2-inv-narrow .ss2-inv-detail-act {
  font-size: 15px;
  padding: 12px;
  min-height: 48px;
  border-radius: 8px;
}
#${ROOT_ID} .ss2-inv-bag-item-wrap,
#${ROOT_ID} .ss2-inv-equip-wrap {
  display: block;
}
`;
  document.head.appendChild(style);
}
