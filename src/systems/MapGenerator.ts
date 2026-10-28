/**
 * Runtime one-stage dungeon.
 *
 * Grows a connected 4-room graph (entry → combat, then chest and boss on two
 * other sides of combat), stamps 48×32 shells, and emits Tiled JSON Phaser
 * can load with tileset key `dungeon-tiles`. Door lanes stay open: a cross
 * of floor is never decorated, and openings are cut last.
 * Invalid graphs retry with seed+1 (cap 40).
 *
 * GIDs match tools/make_dungeon_map.py:
 * 1 void, 2 floorA, 3 floorB, 4 wall, 5 wall-top, 6 pillar, 7 door.
 */

export type RoomId = 'a' | 'c' | 'b' | 'boss';

/** Ground pattern. Checker is the stock fort; stripe / dense read as another stage. */
export type FloorStyle = 'checker' | 'stripe' | 'dense';

export type DungeonOptions = {
  /** Multiplier on Paste HP (ceil). Default 1. */
  pasteHpScale?: number;
  /**
   * Extra Pastes per room that already has Pastes. Placement tries base+bonus
   * first, then falls back to the base count so layouts stay clearable.
   */
  pasteCountBonus?: number;
  /**
   * Pillar / wall-stub multiplier. 1 matches the stock fort rolls.
   * Clamped to 0.5–1.6. The door cross is never decorated.
   */
  propDensity?: number;
  /** Floor pattern. Default checker. Boss rooms keep a distinct motif per style. */
  floorStyle?: FloorStyle;
};

export type GeneratedDungeon = {
  seed: number;
  tiled: object;
  rooms: Record<RoomId, { x: number; y: number; w: number; h: number }>;
};

const TILE = 16;
const ROOM_W = 48;
const ROOM_H = 32;
const MAX_TRIES = 40;

/** Paste aggro is 150px; boss aggro is 200px. Match the Python map tool. */
const PASTE_AGGRO = 150;
const BOSS_AGGRO = 200;
const PASTE_SPAWN_GAP = 8;
const BOSS_SPAWN_GAP = 16;
/** GameScene grows each door trigger by 24px (12px per side). */
const DOOR_PAD = 12;

const GID = {
  void: 1,
  floorA: 2,
  floorB: 3,
  wall: 4,
  wallTop: 5,
  pillar: 6,
  door: 7,
} as const;

const ROOM_IDS: readonly RoomId[] = ['a', 'c', 'b', 'boss'];

const PROP_NAME: Record<RoomId, string> = {
  a: 'roomA',
  c: 'roomC',
  b: 'roomB',
  boss: 'roomBoss',
};

const PASTE_HP: Record<RoomId, number> = { a: 2, c: 3, b: 2, boss: 3 };
const PASTE_COUNT: Record<RoomId, number> = { a: 1, c: 3, b: 1, boss: 0 };

type Side = 'n' | 'e' | 's' | 'w';

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

const DIR: Record<Side, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
};

const OPP: Record<Side, Side> = { n: 's', e: 'w', s: 'n', w: 'e' };

const SIDE_NAME: Record<Side, string> = {
  n: 'north',
  e: 'east',
  s: 'south',
  w: 'west',
};

/** Arrival tile, local to the room, a few tiles inside that side's door. */
const ARRIVAL: Record<Side, { lx: number; ly: number }> = {
  e: { lx: 40, ly: 15 },
  w: { lx: 8, ly: 15 },
  s: { lx: 22, ly: 21 },
  n: { lx: 22, ly: 10 },
};

/** Player stands on the open cross, opposite the only entry door. */
const PLAYER_AT: Record<Side, { lx: number; ly: number }> = {
  e: { lx: 10, ly: 16 },
  w: { lx: 38, ly: 16 },
  s: { lx: 22, ly: 6 },
  n: { lx: 22, ly: 26 },
};

/** Boss stands on the cross, outside ~200px aggro of the arrival. */
const BOSS_AT: Record<Side, { lx: number; ly: number }> = {
  w: { lx: 42, ly: 15 },
  e: { lx: 6, ly: 15 },
  n: { lx: 22, ly: 27 },
  s: { lx: 22, ly: 6 },
};

const EXIT_AT: Record<Side, { lx: number; ly: number }> = {
  w: { lx: 22, ly: 8 },
  e: { lx: 22, ly: 8 },
  n: { lx: 40, ly: 16 },
  s: { lx: 40, ly: 16 },
};

const CHEST_AT: Record<Side, { lx: number; ly: number }> = {
  n: { lx: 36, ly: 16 },
  s: { lx: 36, ly: 16 },
  e: { lx: 22, ly: 26 },
  w: { lx: 22, ly: 26 },
};

/** Quadrants sit off the door cross so stubs cannot seal a lane. */
const QUADS = [
  { x0: 4, y0: 4, x1: 17, y1: 11 },
  { x0: 28, y0: 4, x1: 43, y1: 11 },
  { x0: 4, y0: 21, x1: 17, y1: 28 },
  { x0: 28, y0: 21, x1: 43, y1: 28 },
] as const;

type Cell = { x: number; y: number };

type SpawnKind = 'player' | 'spawn' | 'enemy' | 'chest' | 'boss' | 'exit' | 'door';

type Spawn = {
  name: string;
  kind: SpawnKind;
  /** Room the object sits in. Doors use this as the trigger room. */
  room: RoomId;
  dest?: RoomId;
  target?: string;
  tx: number;
  ty: number;
  w: number;
  h: number;
  hp?: number;
};

type TiledProperty = {
  name: string;
  type: 'string' | 'int' | 'bool';
  value: string | number | boolean;
};

type Attempt =
  | { ok: true; dungeon: GeneratedDungeon }
  | { ok: false; error: string };

export function generateDungeon(seed?: number, options?: DungeonOptions): GeneratedDungeon {
  const base =
    seed === undefined || !Number.isFinite(seed)
      ? Math.floor(Math.random() * 0x7fffffff)
      : seed >>> 0;
  const opts = normalizeOptions(options);
  let lastError = 'unknown';
  for (let i = 0; i < MAX_TRIES; i++) {
    const next = (base + i) >>> 0;
    const attempt = tryGenerate(next, opts);
    if (attempt.ok) return attempt.dungeon;
    lastError = attempt.error;
  }
  throw new Error(
    `generateDungeon: no valid layout in ${MAX_TRIES} tries from seed ${base} (${lastError})`,
  );
}

type NormalizedOptions = {
  pasteHpScale: number;
  pasteCountBonus: number;
  propDensity: number;
  floorStyle: FloorStyle;
};

function normalizeOptions(options?: DungeonOptions): NormalizedOptions {
  const scale =
    options?.pasteHpScale !== undefined && Number.isFinite(options.pasteHpScale) && options.pasteHpScale > 0
      ? options.pasteHpScale
      : 1;
  const bonusRaw = options?.pasteCountBonus;
  const bonus =
    typeof bonusRaw === 'number' && Number.isFinite(bonusRaw) && bonusRaw > 0
      ? Math.floor(bonusRaw)
      : 0;
  const densityRaw = options?.propDensity;
  const propDensity =
    typeof densityRaw === 'number' && Number.isFinite(densityRaw)
      ? Math.min(1.6, Math.max(0.5, densityRaw))
      : 1;
  const style = options?.floorStyle;
  const floorStyle: FloorStyle =
    style === 'stripe' || style === 'dense' || style === 'checker' ? style : 'checker';
  return { pasteHpScale: scale, pasteCountBonus: bonus, propDensity, floorStyle };
}

function scaledPasteHp(room: RoomId, scale: number): number {
  return Math.max(1, Math.ceil(PASTE_HP[room] * scale));
}

function tryGenerate(seed: number, opts: NormalizedOptions): Attempt {
  const rng = mulberry32(seed);
  const cells = layoutRooms(rng);
  if (!cells) return { ok: false, error: 'could not place rooms' };

  const keys = ROOM_IDS.map((id) => `${cells[id].x},${cells[id].y}`);
  if (new Set(keys).size !== ROOM_IDS.length) {
    return { ok: false, error: 'overlapping rooms' };
  }

  let maxX = 0;
  let maxY = 0;
  for (const id of ROOM_IDS) {
    maxX = Math.max(maxX, cells[id].x);
    maxY = Math.max(maxY, cells[id].y);
  }
  const mapW = (maxX + 1) * ROOM_W;
  const mapH = (maxY + 1) * ROOM_H;
  const ground = new Array<number>(mapW * mapH).fill(GID.void);
  const walls = new Array<number>(mapW * mapH).fill(0);

  const rooms = {} as GeneratedDungeon['rooms'];
  for (const id of ROOM_IDS) {
    const cell = cells[id];
    rooms[id] = {
      x: cell.x * ROOM_W * TILE,
      y: cell.y * ROOM_H * TILE,
      w: ROOM_W * TILE,
      h: ROOM_H * TILE,
    };
    const phase = Math.floor(rng() * (id === 'boss' ? 3 : 2));
    fillRoomShell(ground, walls, mapW, cell, opts.floorStyle, phase, id === 'boss');
  }

  for (const id of ROOM_IDS) {
    paintDecor(rng, id, cells[id], walls, mapW, opts.propDensity);
  }

  const links: { from: RoomId; to: RoomId; side: Side }[] = [];
  const pairs: [RoomId, RoomId][] = [
    ['a', 'c'],
    ['c', 'b'],
    ['c', 'boss'],
  ];
  for (const [from, to] of pairs) {
    const side = sideBetween(cells[from], cells[to]);
    if (!side) return { ok: false, error: `${from} is not adjacent to ${to}` };
    links.push({ from, to, side });
    cutDoor(ground, walls, mapW, cells[from], side, cells[to]);
  }

  const objects: Spawn[] = [];
  const entrySide = links.find((l) => l.from === 'a')?.side;
  if (!entrySide) return { ok: false, error: 'entry has no door' };
  const playerAt = PLAYER_AT[entrySide];
  objects.push({
    name: 'player',
    kind: 'player',
    room: 'a',
    ...worldTile(cells.a, playerAt.lx, playerAt.ly),
    w: 1,
    h: 1,
  });

  for (const link of links) {
    objects.push(makeDoor(cells, link.from, link.to, link.side));
    objects.push(makeDoor(cells, link.to, link.from, OPP[link.side]));
    objects.push(makeArrival(cells, link.from, link.side));
    objects.push(makeArrival(cells, link.to, OPP[link.side]));
  }

  const chestLink = links.find((l) => l.to === 'b' || l.from === 'b');
  const bossLink = links.find((l) => l.to === 'boss' || l.from === 'boss');
  if (!chestLink || !bossLink) return { ok: false, error: 'missing chest or boss link' };
  const chestSide: Side = chestLink.to === 'b' ? OPP[chestLink.side] : chestLink.side;
  const bossSide: Side = bossLink.to === 'boss' ? OPP[bossLink.side] : bossLink.side;

  const chestAt = CHEST_AT[chestSide];
  objects.push({
    name: 'chest',
    kind: 'chest',
    room: 'b',
    ...worldTile(cells.b, chestAt.lx, chestAt.ly),
    w: 1,
    h: 1,
  });
  const bossAt = BOSS_AT[bossSide];
  objects.push({
    name: 'boss',
    kind: 'boss',
    room: 'boss',
    ...worldTile(cells.boss, bossAt.lx, bossAt.ly),
    w: 1,
    h: 1,
  });
  const exitAt = EXIT_AT[bossSide];
  objects.push({
    name: 'exit',
    kind: 'exit',
    room: 'boss',
    ...worldTile(cells.boss, exitAt.lx, exitAt.ly),
    w: 1,
    h: 1,
  });

  for (const id of ROOM_IDS) {
    const baseWant = PASTE_COUNT[id];
    if (baseWant <= 0) continue;
    const hp = scaledPasteHp(id, opts.pasteHpScale);
    const wantBonus = baseWant + opts.pasteCountBonus;
    let placed = placePastes(rng, id, cells[id], wantBonus, objects, walls, mapW, hp);
    if (placed.length < wantBonus && opts.pasteCountBonus > 0) {
      placed = placePastes(rng, id, cells[id], baseWant, objects, walls, mapW, hp);
    }
    if (placed.length < baseWant) {
      return { ok: false, error: `not enough safe tiles for ${id} pastes` };
    }
    objects.push(...placed);
  }

  const roomCells = new Set(ROOM_IDS.map((id) => `${cells[id].x},${cells[id].y}`));
  const problem = validate(objects, walls, mapW, mapH, roomCells);
  if (problem) return { ok: false, error: problem };

  const tiled = emitTiled(seed, ground, walls, mapW, mapH, rooms, objects);
  return { ok: true, dungeon: { seed, tiled, rooms } };
}

function layoutRooms(rng: () => number): Record<RoomId, Cell> | null {
  const a: Cell = { x: 0, y: 0 };
  const combatSide = shuffle(SIDES, rng)[0];
  const c: Cell = { x: DIR[combatSide].dx, y: DIR[combatSide].dy };
  const occupied = new Set([cellKey(a), cellKey(c)]);
  const free = SIDES.filter((side) => {
    const n = { x: c.x + DIR[side].dx, y: c.y + DIR[side].dy };
    return !occupied.has(cellKey(n));
  });
  if (free.length < 2) return null;
  const picked = shuffle(free, rng);
  const b: Cell = { x: c.x + DIR[picked[0]].dx, y: c.y + DIR[picked[0]].dy };
  const boss: Cell = { x: c.x + DIR[picked[1]].dx, y: c.y + DIR[picked[1]].dy };
  const cells: Record<RoomId, Cell> = { a, c, b, boss };
  let minX = 0;
  let minY = 0;
  for (const id of ROOM_IDS) {
    minX = Math.min(minX, cells[id].x);
    minY = Math.min(minY, cells[id].y);
  }
  for (const id of ROOM_IDS) {
    cells[id] = { x: cells[id].x - minX, y: cells[id].y - minY };
  }
  return cells;
}

/** floorA when true. Checker + boss matches the original shell exactly. */
function floorIsA(style: FloorStyle, x: number, y: number, phase: number, boss: boolean): boolean {
  if (style === 'checker') {
    return boss ? (x * 2 + y + phase) % 3 === 0 : (x + y + phase) % 2 === 0;
  }
  if (style === 'stripe') {
    // Vertical bands in the arena, horizontal bands in the corridors.
    return boss ? Math.floor((x + phase) / 2) % 2 === 0 : Math.floor((y + phase) / 2) % 2 === 0;
  }
  return boss ? (x + y * 2 + phase) % 3 !== 1 : (x * 3 + y * 2 + phase) % 4 === 0;
}

function fillRoomShell(
  ground: number[],
  walls: number[],
  mapW: number,
  cell: Cell,
  floor: FloorStyle,
  phase: number,
  boss: boolean,
): void {
  const x0 = cell.x * ROOM_W;
  const y0 = cell.y * ROOM_H;
  const x1 = x0 + ROOM_W - 1;
  const y1 = y0 + ROOM_H - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      ground[y * mapW + x] = floorIsA(floor, x, y, phase, boss) ? GID.floorA : GID.floorB;
    }
  }
  // Top lip is two tiles (cap + inner) so a vertical door must clear both.
  for (let x = x0; x <= x1; x++) {
    walls[y0 * mapW + x] = GID.wallTop;
    walls[(y0 + 1) * mapW + x] = GID.wall;
    walls[y1 * mapW + x] = GID.wall;
    ground[y0 * mapW + x] = GID.void;
    ground[y1 * mapW + x] = GID.void;
  }
  for (let y = y0; y <= y1; y++) {
    walls[y * mapW + x0] = GID.wall;
    walls[y * mapW + x1] = GID.wall;
    ground[y * mapW + x0] = GID.void;
    ground[y * mapW + x1] = GID.void;
  }
}

function paintStub(
  rng: () => number,
  quad: (typeof QUADS)[number],
  len: number,
  horizontal: boolean,
  put: (lx: number, ly: number, gid: number) => void,
): void {
  if (horizontal) {
    const span = quad.x1 - quad.x0 - len + 1;
    if (span >= 0) {
      const x = quad.x0 + Math.floor(rng() * (span + 1));
      const y = quad.y0 + Math.floor(rng() * (quad.y1 - quad.y0 + 1));
      for (let i = 0; i < len; i++) put(x + i, y, GID.wall);
    }
  } else {
    const span = quad.y1 - quad.y0 - len + 1;
    if (span >= 0) {
      const y = quad.y0 + Math.floor(rng() * (span + 1));
      const x = quad.x0 + Math.floor(rng() * (quad.x1 - quad.x0 + 1));
      for (let i = 0; i < len; i++) put(x, y + i, GID.wall);
    }
  }
}

function paintDecor(
  rng: () => number,
  room: RoomId,
  cell: Cell,
  walls: number[],
  mapW: number,
  density: number,
): void {
  const ox = cell.x * ROOM_W;
  const oy = cell.y * ROOM_H;
  const put = (lx: number, ly: number, gid: number) => {
    if (lx < 3 || ly < 3 || lx > ROOM_W - 4 || ly > ROOM_H - 4) return;
    if (onCross(lx, ly)) return;
    walls[(oy + ly) * mapW + (ox + lx)] = gid;
  };
  for (const quad of QUADS) {
    // Density 1 consumes the same single pillar roll as the stock fort.
    let pillars =
      room === 'boss'
        ? 1 + (rng() < Math.min(0.95, 0.55 * density) ? 1 : 0)
        : rng() < Math.min(0.95, 0.75 * density)
          ? 1
          : 0;
    if (density > 1.05 && rng() < (density - 1) * (room === 'boss' ? 0.85 : 0.9)) pillars += 1;
    if (room !== 'boss' && density > 1.25 && rng() < (density - 1.2) * 0.8) pillars += 1;
    pillars = Math.min(3, pillars);
    for (let i = 0; i < pillars; i++) {
      const lx = quad.x0 + Math.floor(rng() * (quad.x1 - quad.x0 + 1));
      const ly = quad.y0 + Math.floor(rng() * (quad.y1 - quad.y0 + 1));
      put(lx, ly, GID.pillar);
    }
    const stubP = Math.min(0.9, 0.5 * density);
    if (rng() < stubP) {
      // Same draw order as the stock fort. Extra length only rolls above density 1.2.
      const horizontal = rng() < 0.5;
      const len = 3 + Math.floor(rng() * 3) + (density > 1.2 && rng() < 0.4 ? 1 : 0);
      paintStub(rng, quad, len, horizontal, put);
    }
    if (density > 1.15 && rng() < (density - 1) * 0.55) {
      const horizontal = rng() < 0.5;
      const len = 2 + Math.floor(rng() * 2);
      paintStub(rng, quad, len, horizontal, put);
    }
  }
}

function cutDoor(
  ground: number[],
  walls: number[],
  mapW: number,
  from: Cell,
  side: Side,
  to: Cell,
): void {
  if (side === 'e' || side === 'w') {
    const west = side === 'e' ? from : to;
    const east = side === 'e' ? to : from;
    const xWest = west.x * ROOM_W + ROOM_W - 1;
    const xEast = east.x * ROOM_W;
    const y0 = west.y * ROOM_H + 14;
    for (const x of [xWest, xEast]) {
      for (let y = y0; y < y0 + 4; y++) {
        walls[y * mapW + x] = 0;
        ground[y * mapW + x] = GID.door;
      }
    }
    return;
  }
  const north = side === 's' ? from : to;
  const south = side === 's' ? to : from;
  const x0 = north.x * ROOM_W + 22;
  const ys = [
    north.y * ROOM_H + ROOM_H - 1,
    south.y * ROOM_H,
    south.y * ROOM_H + 1,
  ];
  for (const x of [x0, x0 + 1]) {
    for (const y of ys) {
      walls[y * mapW + x] = 0;
      ground[y * mapW + x] = GID.door;
    }
  }
}

function makeDoor(cells: Record<RoomId, Cell>, from: RoomId, to: RoomId, side: Side): Spawn {
  const rect = doorRect(cells[from], side);
  return {
    name: `door_${from}_to_${to}`,
    kind: 'door',
    room: from,
    dest: to,
    target: arrivalName(to, OPP[side]),
    ...rect,
  };
}

function makeArrival(cells: Record<RoomId, Cell>, room: RoomId, side: Side): Spawn {
  const at = ARRIVAL[side];
  return {
    name: arrivalName(room, side),
    kind: 'spawn',
    room,
    ...worldTile(cells[room], at.lx, at.ly),
    w: 1,
    h: 1,
  };
}

function arrivalName(room: RoomId, side: Side): string {
  return `spawn_${room}_${SIDE_NAME[side]}`;
}

function doorRect(cell: Cell, side: Side): { tx: number; ty: number; w: number; h: number } {
  const ox = cell.x * ROOM_W;
  const oy = cell.y * ROOM_H;
  switch (side) {
    case 'e':
      return { tx: ox + ROOM_W - 3, ty: oy + 14, w: 3, h: 4 };
    case 'w':
      return { tx: ox, ty: oy + 14, w: 3, h: 4 };
    case 's':
      return { tx: ox + 21, ty: oy + ROOM_H - 4, w: 3, h: 4 };
    case 'n':
      return { tx: ox + 21, ty: oy, w: 3, h: 3 };
  }
}

function placePastes(
  rng: () => number,
  room: RoomId,
  cell: Cell,
  want: number,
  existing: Spawn[],
  walls: number[],
  mapW: number,
  hp: number,
): Spawn[] {
  const ox = cell.x * ROOM_W;
  const oy = cell.y * ROOM_H;
  const candidates: { tx: number; ty: number }[] = [];
  for (const quad of QUADS) {
    for (let ly = quad.y0; ly <= quad.y1; ly++) {
      for (let lx = quad.x0; lx <= quad.x1; lx++) {
        const tx = ox + lx;
        const ty = oy + ly;
        if (walls[ty * mapW + tx] !== 0) continue;
        if (!pasteClear(tx, ty, room, existing)) continue;
        candidates.push({ tx, ty });
      }
    }
  }
  const order = shuffle(candidates, rng);
  if (order.length < want) return [];
  for (const sep of [96, 64, 32, 0]) {
    const picked: { tx: number; ty: number }[] = [];
    for (const tile of order) {
      if (sep > 0 && picked.some((other) => distTiles(tile, other) < sep)) continue;
      picked.push(tile);
      if (picked.length === want) {
        return picked.map((tile, index) => ({
          name: `enemy_${room}${index + 1}`,
          kind: 'enemy' as const,
          room,
          tx: tile.tx,
          ty: tile.ty,
          w: 1,
          h: 1,
          hp,
        }));
      }
    }
  }
  return [];
}

function pasteClear(tx: number, ty: number, room: RoomId, existing: Spawn[]): boolean {
  const here = centerOf({ tx, ty, w: 1, h: 1 });
  for (const spawn of existing) {
    if (spawn.room !== room) continue;
    if (spawn.kind !== 'player' && spawn.kind !== 'spawn') continue;
    if (distPoints(here, centerOf(spawn)) < PASTE_AGGRO + PASTE_SPAWN_GAP) return false;
  }
  for (const door of existing) {
    if (door.kind !== 'door' || door.room !== room) continue;
    const rect = paddedBounds(door, DOOR_PAD);
    if (distToRect(here.x, here.y, rect) < PASTE_AGGRO) return false;
  }
  return true;
}

function validate(
  objects: Spawn[],
  walls: number[],
  mapW: number,
  mapH: number,
  roomCells: Set<string>,
): string | null {
  const byName = new Map<string, Spawn>();
  for (const obj of objects) {
    if (byName.has(obj.name)) return `duplicate object ${obj.name}`;
    byName.set(obj.name, obj);
  }

  const blocked = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return true;
    return walls[ty * mapW + tx] !== 0;
  };

  const bodies = objects.filter((obj) => obj.kind !== 'door');
  const seenTiles = new Set<string>();
  for (const obj of bodies) {
    const tile = tileOf(obj);
    if (blocked(tile.tx, tile.ty)) return `${obj.name} is inside a wall at ${tile.tx},${tile.ty}`;
    const key = `${tile.tx},${tile.ty}`;
    if (seenTiles.has(key)) return `${obj.name} shares a tile with another spawn`;
    seenTiles.add(key);
    const cell = `${Math.floor(tile.tx / ROOM_W)},${Math.floor(tile.ty / ROOM_H)}`;
    if (!roomCells.has(cell)) return `${obj.name} sits outside the rooms`;
  }

  const doors = objects.filter((obj) => obj.kind === 'door');
  for (const door of doors) {
    if (!door.dest || !door.target) return `${door.name} is missing a target`;
    if (!ROOM_IDS.includes(door.dest)) return `${door.name} has a bad room`;
    const dest = byName.get(door.target);
    if (!dest) return `${door.name} target ${door.target} is missing`;
    if (dest.room !== door.dest) return `${door.target} is not in room ${door.dest}`;
    const center = centerOf(dest);
    const rect = paddedBounds(door, DOOR_PAD);
    if (pointInRect(center.x, center.y, rect)) {
      return `${door.target} sits inside ${door.name}`;
    }
  }

  // Arrival and the player must stand clear of every trigger in their own room,
  // including the return door, or a teleport ping-pongs.
  const spawns = objects.filter((obj) => obj.kind === 'player' || obj.kind === 'spawn');
  for (const spawn of spawns) {
    const at = centerOf(spawn);
    for (const door of doors) {
      if (door.room !== spawn.room) continue;
      if (pointInRect(at.x, at.y, paddedBounds(door, DOOR_PAD))) {
        return `${spawn.name} sits inside ${door.name}`;
      }
    }
  }

  for (const enemy of objects.filter((obj) => obj.kind === 'enemy')) {
    const at = centerOf(enemy);
    for (const spawn of spawns) {
      if (spawn.room !== enemy.room) continue;
      const gap = distPoints(at, centerOf(spawn));
      if (gap < PASTE_AGGRO + PASTE_SPAWN_GAP) {
        return `${enemy.name} aggro-overlaps ${spawn.name} (${gap.toFixed(0)}px)`;
      }
    }
    for (const door of doors) {
      if (door.room !== enemy.room) continue;
      const gap = distToRect(at.x, at.y, paddedBounds(door, DOOR_PAD));
      if (gap < PASTE_AGGRO) {
        return `${enemy.name} aggro-overlaps ${door.name} (${gap.toFixed(0)}px)`;
      }
    }
  }

  const boss = byName.get('boss');
  const exit = byName.get('exit');
  const chest = byName.get('chest');
  const player = byName.get('player');
  if (!boss || !exit || !chest || !player) return 'missing player, chest, boss, or exit';
  if (player.room === boss.room) return 'player and boss share a room';
  if (chest.room !== 'b' || boss.room !== 'boss' || exit.room !== 'boss' || player.room !== 'a') {
    return 'critical objects are in the wrong rooms';
  }
  for (const spawn of spawns) {
    if (spawn.room !== 'boss') continue;
    const gap = distPoints(centerOf(boss), centerOf(spawn));
    if (gap < BOSS_AGGRO + BOSS_SPAWN_GAP) {
      return `boss aggro-overlaps ${spawn.name} (${gap.toFixed(0)}px)`;
    }
  }

  const counts: Record<RoomId, number> = { a: 0, c: 0, b: 0, boss: 0 };
  for (const enemy of objects) {
    if (enemy.kind === 'enemy') counts[enemy.room] += 1;
  }
  if (counts.a < 1 || counts.c < 1 || counts.b < 1) return 'a combat room is missing Pastes';
  if (counts.boss !== 0) return 'boss room should not contain Pastes';

  const adj: Record<RoomId, RoomId[]> = { a: [], c: [], b: [], boss: [] };
  for (const door of doors) {
    if (door.dest) adj[door.room].push(door.dest);
  }
  if (!reaches(adj, 'a', 'b') || !reaches(adj, 'a', 'boss')) {
    return 'door graph cannot reach the chest or the boss';
  }
  if (!reaches(adj, 'b', 'a') || !reaches(adj, 'boss', 'a') || !reaches(adj, 'c', 'a')) {
    return 'door graph has a one-way dead end';
  }

  const goals = new Map<string, string>();
  const goalObjs = objects.filter(
    (obj) => obj.kind === 'spawn' || obj.kind === 'boss' || obj.kind === 'chest' || obj.kind === 'exit',
  );
  for (const obj of goalObjs) {
    const tile = tileOf(obj);
    goals.set(`${tile.tx},${tile.ty}`, obj.name);
  }
  const start = tileOf(player);
  const found = new Set<string>();
  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const queue: { tx: number; ty: number }[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const hit = goals.get(`${cur.tx},${cur.ty}`);
    if (hit) found.add(hit);
    const cell = `${Math.floor(cur.tx / ROOM_W)},${Math.floor(cur.ty / ROOM_H)}`;
    if (!roomCells.has(cell)) return 'map leaks into the void outside the rooms';
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || blocked(nx, ny)) continue;
      seen.add(key);
      queue.push({ tx: nx, ty: ny });
    }
  }
  const missing = [...goals.values()].filter((name) => !found.has(name));
  if (missing.length > 0) return `unreachable from player: ${missing.join(', ')}`;
  return null;
}

function emitTiled(
  seed: number,
  ground: number[],
  walls: number[],
  mapW: number,
  mapH: number,
  rooms: GeneratedDungeon['rooms'],
  objects: Spawn[],
): object {
  let nextId = 1;
  const tiledObjects = objects.map((obj) => {
    const entry: {
      id: number;
      name: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      visible: boolean;
      properties: TiledProperty[];
    } = {
      id: nextId,
      name: obj.name,
      type: obj.kind === 'player' ? 'spawn' : obj.kind,
      x: obj.tx * TILE,
      y: obj.ty * TILE,
      width: obj.w * TILE,
      height: obj.h * TILE,
      rotation: 0,
      visible: true,
      properties: [],
    };
    nextId += 1;
    if (obj.kind === 'door' && obj.dest && obj.target) {
      entry.properties.push(prop('target', obj.target), prop('room', obj.dest));
    } else if (obj.kind === 'enemy') {
      entry.properties.push(prop('room', obj.room), prop('hp', obj.hp ?? PASTE_HP[obj.room]));
    } else {
      entry.properties.push(prop('room', obj.room));
    }
    return entry;
  });

  const properties: TiledProperty[] = [
    prop('seed', seed),
    ...ROOM_IDS.map((id) => {
      const rect = rooms[id];
      return prop(PROP_NAME[id], `${rect.x},${rect.y},${rect.w},${rect.h}`);
    }),
  ];

  return {
    compressionlevel: -1,
    height: mapH,
    width: mapW,
    tileheight: TILE,
    tilewidth: TILE,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    nextlayerid: 4,
    nextobjectid: nextId,
    properties,
    tilesets: [
      {
        columns: 7,
        firstgid: 1,
        image: 'dungeon-tiles.png',
        imageheight: TILE,
        imagewidth: TILE * 7,
        margin: 0,
        name: 'dungeon-tiles',
        spacing: 0,
        tilecount: 7,
        tileheight: TILE,
        tilewidth: TILE,
      },
    ],
    layers: [
      {
        id: 1,
        name: 'ground',
        type: 'tilelayer',
        visible: true,
        opacity: 1,
        width: mapW,
        height: mapH,
        x: 0,
        y: 0,
        data: ground,
      },
      {
        id: 2,
        name: 'walls',
        type: 'tilelayer',
        visible: true,
        opacity: 1,
        width: mapW,
        height: mapH,
        x: 0,
        y: 0,
        data: walls,
        properties: [prop('collides', true)],
      },
      {
        id: 3,
        name: 'spawns',
        type: 'objectgroup',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        objects: tiledObjects,
      },
    ],
  };
}

function reaches(adj: Record<RoomId, RoomId[]>, start: RoomId, goal: RoomId): boolean {
  const seen = new Set<RoomId>([start]);
  const queue: RoomId[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    if (cur === goal) return true;
    for (const next of adj[cur]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function sideBetween(from: Cell, to: Cell): Side | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  if (dx === 1) return 'e';
  if (dx === -1) return 'w';
  if (dy === 1) return 's';
  return 'n';
}

function worldTile(cell: Cell, lx: number, ly: number): { tx: number; ty: number } {
  return { tx: cell.x * ROOM_W + lx, ty: cell.y * ROOM_H + ly };
}

function onCross(lx: number, ly: number): boolean {
  const vertical = lx >= 20 && lx <= 24 && ly >= 2 && ly <= 30;
  const horizontal = ly >= 13 && ly <= 18 && lx >= 1 && lx <= 46;
  return vertical || horizontal;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function centerOf(obj: { tx: number; ty: number; w: number; h: number }): { x: number; y: number } {
  return {
    x: obj.tx * TILE + (obj.w * TILE) / 2,
    y: obj.ty * TILE + (obj.h * TILE) / 2,
  };
}

function tileOf(obj: { tx: number; ty: number; w: number; h: number }): { tx: number; ty: number } {
  const center = centerOf(obj);
  return { tx: Math.floor(center.x / TILE), ty: Math.floor(center.y / TILE) };
}

function boundsOf(obj: { tx: number; ty: number; w: number; h: number }): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const x0 = obj.tx * TILE;
  const y0 = obj.ty * TILE;
  return { x0, y0, x1: x0 + obj.w * TILE, y1: y0 + obj.h * TILE };
}

function paddedBounds(
  obj: { tx: number; ty: number; w: number; h: number },
  pad: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const rect = boundsOf(obj);
  return { x0: rect.x0 - pad, y0: rect.y0 - pad, x1: rect.x1 + pad, y1: rect.y1 + pad };
}

function pointInRect(
  x: number,
  y: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

function distPoints(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distTiles(a: { tx: number; ty: number }, b: { tx: number; ty: number }): number {
  return Math.hypot((a.tx - b.tx) * TILE, (a.ty - b.ty) * TILE);
}

function distToRect(
  x: number,
  y: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): number {
  const cx = Math.min(Math.max(x, rect.x0), rect.x1);
  const cy = Math.min(Math.max(y, rect.y0), rect.y1);
  return Math.hypot(x - cx, y - cy);
}

function prop(name: string, value: string | number | boolean): TiledProperty {
  const type = typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'string';
  return { name, type, value };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as T;
    out[j] = tmp as T;
  }
  return out;
}
