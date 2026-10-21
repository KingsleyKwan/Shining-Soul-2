import type { Tilemaps } from 'phaser';

type Point = { x: number; y: number };
type Node = { x: number; y: number; g: number; f: number; px: number; py: number };

const REPATH_MS = 400;
const WAYPOINT_REACH = 10;
const CARDINALS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Lightweight grid A* over a Tiled walls layer for Arcade agents.
 * One instance shared by all Pastes/Boss — walkable = non-colliding tiles.
 */
export class TilePathfinder {
  readonly tileW: number;
  readonly tileH: number;
  readonly cols: number;
  readonly rows: number;
  /** Flat row-major: 1 = walkable, 0 = blocked */
  private readonly walk: Uint8Array;

  constructor(walls: Tilemaps.TilemapLayer) {
    const map = walls.tilemap;
    this.tileW = map.tileWidth;
    this.tileH = map.tileHeight;
    this.cols = map.width;
    this.rows = map.height;
    this.walk = new Uint8Array(this.cols * this.rows);

    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const tile = walls.getTileAt(tx, ty);
        // Colliding tiles (walls/pillars) block; empty / non-collide are walkable
        const blocked = !!tile && tile.collides;
        this.walk[ty * this.cols + tx] = blocked ? 0 : 1;
      }
    }
  }

  worldToTile(wx: number, wy: number): Point {
    return {
      x: PhaserMathClamp(Math.floor(wx / this.tileW), 0, this.cols - 1),
      y: PhaserMathClamp(Math.floor(wy / this.tileH), 0, this.rows - 1),
    };
  }

  tileCenter(tx: number, ty: number): Point {
    return {
      x: tx * this.tileW + this.tileW / 2,
      y: ty * this.tileH + this.tileH / 2,
    };
  }

  isWalkable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
    return this.walk[ty * this.cols + tx] === 1;
  }

  /** Nearest walkable tile (spiral) if (tx,ty) is blocked or OOB. */
  nearestWalkable(tx: number, ty: number): Point {
    if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (this.isWalkable(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return { x: PhaserMathClamp(tx, 0, this.cols - 1), y: PhaserMathClamp(ty, 0, this.rows - 1) };
  }

  /**
   * 4-neighbour A*. Returns world-space waypoint centers (excludes start).
   * Empty array if no path / already adjacent.
   */
  findPath(fromX: number, fromY: number, toX: number, toY: number): Point[] {
    let start = this.worldToTile(fromX, fromY);
    let goal = this.worldToTile(toX, toY);
    start = this.nearestWalkable(start.x, start.y);
    goal = this.nearestWalkable(goal.x, goal.y);

    if (start.x === goal.x && start.y === goal.y) return [];

    const w = this.cols;
    const h = this.rows;
    const size = w * h;
    const gScore = new Float32Array(size);
    gScore.fill(Infinity);
    const cameX = new Int16Array(size);
    const cameY = new Int16Array(size);
    cameX.fill(-1);
    cameY.fill(-1);
    const closed = new Uint8Array(size);

    const open: Node[] = [];
    const si = start.y * w + start.x;
    gScore[si] = 0;
    open.push({
      x: start.x,
      y: start.y,
      g: 0,
      f: manhattan(start.x, start.y, goal.x, goal.y),
      px: -1,
      py: -1,
    });

    let found = false;
    let guard = 0;
    const maxExpand = size; // hard cap

    while (open.length > 0 && guard++ < maxExpand) {
      // Linear pick of lowest f — fine for ~2k tiles and few agents
      let best = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[best].f) best = i;
      }
      const cur = open[best];
      open[best] = open[open.length - 1];
      open.pop();

      const ci = cur.y * w + cur.x;
      if (closed[ci]) continue;
      closed[ci] = 1;

      if (cur.x === goal.x && cur.y === goal.y) {
        found = true;
        break;
      }

      for (const [dx, dy] of CARDINALS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.isWalkable(nx, ny)) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const tentative = cur.g + 1;
        if (tentative >= gScore[ni]) continue;
        gScore[ni] = tentative;
        cameX[ni] = cur.x;
        cameY[ni] = cur.y;
        open.push({
          x: nx,
          y: ny,
          g: tentative,
          f: tentative + manhattan(nx, ny, goal.x, goal.y),
          px: cur.x,
          py: cur.y,
        });
      }
    }

    if (!found) return [];

    // Reconstruct tile path goal → start, then reverse to world centers (skip start)
    const tiles: Point[] = [];
    let cx = goal.x;
    let cy = goal.y;
    let steps = 0;
    while (!(cx === start.x && cy === start.y) && steps++ < maxExpand) {
      tiles.push({ x: cx, y: cy });
      const i = cy * w + cx;
      const px = cameX[i];
      const py = cameY[i];
      if (px < 0) break;
      cx = px;
      cy = py;
    }
    tiles.reverse();
    return tiles.map((t) => this.tileCenter(t.x, t.y));
  }
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function PhaserMathClamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Per-agent chase helper: repath on interval, follow waypoints, axis-slide fallback. */
export class PathFollower {
  private path: Point[] = [];
  private nextRepathAt = 0;
  private readonly repathMs: number;

  constructor(
    private readonly finder: TilePathfinder,
    repathMs = REPATH_MS,
  ) {
    this.repathMs = repathMs;
  }

  reset(): void {
    this.path = [];
    this.nextRepathAt = 0;
  }

  /**
   * Compute chase velocity toward (tx,ty). Uses A* when available;
   * otherwise slides on the freer axis toward the target.
   */
  chaseVelocity(
    time: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    speed: number,
    blockedX: boolean,
    blockedY: boolean,
  ): Point {
    if (time >= this.nextRepathAt) {
      this.nextRepathAt = time + this.repathMs;
      this.path = this.finder.findPath(fromX, fromY, toX, toY);
    }

    // Drop reached waypoints
    while (this.path.length > 0) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - fromX, wp.y - fromY) <= WAYPOINT_REACH) {
        this.path.shift();
      } else {
        break;
      }
    }

    let aimX = toX;
    let aimY = toY;
    if (this.path.length > 0) {
      aimX = this.path[0].x;
      aimY = this.path[0].y;
    }

    let dx = aimX - fromX;
    let dy = aimY - fromY;

    // Fallback / stuck: if blocked on an axis, prefer the other toward real target
    if (this.path.length === 0 || (blockedX && blockedY)) {
      dx = toX - fromX;
      dy = toY - fromY;
    }

    if (blockedX && !blockedY) {
      dx = 0;
      dy = toY - fromY || (dy !== 0 ? dy : 1);
    } else if (blockedY && !blockedX) {
      dy = 0;
      dx = toX - fromX || (dx !== 0 ? dx : 1);
    } else if (blockedX && blockedY) {
      // Both blocked — try perpendicular nudge toward target
      const tdx = toX - fromX;
      const tdy = toY - fromY;
      if (Math.abs(tdx) > Math.abs(tdy)) {
        dx = 0;
        dy = tdy !== 0 ? tdy : 1;
      } else {
        dy = 0;
        dx = tdx !== 0 ? tdx : 1;
      }
    }

    const len = Math.hypot(dx, dy) || 1;
    return { x: (dx / len) * speed, y: (dy / len) * speed };
  }
}
