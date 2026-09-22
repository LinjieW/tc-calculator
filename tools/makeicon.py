#!/usr/bin/env python3
"""Generate AppIcon.icns with no third-party dependencies.

Pure-stdlib PNG writer (zlib + struct) plus a 4x-supersampled software rasteriser,
so the build needs nothing installed: no Pillow, no ImageMagick, no network. The
icon is a Big Sur style rounded square in the kit's tint colour carrying three
rising bars.

Usage: makeicon.py <output.icns|output_dir>
"""

import os
import struct
import subprocess
import sys
import tempfile
import zlib

SS = 4  # supersampling factor per axis

# Kit tint, lightened at the top-left and deepened at the bottom-right so the
# tile reads as a lit surface rather than a flat swatch.
GRAD_TOP = (0x74, 0x8A, 0xAC)
GRAD_BOT = (0x3E, 0x4C, 0x66)
BAR = (0xFF, 0xFD, 0xF8)

# Big Sur geometry: the art sits inside the canvas with a margin, and the corner
# radius is a fixed fraction of the TILE, not of the canvas.
MARGIN = 0.0586      # 60/1024
RADIUS = 0.2237      # of the tile's side


def rounded_rect_cover(px, py, x0, y0, x1, y1, r):
    """1.0 inside the rounded rect, 0.0 outside. Sampled, not analytic --
    the 4x supersample above is what turns this into a smooth edge."""
    if px < x0 or px > x1 or py < y0 or py > y1:
        return 0.0
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    dx, dy = px - cx, py - cy
    if dx == 0.0 and dy == 0.0:
        return 1.0
    return 1.0 if (dx * dx + dy * dy) <= r * r else 0.0


def render(size):
    """Return RGBA bytes for one square icon of `size` px."""
    n = size * SS
    inv = 1.0 / n

    t = MARGIN
    x0, y0, x1, y1 = t, t, 1.0 - t, 1.0 - t
    r = (x1 - x0) * RADIUS

    # Three rising bars, in tile-relative coordinates.
    base_y = 0.735
    bars = []
    bx = 0.225
    for height in (0.175, 0.300, 0.475):
        bars.append((bx, base_y - height, bx + 0.130, base_y, 0.042))
        bx += 0.130 + 0.085

    rows = []
    for py in range(n):
        row = bytearray()
        for px in range(n):
            u = (px + 0.5) * inv
            v = (py + 0.5) * inv

            a = rounded_rect_cover(u, v, x0, y0, x1, y1, r)
            if a == 0.0:
                row += b"\x00\x00\x00\x00"
                continue

            # Diagonal gradient across the tile.
            g = min(max((u + v) * 0.5, 0.0), 1.0)
            cr = int(GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * g)
            cg = int(GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * g)
            cb = int(GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * g)

            for (bx0, by0, bx1, by1, br) in bars:
                if rounded_rect_cover(u, v, bx0, by0, bx1, by1, br) > 0.0:
                    cr, cg, cb = BAR
                    break

            row += bytes((cr, cg, cb, 255))
        rows.append(bytes(row))

    # Box-downsample the supersampled buffer.
    out = bytearray()
    for y in range(size):
        line = bytearray()
        for x in range(size):
            tr = tg = tb = ta = 0
            for sy in range(SS):
                src = rows[y * SS + sy]
                base = (x * SS) * 4
                for sx in range(SS):
                    o = base + sx * 4
                    al = src[o + 3]
                    tr += src[o] * al
                    tg += src[o + 1] * al
                    tb += src[o + 2] * al
                    ta += al
            if ta == 0:
                line += b"\x00\x00\x00\x00"
            else:
                cnt = SS * SS
                line += bytes((tr // ta, tg // ta, tb // ta, ta // cnt))
        out += line
    return bytes(out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


SPEC = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]


def main():
    if len(sys.argv) < 2:
        print("usage: makeicon.py <output.icns>", file=sys.stderr)
        return 2
    out = sys.argv[1]

    cache = {}
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "AppIcon.iconset")
    os.makedirs(iconset)

    for name, size in SPEC:
        if size not in cache:
            cache[size] = render(size)
        write_png(os.path.join(iconset, name), size, cache[size])

    try:
        subprocess.check_call(["iconutil", "-c", "icns", iconset, "-o", out])
    except (OSError, subprocess.CalledProcessError) as e:
        print("iconutil failed: %s" % e, file=sys.stderr)
        return 1
    print("wrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
