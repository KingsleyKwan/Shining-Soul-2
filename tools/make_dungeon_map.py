#!/usr/bin/env python3
"""Regenerate dungeon tileset + one-stage Tiled map.

Tiles are ORIGINAL placeholders (cool GBA dungeon palette).
GIDs: 1 void, 2 floorA, 3 floorB, 4 wall, 5 wall-top, 6 pillar, 7 door

Map: 144×64 @ 16px (2304×1024). Four rooms, camera clamps per room:

    [ A entry 48×32 ][ C corridor 48×32 ][ Boss arena 48×32 ]
                     [ B chest   48×32 ]

Doors (2-tile openings) teleport via Tiled objects (target + room).
Pastes sit off the door lanes. Captain Gully is alone in the boss arena.
An exit marker (inactive until the boss dies) sits on the arena's north side.

Run: python3 tools/make_dungeon_map.py
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/maps"
TILE = 16
N = 7  # includes door tile

VOID, F1, F2, WALL, WTOP, PILLAR, DOOR = 1, 2, 3, 4, 5, 6, 7

# Inclusive tile bounds.
ROOMS = {
    "a": (0, 0, 47, 31),
    "c": (48, 0, 95, 31),
    "b": (48, 32, 95, 63),
    "boss": (96, 0, 143, 31),
}
ROOM_W = 48
ROOM_H = 32
W = ROOM_W * 3  # 144
H = ROOM_H * 2  # 64

# Paste aggro is 150px; boss aggro is 200px. Keep spawns outside that.
PASTE_AGGRO = 150
BOSS_AGGRO = 200


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def draw_floor(img, ox, oy, variant=0):
    base = (72, 84, 104, 255) if variant == 0 else (78, 90, 110, 255)
    hi = (88, 100, 120, 255) if variant == 0 else (94, 106, 126, 255)
    lo = (56, 66, 84, 255) if variant == 0 else (60, 70, 88, 255)
    for y in range(TILE):
        for x in range(TILE):
            n = (x * 3 + y * 7 + variant * 11) % 5
            c = base
            if n == 0:
                c = hi
            if n == 4:
                c = lo
            px(img, ox + x, oy + y, c)
    for i in range(TILE):
        px(img, ox + i, oy, lo)
        px(img, ox, oy + i, lo)


def draw_wall(img, ox, oy, kind="solid"):
    mortar = (28, 30, 42, 255)
    brick_a = (64, 68, 88, 255)
    brick_b = (74, 78, 98, 255)
    brick_hi = (96, 100, 120, 255)
    brick_lo = (44, 48, 64, 255)
    for y in range(TILE):
        for x in range(TILE):
            px(img, ox + x, oy + y, mortar)
    for ry, rh, xoff in [(1, 6, 0), (8, 6, 4)]:
        x = xoff
        while x < TILE:
            bw = 7 if (x // 7) % 2 == 0 else 6
            for by in range(ry, min(ry + rh, TILE - 1)):
                for bx in range(x, min(x + bw - 1, TILE - 1)):
                    c = brick_a if ((x + by) % 2 == 0) else brick_b
                    if by == ry:
                        c = brick_hi
                    if by == ry + rh - 1:
                        c = brick_lo
                    px(img, ox + bx, oy + by, c)
            x += bw
    if kind == "top":
        for x in range(TILE):
            for y in range(3):
                px(img, ox + x, oy + y, (22, 24, 36, 255))
            px(img, ox + x, oy + 3, brick_hi)
    if kind == "pillar":
        for y in range(TILE):
            px(img, ox + 2, oy + y, brick_hi)
            px(img, ox + TILE - 3, oy + y, brick_lo)


def draw_void(img, ox, oy):
    for y in range(TILE):
        for x in range(TILE):
            px(img, ox + x, oy + y, (8, 10, 18, 255))


def draw_door(img, ox, oy):
    draw_floor(img, ox, oy, 1)
    wood = (92, 64, 40, 255)
    wood_hi = (120, 88, 52, 255)
    iron = (160, 160, 180, 255)
    for y in range(2, TILE - 1):
        for x in range(3, TILE - 3):
            px(img, ox + x, oy + y, wood_hi if (x + y) % 2 == 0 else wood)
    for x in range(3, TILE - 3):
        px(img, ox + x, oy + 2, iron)
    px(img, ox + TILE - 5, oy + TILE // 2, iron)


def fill_room_shell(setg, x0, x1, y0, y1, floor="checker"):
    """Outer walls. Top lip is two tiles (cap + inner) so vertical doors must cut both."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if floor == "boss":
                gid = F2 if (x * 2 + y) % 3 else F1
            else:
                gid = F1 if (x + y) % 2 == 0 else F2
            setg("ground", x, y, gid)
    for x in range(x0, x1 + 1):
        setg("walls", x, y0, WTOP)
        setg("walls", x, y0 + 1, WALL)
        setg("walls", x, y1, WALL)
        setg("ground", x, y0, VOID)
        setg("ground", x, y1, VOID)
    for y in range(y0, y1 + 1):
        setg("walls", x0, y, WALL)
        setg("walls", x1, y, WALL)
        setg("ground", x0, y, VOID)
        setg("ground", x1, y, VOID)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (TILE * N, TILE), (0, 0, 0, 0))
    draw_void(sheet, 0, 0)
    draw_floor(sheet, TILE, 0, 0)
    draw_floor(sheet, TILE * 2, 0, 1)
    draw_wall(sheet, TILE * 3, 0, "solid")
    draw_wall(sheet, TILE * 4, 0, "top")
    draw_wall(sheet, TILE * 5, 0, "pillar")
    draw_door(sheet, TILE * 6, 0)
    sheet.save(OUT / "dungeon-tiles.png")

    ground = [VOID] * (W * H)
    walls = [0] * (W * H)

    def setg(which, x, y, gid):
        if 0 <= x < W and 0 <= y < H:
            (ground if which == "ground" else walls)[y * W + x] = gid

    def hwall(x0, x1, y, gid=WALL):
        for x in range(x0, x1 + 1):
            setg("walls", x, y, gid)

    def vwall(x, y0, y1, gid=WALL):
        for y in range(y0, y1 + 1):
            setg("walls", x, y, gid)

    def pillar(x, y):
        setg("walls", x, y, PILLAR)

    ax0, ay0, ax1, ay1 = ROOMS["a"]
    cx0, cy0, cx1, cy1 = ROOMS["c"]
    bx0, by0, bx1, by1 = ROOMS["b"]
    gx0, gy0, gx1, gy1 = ROOMS["boss"]

    fill_room_shell(setg, ax0, ax1, ay0, ay1)
    fill_room_shell(setg, cx0, cx1, cy0, cy1)
    fill_room_shell(setg, bx0, bx1, by0, by1)
    fill_room_shell(setg, gx0, gx1, gy0, gy1, floor="boss")

    # --- Décor. Keep the east-west lane (y=15..16) and the chest lane (x=70..71) open. ---
    # Entry camp: north/south stubs and pillars, away from the east door.
    hwall(6, 12, 6)
    hwall(6, 12, 26)
    pillar(14, 8)
    pillar(14, 24)
    pillar(26, 10)

    # Combat corridor: broken walls that leave door approaches clear.
    hwall(58, 66, 10)
    hwall(74, 82, 22)
    vwall(68, 6, 12)
    vwall(78, 18, 24)
    pillar(74, 10)
    pillar(66, 24)

    # Chest room: side pillars, alcove east of the chest (chest is tile 80,50).
    pillar(56, 40)
    pillar(56, 56)
    pillar(90, 44)
    hwall(84, 90, 46)

    # Boss arena ring — west of the ring stays open for the door.
    pillar(108, 8)
    pillar(132, 10)
    pillar(108, 24)
    pillar(132, 24)
    pillar(120, 26)

    # Door openings LAST so décor cannot seal them.
    # Horizontal: both rooms' shared wall columns. Vertical: bottom wall + top lip (2 tiles).
    def link_h(x_west, x_east, ys):
        for x in (x_west, x_east):
            for y in ys:
                setg("walls", x, y, 0)
                setg("ground", x, y, DOOR)

    def link_v(xs, ys):
        for x in xs:
            for y in ys:
                setg("walls", x, y, 0)
                setg("ground", x, y, DOOR)

    link_h(47, 48, (15, 16))  # A east ↔ C west
    link_h(95, 96, (15, 16))  # C east ↔ Boss west
    link_v((70, 71), (31, 32, 33))  # C south ↔ B north (incl. inner top wall)

    def prop(name, value):
        if isinstance(value, bool):
            typ = "bool"
        elif isinstance(value, int) and not isinstance(value, bool):
            typ = "int"
        else:
            typ = "string"
        return {"name": name, "type": typ, "value": value}

    oid = 1

    def obj(name, typ, tx, ty, w_tiles=1, h_tiles=1, props=None):
        nonlocal oid
        entry = {
            "id": oid,
            "name": name,
            "type": typ,
            "x": tx * TILE,
            "y": ty * TILE,
            "width": w_tiles * TILE,
            "height": h_tiles * TILE,
            "rotation": 0,
            "visible": True,
        }
        oid += 1
        if props:
            entry["properties"] = [prop(k, v) for k, v in props.items()]
        return entry

    # Trigger rects sit on the walkable approach PLUS the opening tiles.
    # Arrival spawns are several tiles inside, clear of the trigger and of Paste aggro.
    objects = [
        # --- A entry / camp ---
        obj("player", "spawn", 10, 16, props={"room": "a"}),
        # SW of the east door so Paste aggro (150px) does not cover the doorway.
        obj("enemy_a1", "enemy", 18, 26, props={"room": "a", "hp": 2}),
        obj("door_a_to_c", "door", 45, 14, 3, 3, {"target": "spawn_c_west", "room": "c"}),
        obj("spawn_a", "spawn", 40, 15, props={"room": "a"}),
        # --- C corridor ---
        obj("door_c_to_a", "door", 48, 14, 3, 3, {"target": "spawn_a", "room": "a"}),
        obj("spawn_c_west", "spawn", 56, 15, props={"room": "c"}),
        obj("enemy_c1", "enemy", 62, 7, props={"room": "c", "hp": 3}),
        obj("enemy_c2", "enemy", 78, 8, props={"room": "c", "hp": 3}),
        obj("enemy_c3", "enemy", 60, 26, props={"room": "c", "hp": 3}),
        obj("door_c_to_boss", "door", 92, 14, 3, 3, {"target": "spawn_boss", "room": "boss"}),
        obj("spawn_c_east", "spawn", 86, 15, props={"room": "c"}),
        obj("door_c_to_b", "door", 69, 28, 3, 4, {"target": "spawn_b", "room": "b"}),
        obj("spawn_c_south", "spawn", 70, 21, props={"room": "c"}),
        # --- B chest ---
        obj("door_b_to_c", "door", 69, 32, 3, 3, {"target": "spawn_c_south", "room": "c"}),
        obj("spawn_b", "spawn", 70, 42, props={"room": "b"}),
        obj("chest", "chest", 80, 50, props={"room": "b"}),
        obj("enemy_b1", "enemy", 88, 58, props={"room": "b", "hp": 2}),
        # --- Boss arena ---
        obj("door_boss_to_c", "door", 96, 14, 3, 3, {"target": "spawn_c_east", "room": "c"}),
        obj("spawn_boss", "spawn", 105, 15, props={"room": "boss"}),
        obj("boss", "boss", 126, 18, props={"room": "boss"}),
        obj("exit", "exit", 116, 5, props={"room": "boss"}),
    ]

    rw, rh = ROOM_W * TILE, ROOM_H * TILE
    tiled = {
        "compressionlevel": -1,
        "height": H,
        "width": W,
        "tileheight": TILE,
        "tilewidth": TILE,
        "infinite": False,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "type": "map",
        "version": "1.10",
        "tiledversion": "1.10.2",
        "nextlayerid": 4,
        "nextobjectid": oid,
        "properties": [
            prop("roomA", f"0,0,{rw},{rh}"),
            prop("roomC", f"{rw},0,{rw},{rh}"),
            prop("roomB", f"{rw},{rh},{rw},{rh}"),
            prop("roomBoss", f"{rw * 2},0,{rw},{rh}"),
        ],
        "tilesets": [{
            "columns": N,
            "firstgid": 1,
            "image": "dungeon-tiles.png",
            "imageheight": TILE,
            "imagewidth": TILE * N,
            "margin": 0,
            "name": "dungeon-tiles",
            "spacing": 0,
            "tilecount": N,
            "tileheight": TILE,
            "tilewidth": TILE,
        }],
        "layers": [
            {"id": 1, "name": "ground", "type": "tilelayer", "visible": True, "opacity": 1,
             "width": W, "height": H, "x": 0, "y": 0, "data": ground},
            {"id": 2, "name": "walls", "type": "tilelayer", "visible": True, "opacity": 1,
             "width": W, "height": H, "x": 0, "y": 0, "data": walls,
             "properties": [prop("collides", True)]},
            {"id": 3, "name": "spawns", "type": "objectgroup", "visible": True, "opacity": 1,
             "x": 0, "y": 0, "objects": objects},
        ],
    }

    validate(walls, objects)

    for name in ("dungeon-room.json", "dungeon-room.tmj"):
        with open(OUT / name, "w") as f:
            json.dump(tiled, f, indent=2)
    print(f"Wrote stage map {W}x{H} @ {TILE}px ({W * TILE}x{H * TILE}) → {OUT}")


def validate(walls, objects):
    def blocked(tx, ty):
        if not (0 <= tx < W and 0 <= ty < H):
            return True
        return walls[ty * W + tx] != 0

    def center(o):
        return (
            o["x"] + o["width"] / 2,
            o["y"] + o["height"] / 2,
        )

    def tile_of(o):
        cx, cy = center(o)
        return int(cx // TILE), int(cy // TILE)

    by_name = {o["name"]: o for o in objects}
    doors = [o for o in objects if o["type"] == "door"]
    spawns = [o for o in objects if o["type"] == "spawn"]
    enemies = [o for o in objects if o["type"] == "enemy"]
    boss = by_name["boss"]
    exit_o = by_name["exit"]
    chest = by_name["chest"]

    for o in spawns + enemies + [boss, exit_o, chest, by_name["player"]]:
        tx, ty = tile_of(o)
        if blocked(tx, ty):
            raise SystemExit(f"{o['name']} is inside a wall at {tx},{ty}")

    for d in doors:
        target = next(p["value"] for p in d["properties"] if p["name"] == "target")
        room = next(p["value"] for p in d["properties"] if p["name"] == "room")
        if target not in by_name:
            raise SystemExit(f"{d['name']} target {target} missing")
        if room not in ("a", "c", "b", "boss"):
            raise SystemExit(f"{d['name']} bad room {room}")
        # Trigger must not contain the arrival spawn.
        dest = by_name[target]
        dx0, dy0 = d["x"], d["y"]
        dx1, dy1 = dx0 + d["width"], dy0 + d["height"]
        cx, cy = center(dest)
        if dx0 <= cx <= dx1 and dy0 <= cy <= dy1:
            raise SystemExit(f"{target} sits inside {d['name']}")

    def dist(a, b):
        ax, ay = center(a)
        bx, by = center(b)
        return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5

    # Same-room arrival spawns must start outside aggro so doors stay walkable.
    room_of = {}
    for o in objects:
        props = {p["name"]: p["value"] for p in o.get("properties", [])}
        if "room" in props:
            room_of[o["name"]] = props["room"]

    for e in enemies:
        for s in spawns:
            if room_of.get(e["name"]) != room_of.get(s["name"]):
                continue
            d = dist(e, s)
            if d < PASTE_AGGRO + 8:
                raise SystemExit(f"{e['name']} aggro-overlaps {s['name']} ({d:.0f}px)")

    # Entry Paste must stay on room A floor and clear of the east door funnel.
    paste_a = by_name["enemy_a1"]
    east_door = by_name["door_a_to_c"]
    ax, ay = tile_of(paste_a)
    a0, ay0, a1, ay1 = ROOMS["a"]
    if not (a0 < ax < a1 and ay0 < ay < ay1):
        raise SystemExit(f"enemy_a1 tile {ax},{ay} is outside room A")
    if blocked(ax, ay):
        raise SystemExit(f"enemy_a1 is inside a wall at {ax},{ay}")
    door_gap = dist(paste_a, east_door)
    if door_gap < 160:
        raise SystemExit(f"enemy_a1 is {door_gap:.0f}px from the east door (need >= 160)")

    for s in spawns:
        if room_of.get(s["name"]) != "boss":
            continue
        d = dist(boss, s)
        if d < BOSS_AGGRO + 16:
            raise SystemExit(f"boss aggro-overlaps {s['name']} ({d:.0f}px)")

    # Player must not share the boss room.
    if room_of["player"] == room_of["boss"]:
        raise SystemExit("player and boss share a room")

    # 4-neighbour walk: rooms connect only through door gaps (void must stay sealed).
    start = tile_of(by_name["player"])
    goal_names = ["boss", "chest", "exit", "spawn_a", "spawn_b", "spawn_c_west", "spawn_c_east", "spawn_c_south", "spawn_boss"]
    goals = {tile_of(by_name[n]): n for n in goal_names}
    seen = {start}
    q = deque([start])
    found = set()
    while q:
        x, y = q.popleft()
        if (x, y) in goals:
            found.add(goals[(x, y)])
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= nx < W and 0 <= ny < H):
                continue
            if blocked(nx, ny) or (nx, ny) in seen:
                continue
            seen.add((nx, ny))
            q.append((nx, ny))
    missing = [n for n in goal_names if n not in found]
    if missing:
        raise SystemExit(f"unreachable from player: {missing}")
    # A void tile under room A must NOT be reachable (no leak around the shell).
    if (0, 40) in seen:
        raise SystemExit("map leaks into the void outside the rooms")
    print(f"Validated doors, aggro spacing, and path to {', '.join(goal_names)}")


if __name__ == "__main__":
    main()
