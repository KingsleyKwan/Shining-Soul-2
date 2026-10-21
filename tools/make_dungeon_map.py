#!/usr/bin/env python3
"""Regenerate dungeon tileset + two-chamber Tiled map.

Tiles are ORIGINAL placeholders (cool GBA dungeon palette).
GIDs: 1 void, 2 floorA, 3 floorB, 4 wall, 5 wall-top, 6 pillar, 7 door

Map: 80×28 @ 16px — Room A (cols 0–39 combat) | Room B (cols 40–79 quiet)
Doorway in the shared wall; Tiled objects handle teleport targets.

Run: python3 tools/make_dungeon_map.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/maps"
TILE = 16
N = 7  # includes door tile

VOID, F1, F2, WALL, WTOP, PILLAR, DOOR = 1, 2, 3, 4, 5, 6, 7
ROOM_W, H = 40, 28
W = ROOM_W * 2  # 80


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
    # Stone arch / door marker on floor-ish mid tone
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


def fill_room_shell(setg, x0, x1):
    """Outer walls for a room spanning inclusive tile cols [x0, x1]."""
    for y in range(H):
        for x in range(x0, x1 + 1):
            setg("ground", x, y, F1 if (x + y) % 2 == 0 else F2)
    for x in range(x0, x1 + 1):
        setg("walls", x, 0, WTOP)
        setg("walls", x, 1, WALL)
        setg("walls", x, H - 1, WALL)
        setg("ground", x, 0, VOID)
        setg("ground", x, H - 1, VOID)
    for y in range(H):
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

    ground = [0] * (W * H)
    walls = [0] * (W * H)

    def setg(which, x, y, gid):
        if 0 <= x < W and 0 <= y < H:
            (ground if which == "ground" else walls)[y * W + x] = gid

    # --- Room A (combat) cols 0..39 ---
    fill_room_shell(setg, 0, 39)
    for x in range(8, 14):
        setg("walls", x, 8, WALL)
        setg("walls", x, 18, WALL)
    for x in range(26, 32):
        setg("walls", x, 8, WALL)
        setg("walls", x, 18, WALL)
    for y in range(8, 12):
        setg("walls", 8, y, WALL)
        setg("walls", 31, y, WALL)
    for y in range(15, 19):
        setg("walls", 8, y, WALL)
        setg("walls", 31, y, WALL)
    setg("walls", 15, 13, PILLAR)
    setg("walls", 24, 13, PILLAR)

    # --- Room B (quiet) cols 40..79 ---
    fill_room_shell(setg, 40, 79)
    # Soft interior décor pillars
    setg("walls", 50, 10, PILLAR)
    setg("walls", 68, 10, PILLAR)
    setg("walls", 50, 18, PILLAR)
    setg("walls", 68, 18, PILLAR)
    # Chest alcove (small wall stubs)
    for x in range(58, 63):
        setg("walls", x, 8, WALL)

    # Shared dividing wall already from room shells at x=39 and x=40.
    # Cut a doorway (2 tiles tall) and place door tiles on ground.
    door_ys = (13, 14)
    for y in door_ys:
        setg("walls", 39, y, 0)
        setg("walls", 40, y, 0)
        setg("ground", 39, y, DOOR)
        setg("ground", 40, y, DOOR)

    # Spawns / doors / markers (pixel coords)
    objects = [
        # Room A
        {"id": 1, "name": "player", "type": "spawn", "x": 20 * TILE, "y": 14 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        {"id": 2, "name": "enemy1", "type": "enemy", "x": 26 * TILE, "y": 14 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        {"id": 3, "name": "enemy2", "type": "enemy", "x": 12 * TILE, "y": 16 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        {"id": 4, "name": "boss", "type": "boss", "x": 20 * TILE, "y": 10 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        # Door A → B (stand near east door in room A)
        {"id": 5, "name": "door_to_b", "type": "door", "x": 37 * TILE, "y": 13 * TILE,
         "width": 32, "height": 32, "rotation": 0, "visible": True,
         "properties": [
             {"name": "target", "type": "string", "value": "spawn_b"},
             {"name": "room", "type": "string", "value": "b"},
         ]},
        {"id": 6, "name": "spawn_a", "type": "spawn", "x": 35 * TILE, "y": 14 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        # Room B
        {"id": 7, "name": "spawn_b", "type": "spawn", "x": 44 * TILE, "y": 14 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
        {"id": 8, "name": "door_to_a", "type": "door", "x": 41 * TILE, "y": 13 * TILE,
         "width": 32, "height": 32, "rotation": 0, "visible": True,
         "properties": [
             {"name": "target", "type": "string", "value": "spawn_a"},
             {"name": "room", "type": "string", "value": "a"},
         ]},
        {"id": 9, "name": "enemy_b1", "type": "enemy", "x": 60 * TILE, "y": 16 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True,
         "properties": [{"name": "room", "type": "string", "value": "b"}]},
        {"id": 10, "name": "chest", "type": "chest", "x": 60 * TILE, "y": 10 * TILE,
         "width": 16, "height": 16, "rotation": 0, "visible": True},
    ]

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
        "nextobjectid": 11,
        "properties": [
            {"name": "roomA", "type": "string", "value": "0,0,640,448"},
            {"name": "roomB", "type": "string", "value": "640,0,640,448"},
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
             "properties": [{"name": "collides", "type": "bool", "value": True}]},
            {"id": 3, "name": "spawns", "type": "objectgroup", "visible": True, "opacity": 1,
             "x": 0, "y": 0, "objects": objects},
        ],
    }
    for name in ("dungeon-room.json", "dungeon-room.tmj"):
        with open(OUT / name, "w") as f:
            json.dump(tiled, f, indent=2)
    print(f"Wrote two-chamber map {W}x{H} @ {TILE}px → {OUT}")


if __name__ == "__main__":
    main()
