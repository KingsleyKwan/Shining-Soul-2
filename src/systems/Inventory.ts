import { emptyMods, mergeMods, type ItemMods, type RolledItem } from '../data/loot/types';

/**
 * Phase 2 inventory stub: bag of rolled items + auto-equip best weapon.
 * Armor/accessories stack all mods; one weapon slot (highest damage, then str).
 */
export class Inventory {
  private readonly items: RolledItem[] = [];
  private equippedWeapon?: RolledItem;

  get size(): number {
    return this.items.length;
  }

  getAll(): readonly RolledItem[] {
    return this.items;
  }

  getEquippedWeapon(): RolledItem | undefined {
    return this.equippedWeapon;
  }

  /** @returns true if newly equipped as weapon */
  add(item: RolledItem): boolean {
    this.items.push(item);
    if (item.slot !== 'weapon') return false;
    const cur = this.equippedWeapon;
    if (
      !cur ||
      item.mods.damage > cur.mods.damage ||
      (item.mods.damage === cur.mods.damage && item.mods.str > cur.mods.str)
    ) {
      this.equippedWeapon = item;
      return true;
    }
    return false;
  }

  /** Aggregated gear mods (weapon + all armor/accessories). */
  getMods(): ItemMods {
    const parts: ItemMods[] = [];
    if (this.equippedWeapon) parts.push(this.equippedWeapon.mods);
    for (const it of this.items) {
      if (it.slot === 'weapon') continue;
      parts.push(it.mods);
    }
    if (!parts.length) return emptyMods();
    return mergeMods(...parts);
  }

  /** One-line HUD summary. */
  hudLine(): string {
    const n = this.items.length;
    const w = this.equippedWeapon;
    if (!w) return `Bag ${n}`;
    return `Bag ${n} · ${w.nameEn}`;
  }
}
