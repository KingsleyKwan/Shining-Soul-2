#!/usr/bin/env python3
"""Pack village-hub NPC standing sprites into a Phaser atlas.

Sources (embedded base64, also written to public/assets/ for local inspect):
  public/assets/npc-king.png
  public/assets/npc-girl.png

Outputs:
  public/assets/generated/npc-atlas.png
  public/assets/generated/npc-atlas.json

Frames: king_idle_0/1, girl_idle_0/1 (1px bob for a soft idle).
Style: player-like GBA pixel humanoids (not geometric placeholders).
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "assets"
GEN = ROOT / "public" / "assets" / "generated"
KING = SRC / "npc-king.png"
GIRL = SRC / "npc-girl.png"
DST_PNG = GEN / "npc-atlas.png"
DST_JSON = GEN / "npc-atlas.json"

# Player-scale standees (~22x33), purple-crown king + red-dress girl.
_KING_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAABcAAAAiCAYAAAC0nUK+AAAFLElEQVR4nI2XIYzjOhCGv54ODBxo"
    "aGhoGBgYGFgYWFhYWFhYWFhYGFgYGBgYaGhoOMwPZLu3e1ud3khVo4n12f3n99jd8SY6OjKZhQWA"
    "lgaJVCRTZt3NH3mAQGBlfYfh17tk8WvthlIDAYBEZjgGxptnYa2fYPF1OFr1uP8PT5YZemM4WPW4"
    "GhqtrV/AVp7jHo+vIlJvV6OPAFLfcd7CffG7693Y947rtaH1GfXDhwxP2pCZ74qXwnACRXfvOG+T"
    "HS3SLfVxcYAHbaFMUDKbAg5LC88xc7w5Mvn/w1WkDg0MPTgviMiXt4YZWDFKhsMVcnYk0g/W73dw"
    "Ueg6x30EARAw274FwcwwMxAYb57nDYbnT84PuCB1vjjUKW0nmBXKamiIiCrLYwaM2EWslG3WaIRn"
    "qCvr7p/w20EQBbOCFChJyElRMYxC8BHxjmW6E6Ij50JUx99geKO5iNTgYLo5ShbWRfDOg2ScOsRH"
    "pvFJKQUXEt4pw6WQ1p+6v4Xn8UBaF0JoKCglZ7z/U9Q1GSEEKCvj+AQfOZ3mH/AfPheDZU2UAogy"
    "W+D8mL5VpTnckLgHEVSUkgqK/o36CVcc3enJczXA8JLp2/htzPnQYmkCM87jyuk20dP/W3OPr6ej"
    "Evsj4+OBwzj0Eb75/COK0RzvHE8Hghqn04Mp5feyRAJ97wkKQR4cTyeKOtrDg7SsiAiyuZ51XnD7"
    "G+fTnv2+Q8pE0wYC/m2PwePrPD2qlbk+b0Mt81BLnuvteqxtcPV5iHU8xHofYhWh5mdTrSw13V3N"
    "61jTfKvyVwP74nP7fGr7A2kZYTqwbwLkSH/52IICaexRt/K89IT+jIpsm+y1k79q3tHSXmI9Hgaw"
    "Qs6Jvn0gIni/cDkY4veICmUaQTPdMeDw4ArP+bwtr2Rc2GNmuy+aCzklrCSMwr590mhHlAZyz3VU"
    "xBbII4SG/hRotCdogxTH9XLfalzyN6l/b4IU1AVsvdHtodGObCuG0UZHbJTzWQEjZWF+Oo49LOVJ"
    "1I7xNtOHAd/dv8F/Dexxe62HoWc4Q9QWgGyJbAkAVQe5w/KAEw8UAJYyIYCXQHcUcsmUPPEq7G9F"
    "SSVzv08EgdBlrGTWOZGzUCxv3Q/7025zolgGARcngiihOGLck/P0tyxgGIJDze8yVEFQXTEpqCr9"
    "ccY7Y54S4DC9QwHBISjYy2/yHf4K54XYSM1JSUUpi0fMAYl1eTJlo+8c6ypgEZiJUXFe0aXAzDcv"
    "/lplpYkB7xTTjI+JEBIFcLQIgVxgXhpS6riPDjCUDieeJAnntltOEz2I0HUNkcDvRdc6ni7klDiO"
    "E+MEVmBdlEYjyArm0dJtXk6FEEcUIUjD5TYj+8D9mTmfB8B4PC547euvl1Jmxr6LPKbE4fLE47ff"
    "Zq++9aHlRxPbjlRFi+d0nzkeOkp++Xwb8+v18JJq3zXfvPqnPrYtw4yS0pecoSrbwM+J7QX/HmaG"
    "iHG+PmmHCbOMfK4Uki1bG7DE9Tpx3K+fE/3xyzbJp1sEEBFyKduBPqwMfeZyiYjruXYPYDuwtTly"
    "uVyIQ8GA4D0i8ok2S9uR1tHQ921dpluN3lWBqiJ1iFobL1WECt8/ItuYPkhtvW45pI73U7UyVxGt"
    "8NEVI5GVtTY0u4kJFannvadkI+XCmo0522c990FQEXxwTEtmWqFY2QlStwvUl664sGDYbmJCoB5b"
    "xXLZblUfwJZu91rMq/gpZbxAdEYgYNjuBf5c+ddQ9O1RFYm7iQmHVnvz3uF2f/8J+A9TNdTpeCaK"
    "kAAAAABJRU5ErkJggg=="
)
_GIRL_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAABMAAAAgCAYAAADwvkPPAAADvUlEQVR4nH2WL7TyPAzGf3BeERlZ"
    "OTk5iUQir0QikUgkEom8EolEIicnJysrKyPj+omOAd+955bDGWnz50myJwV+WZf2gkD5/SvlNxuA"
    "xf83RCgCrNsGcEB+GD1iAgR3/7D/EFQoqzYgXr3+tdydmCB5nn0s3xE1QRGE/Vf3pyMB9puOtoFA"
    "mNOevapQamp/LxFwf8nD6GQquuUUqXRBP1JI2chmH2gAcq57Np2JGs+mLOdok3LKmZiN22GDTxBi"
    "Ni77FSkb5lUHIKaMvtV2WZEwG5qDiNCsGobbgTgZatMwfO9wHHPIVvWDCkFB0fIPXqjGlFGB6+mL"
    "ZnMBgXQ/zIk2XxdEoL/sWB+uyGSbvZZhqpngQLwfcIftuSdZntN5JpLMiDmzPt4QYLgdGJMhDoYt"
    "liKUdatTCOOy7bidt8SYUFWYAgGzfD9vuWxXWEy04b1mk2ZQJeyuqEDbBp6I5yI8bYRF2yiq0B3v"
    "qAhdqwRCWQiUNihBhT5mEMEeB95pJIA/RXfcIXxdEJwggqqSEixEKJ0q0RwVUBGiOeDY4/h6S6en"
    "rs8g0KoiUrsaBFJW/rmzGLMVgBCUMRl7FdaqmK64Hw8TT53N6cJNhajCKTtdULLXV8XIn0NDRIp7"
    "Lm6pPIIWt1hlz8UtFstjuasWs1zMcgmiH+NoJrqKlmHo5wN1oe82b5GUuN6iVKAicH9808iL6P+e"
    "PxyjnYhucUTECQ5j2738TePNUkSblrZbYW+sX0IdI31fUVmO7I9nxoku6qDu1RFOdtgdTuCOINwe"
    "VxqaF9GNTNe182zphwGA7E79gONEd5I7wzDOUJsmTBqwbETLcdU8O8Buf+ILoVWprZ8cZHcaEVRg"
    "4852uwMgCBzXSkNTlhlju11BGvDhjvcDWxFUBEWQ6anUvUaEFTD2A6QRLLHedDhe02y6FvLI0D/Y"
    "AGEacAIEhCAy79XfsAaG/oHYSLtqEYGleiCbkbKxPz/o/rhHph7QirIR2B2vZHOSOeJa74CAFhHn"
    "okKjWickL3b6L45TUHLOHM1RDyTSYqaAiBSLDwDiavunI1RoHt+YOevuQCIt4O12EqQIcFNY5/Q+"
    "fHiOz1m2TN+u+DJQdL6dftzogVBQYzhvAbiPieN1IH5XtO7QHm7Viecf9j9W0InkFsv1tCu1BPfi"
    "eSiWxxLe+Pjn0mly2NiXIWg5qhQRSh+09EHrmaWi8vMPzAdMEUovUmskYMC3OQ/gjNOpVsWpeBsH"
    "c1v86kzRH9ECgUhchOmsDo7aDkXnTgL8B1cMHzae1E3aAAAAAElFTkSuQmCC"
)


def ensure_sources() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    if not KING.is_file():
        KING.write_bytes(base64.b64decode("".join(_KING_PNG_B64.split())))
    if not GIRL.is_file():
        GIRL.write_bytes(base64.b64decode("".join(_GIRL_PNG_B64.split())))
    # Always refresh from embedded so CI matches the committed script.
    KING.write_bytes(base64.b64decode("".join(_KING_PNG_B64.split())))
    GIRL.write_bytes(base64.b64decode("".join(_GIRL_PNG_B64.split())))


def bob(im: Image.Image) -> Image.Image:
    """1px upward content shift for a subtle idle alternate."""
    w, h = im.size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(im, (0, -1), im)
    return canvas


def main() -> None:
    ensure_sources()
    king = Image.open(KING).convert("RGBA")
    girl = Image.open(GIRL).convert("RGBA")
    frames_imgs = {
        "king_idle_0": king,
        "king_idle_1": bob(king),
        "girl_idle_0": girl,
        "girl_idle_1": bob(girl),
    }
    pad = 2
    total_w = sum(im.width + pad for im in frames_imgs.values()) + pad
    total_h = max(im.height for im in frames_imgs.values()) + pad * 2
    atlas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    frames_meta: dict = {}
    x = pad
    for name, im in frames_imgs.items():
        y = pad
        atlas.paste(im, (x, y), im)
        frames_meta[name] = {
            "frame": {"x": x, "y": y, "w": im.width, "h": im.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }
        x += im.width + pad

    GEN.mkdir(parents=True, exist_ok=True)
    atlas.save(DST_PNG, optimize=True)
    meta = {
        "frames": frames_meta,
        "meta": {
            "app": "shining-soul-2-web/tools/make_npc_atlas.py",
            "image": "npc-atlas.png",
            "format": "RGBA8888",
            "size": {"w": atlas.width, "h": atlas.height},
            "scale": "1",
        },
    }
    DST_JSON.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote NPC atlas → {DST_PNG.name} ({atlas.width}x{atlas.height}, "
        f"{len(frames_meta)} frames)"
    )


if __name__ == "__main__":
    main()
