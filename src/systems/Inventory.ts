import {
  emptyMods,
  mergeMods,
  type ItemMods,
  type ItemRarity,
  type ItemSlot,
  type RolledItem,
} from '../data/loot/types';

export type EquipSlot = ItemSlot;

/**
 * Bag + one equipped item per slot (weapon / armor / accessory).
 * Pickup auto-equips when the matching slot is empty; otherwise the item goes to the bag.
 * Player can equip / unequip / swap via the inventory panel.
 */
export class Inventory {
  private readonly bag: RolledItem[] = [];
  private readonly equipped: Partial<Record<EquipSlot, RolledItem>> = {};

  get size(): number {
    return this.bag.length + this.equippedCount();
  }

  getBag(): readonly RolledItem[] {
    return this.bag;
  }

  /** All items (bag + equipped), for debug / counts. */
  getAll(): readonly RolledItem[] {
    const out: RolledItem[] = [...this.bag];
    for (const slot of SLOT_ORDER) {
      const it = this.equipped[slot];
      if (it) out.push(it);
    }
    return out;
  }

  getEquipped(slot: EquipSlot): RolledItem | undefined {
    return this.equipped[slot];
  }

  getEquippedWeapon(): RolledItem | undefined {
    return this.equipped.weapon;
  }

  /**
   * Add loot. Auto-equips into an empty matching slot.
   * @returns true if the item was auto-equipped
   */
  add(item: RolledItem): boolean {
    if (!this.equipped[item.slot]) {
      this.equipped[item.slot] = item;
      return true;
    }
    this.bag.push(item);
    return false;
  }

  /**
   * Equip a bag item into its slot. Previous equipped item (if any) returns to the bag.
   * @returns true on success
   */
  equipFromBag(uid: string): boolean {
    const idx = this.bag.findIndex((it) => it.uid === uid);
    if (idx < 0) return false;
    const item = this.bag[idx]!;
    const prev = this.equipped[item.slot];
    this.bag.splice(idx, 1);
    this.equipped[item.slot] = item;
    if (prev) this.bag.push(prev);
    return true;
  }

  /**
   * Unequip a slot; item returns to the bag.
   * @returns true if something was unequipped
   */
  unequip(slot: EquipSlot): boolean {
    const item = this.equipped[slot];
    if (!item) return false;
    delete this.equipped[slot];
    this.bag.push(item);
    return true;
  }

  /** Aggregated mods from currently equipped gear only. */
  getMods(): ItemMods {
    const parts: ItemMods[] = [];
    for (const slot of SLOT_ORDER) {
      const it = this.equipped[slot];
      if (it) parts.push(it.mods);
    }
    if (!parts.length) return emptyMods();
    return mergeMods(...parts);
  }

  /** Compact HUD line (HK Traditional Chinese preferred for names). */
  hudLine(): string {
    const n = this.bag.length;
    const w = this.equipped.weapon;
    const a = this.equipped.armor;
    const x = this.equipped.accessory;
    const bits: string[] = [`袋 ${n}`];
    if (w) bits.push(`武 ${w.nameZh}`);
    if (a) bits.push(`甲 ${a.nameZh}`);
    if (x) bits.push(`飾 ${x.nameZh}`);
    if (!w && !a && !x) bits.push('無裝備');
    return bits.join(' · ');
  }

  modsHudLine(): string {
    const m = this.getMods();
    const parts: string[] = [];
    if (m.damage) parts.push(`傷${fmtSigned(m.damage)}`);
    if (m.speed) parts.push(`速${fmtSigned(m.speed)}`);
    if (m.str) parts.push(`力${fmtSigned(m.str)}`);
    if (m.maxHp) parts.push(`命${fmtSigned(m.maxHp)}`);
    if (!parts.length) return '';
    return `裝 ${parts.join(' ')}`;
  }

  /** Snapshot for SaveManager. Copies so callers cannot mutate bag state. */
  toJSON(): { bag: RolledItem[]; equipped: Partial<Record<EquipSlot, RolledItem>> } {
    const equipped: Partial<Record<EquipSlot, RolledItem>> = {};
    for (const slot of SLOT_ORDER) {
      const it = this.equipped[slot];
      if (it) equipped[slot] = cloneRolledItem(it);
    }
    return {
      bag: this.bag.map(cloneRolledItem),
      equipped,
    };
  }

  /**
   * Rebuild from a save snapshot. Bad entries are skipped.
   * Does not use add() — that would auto-equip bag items into empty slots.
   * Any throw yields an empty inventory.
   */
  static fromJSON(data: unknown): Inventory {
    try {
      const inv = new Inventory();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return inv;
      const raw = data as { bag?: unknown; equipped?: unknown };
      const seen = new Set<string>();

      const equippedRaw = raw.equipped;
      if (equippedRaw && typeof equippedRaw === 'object' && !Array.isArray(equippedRaw)) {
        const eq = equippedRaw as Record<string, unknown>;
        for (const slot of SLOT_ORDER) {
          const item = sanitizeRolledItem(eq[slot]);
          if (!item || item.slot !== slot || seen.has(item.uid)) continue;
          seen.add(item.uid);
          inv.equipped[slot] = item;
        }
      }

      if (Array.isArray(raw.bag)) {
        for (const entry of raw.bag) {
          const item = sanitizeRolledItem(entry);
          if (!item || seen.has(item.uid)) continue;
          seen.add(item.uid);
          inv.bag.push(item);
        }
      }
      return inv;
    } catch {
      return new Inventory();
    }
  }

  private equippedCount(): number {
    let n = 0;
    for (const slot of SLOT_ORDER) if (this.equipped[slot]) n += 1;
    return n;
  }
}

export const SLOT_ORDER: EquipSlot[] = ['weapon', 'armor', 'accessory'];

export const SLOT_LABEL_ZH: Record<EquipSlot, string> = {
  weapon: '武器',
  armor: '防具',
  accessory: '飾品',
};

function fmtSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

const RARITIES = new Set<ItemRarity>(['common', 'magic', 'rare', 'legendary']);

function finiteMod(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Loose item check: require uid, slot, and a mods object. Other fields default. */
export function sanitizeRolledItem(value: unknown): RolledItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.uid !== 'string') return null;
  const uid = raw.uid.trim();
  if (!uid) return null;
  if (raw.slot !== 'weapon' && raw.slot !== 'armor' && raw.slot !== 'accessory') return null;
  if (!raw.mods || typeof raw.mods !== 'object' || Array.isArray(raw.mods)) return null;

  const modsRaw = raw.mods as Record<string, unknown>;
  const slot = raw.slot;
  const rarity: ItemRarity =
    typeof raw.rarity === 'string' && RARITIES.has(raw.rarity as ItemRarity)
      ? (raw.rarity as ItemRarity)
      : 'common';
  const baseId = typeof raw.baseId === 'string' ? raw.baseId : '';
  const nameEn = typeof raw.nameEn === 'string' && raw.nameEn ? raw.nameEn : baseId || 'Item';
  const nameZh = typeof raw.nameZh === 'string' && raw.nameZh ? raw.nameZh : '物品';

  const item: RolledItem = {
    uid,
    baseId,
    slot,
    rarity,
    nameEn,
    nameZh,
    mods: {
      damage: finiteMod(modsRaw.damage),
      speed: finiteMod(modsRaw.speed),
      str: finiteMod(modsRaw.str),
      maxHp: finiteMod(modsRaw.maxHp),
    },
  };
  if (typeof raw.weaponType === 'string' && raw.weaponType) item.weaponType = raw.weaponType;
  if (typeof raw.prefixId === 'string' && raw.prefixId) item.prefixId = raw.prefixId;
  if (typeof raw.suffixId === 'string' && raw.suffixId) item.suffixId = raw.suffixId;
  return item;
}

function cloneRolledItem(item: RolledItem): RolledItem {
  return {
    ...item,
    mods: { ...item.mods },
  };
}
