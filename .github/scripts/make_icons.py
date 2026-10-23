"""Draws the NongFarm app icons (a chick on green) into icons/ using only the Python standard library.

Usage: python .github/scripts/make_icons.py   (run from the game folder; the PNGs are committed)
"""
import math
import os
import struct
import zlib

BG = (58, 157, 93)
BODY = (255, 212, 92)
WING = (242, 184, 60)
BEAK = (242, 140, 60)
INK = (43, 29, 8)
CHEEK = (255, 154, 162)
LEAF = (143, 209, 143)


def ellipse(cx, cy, rx, ry):
    return lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def rect(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1


def triangle(a, b, c):
    def inside(x, y):
        d = [(x - p[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (y - p[1]) for p, q in ((a, b), (b, c), (c, a))]
        return all(v >= 0 for v in d) or all(v <= 0 for v in d)
    return inside


# Drawn on a 512 grid, art kept inside the central 80% (safe zone for maskable icons). Later layers paint over earlier ones.
LAYERS = [
    (WING, ellipse(168, 318, 36, 58)),
    (WING, ellipse(344, 318, 36, 58)),
    (BODY, ellipse(256, 305, 118, 108)),
    (BODY, ellipse(256, 208, 80, 76)),
    (BEAK, rect(222, 396, 238, 414)),
    (BEAK, rect(274, 396, 290, 414)),
    (LEAF, ellipse(236, 124, 24, 11)),
    (LEAF, ellipse(278, 124, 24, 11)),
    (LEAF, rect(252, 124, 260, 140)),
    (CHEEK, ellipse(210, 232, 13, 10)),
    (CHEEK, ellipse(302, 232, 13, 10)),
    (INK, ellipse(226, 202, 11, 13)),
    (INK, ellipse(286, 202, 11, 13)),
    (BEAK, triangle((242, 224), (270, 224), (256, 248))),
]


def background(maskable):
    if maskable:
        return lambda x, y: True  # full bleed: the platform applies its own mask
    r = 100  # rounded square, transparent corners
    def inside(x, y):
        cx = min(max(x, r), 512 - r)
        cy = min(max(y, r), 512 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return inside


def render(size, maskable):
    bg = background(maskable)
    scale = 512 / size
    sub = 3  # 3x3 supersampling for smooth edges
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(sub):
                for sx in range(sub):
                    x = (px + (sx + 0.5) / sub) * scale
                    y = (py + (sy + 0.5) / sub) * scale
                    if not bg(x, y):
                        continue
                    color = BG
                    for fill, inside in LAYERS:
                        if inside(x, y):
                            color = fill
                    acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2]; acc[3] += 255
            covered = acc[3] // 255
            if covered:
                row += bytes((acc[0] // covered, acc[1] // covered, acc[2] // covered, acc[3] // (sub * sub)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)
    raw = b''.join(rows)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def main():
    os.makedirs('icons', exist_ok=True)
    for name, size, maskable in [
        ('icon-192.png', 192, False), ('icon-512.png', 512, False),
        ('icon-maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True),
    ]:
        write_png(os.path.join('icons', name), size, render(size, maskable))
        print('wrote', name)


if __name__ == '__main__':
    main()
