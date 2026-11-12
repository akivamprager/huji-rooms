# Draws the app icons (no dependencies): a building and a magnifying glass on an indigo gradient; the
# window seen through the lens is green ("found a free room"). Run: python3 tools/make-icons.py → icons/*.png
import struct, zlib, os

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

TOP, BOTTOM = (91, 108, 240), (22, 31, 85)
WHITE, SHADE, GREEN, INK = (255, 255, 255), (214, 220, 255), (69, 211, 155), (40, 52, 140)

def seg_dist(u, v, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    t = max(0, min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)))
    return ((u - x1 - t * dx) ** 2 + (v - y1 - t * dy) ** 2) ** .5

def color_at(x, y, maskable):
    """x, y in 0..1 → (r, g, b, a)."""
    if not maskable:  # rounded square with transparent corners
        r = 0.22
        cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r: return (0, 0, 0, 0)
    bg = lerp(TOP, BOTTOM, (x * 0.4 + y * 0.6))
    s = 0.80 if maskable else 1.0  # maskable: keep the drawing inside the safe zone
    u, v = 0.5 + (x - 0.5) / s, 0.5 + (y - 0.5) / s

    # magnifying glass, bottom-right, over the building
    MX, MY, R, RING = 0.62, 0.60, 0.17, 0.045
    d = ((u - MX) ** 2 + (v - MY) ** 2) ** .5
    hx, hy = MX + R * 0.72, MY + R * 0.72                 # handle starts on the rim at 45°
    handle = seg_dist(u, v, hx, hy, 0.86, 0.84)
    if handle <= 0.042: return (*WHITE, 255)
    if R - RING <= d <= R: return (*WHITE, 255)
    if d < R - RING:                                       # inside the lens: a big green window
        return (*GREEN, 255) if abs(u - MX) <= 0.06 and abs(v - MY) <= 0.06 else (*lerp(bg, WHITE, 0.25), 255)
    if d <= R + 0.03 or handle <= 0.072: return (*bg, 255)  # gap around the glass

    # building with a pediment and a 3 x 3 grid of windows
    if 0.16 <= u <= 0.70 and 0.30 <= v <= 0.80:
        for i in range(3):
            for j in range(3):
                wx, wy = 0.22 + i * 0.165, 0.38 + j * 0.13
                if wx <= u <= wx + 0.10 and wy <= v <= wy + 0.08: return (*INK, 255)
        return (*WHITE, 255)
    if 0.30 > v >= 0.16 and abs(u - 0.43) <= 0.31 * (v - 0.16) / 0.14: return (*WHITE, 255)  # roof
    if 0.11 <= u <= 0.75 and 0.80 <= v <= 0.85: return (*WHITE, 255)  # ground line
    return (*bg, 255)

def render(size, maskable=False, ss=3):
    px = []
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = color_at((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size, maskable)
                    a = c[3]
                    acc[0] += c[0] * a; acc[1] += c[1] * a; acc[2] += c[2] * a; acc[3] += a
            n = ss * ss
            a = acc[3] / n
            px += [round(acc[0] / acc[3]) if acc[3] else 0, round(acc[1] / acc[3]) if acc[3] else 0,
                   round(acc[2] / acc[3]) if acc[3] else 0, round(a)]
    return px

root = os.path.join(os.path.dirname(__file__), '..', 'icons')
for size, mask, name in [(192, False, 'icon-192.png'), (512, False, 'icon-512.png'),
                         (512, True, 'maskable-512.png'), (180, True, 'apple-touch-icon.png'), (64, False, 'favicon-64.png')]:
    png(os.path.join(root, name), size, size, render(size, mask, 3 if size <= 192 else 2))
    print(name)
