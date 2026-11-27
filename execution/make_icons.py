"""Draw Alejo's browser and home-screen icons from the bell mark, with no image library.

The mark (24-unit grid, as in the site's inline SVG): a dome (upper half of a circle, centre 12,17, radius 9), a plate (2..22 x 18.5..21,
corner 1) and the dot (centre 12,6.2). Here: a white bell with the green dot on Alejo's ink. Each pixel is sampled 6x6 times so edges
are smooth. Writes into website/:
  favicon.svg            modern browsers (the tab icon)
  favicon-32.png         older browsers
  favicon.ico            the address browsers ask for by default (one 32px PNG inside)
  apple-touch-icon.png   180px, full square (iPhone adds its own corners), for "Add to Home Screen"
Usage:  python -I execution/make_icons.py
"""
import struct
import zlib
from pathlib import Path

INK, WHITE, GREEN = (0x14, 0x17, 0x2B), (0xFF, 0xFF, 0xFF), (0x16, 0xA3, 0x4A)
OUT = Path(__file__).resolve().parent.parent / "website"
DOT_R = 2.4                                   # a touch larger than the 2 of the header mark, so it still reads at 16px

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#14172b"/>
<g transform="translate(16 16.3) scale(1) translate(-12 -12.6)">
<path d="M3 17a9 9 0 0 1 18 0z" fill="#fff"/><rect x="2" y="18.5" width="20" height="2.5" rx="1" fill="#fff"/>
<circle cx="12" cy="6.2" r="{DOT_R}" fill="#16a34a"/></g>
</svg>
"""


def colour_at(x, y, size, rounded):
    """What is at point (x, y) of an icon `size` pixels wide: None (outside), or an RGB."""
    r = size * 7 / 32 if rounded else 0
    if rounded:                                                   # outside the rounded square: transparent
        cx, cy = min(max(x, r), size - r), min(max(y, r), size - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
            return None
    s = size / 32                                                 # the bell sits on the same 32-unit grid as the SVG
    u, v = x / s - 16 + 12, y / s - 16.3 + 12.6                   # back to the mark's 24-unit grid
    if (u - 12) ** 2 + (v - 6.2) ** 2 <= DOT_R ** 2:
        return GREEN
    if v <= 17 and (u - 12) ** 2 + (v - 17) ** 2 <= 81:
        return WHITE
    if 2 <= u <= 22 and 18.5 <= v <= 21:
        return WHITE
    return INK


def png(size, rounded):
    n = 6
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc, hit = [0, 0, 0], 0
            for i in range(n):
                for j in range(n):
                    c = colour_at(px + (i + 0.5) / n, py + (j + 0.5) / n, size, rounded)
                    if c:
                        hit += 1
                        for k in range(3):
                            acc[k] += c[k]
            if hit:
                row += bytes([round(acc[0] / hit), round(acc[1] / hit), round(acc[2] / hit), round(255 * hit / (n * n))])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def ico(png32):
    # an .ico holding one 32x32 PNG: header (reserved, type 1, count 1) + one directory entry + the PNG
    return struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png32), 6 + 16) + png32


def main():
    (OUT / "favicon.svg").write_text(SVG, encoding="utf-8")
    p32 = png(32, True)
    (OUT / "favicon-32.png").write_bytes(p32)
    (OUT / "favicon.ico").write_bytes(ico(p32))
    (OUT / "apple-touch-icon.png").write_bytes(png(180, False))
    for f in ("favicon.svg", "favicon-32.png", "favicon.ico", "apple-touch-icon.png"):
        print(f, (OUT / f).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
