import { emptyMods, mergeMods, type ItemMods, type ItemSlot, type RolledItem } from '../data/loot/types';

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
    return `裝 +傷${m.damage} 速${fmtSigned(m.speed)} 力${fmtSigned(m.str)} 命${fmtSigned(m.maxHp)}`;
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
