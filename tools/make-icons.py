# Draws the app icons (no dependencies): a university building wearing a graduation cap, on an indigo
# gradient; one window and the tassel are green ("a free room"). Run: python3 tools/make-icons.py → icons/*.png
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

def cap(u, v):
    """Graduation cap in its own 0..1 box → colour or None."""
    TX, TOPY, BOT = 0.78, 0.43, 0.70
    if abs(u - TX) <= 0.018 and TOPY <= v <= BOT - 0.08: return GREEN
    if TX - 0.04 <= u <= TX + 0.04 and BOT - 0.09 <= v <= BOT: return GREEN
    if abs(u - 0.5) / 0.40 + abs(v - 0.38) / 0.17 <= 1:
        if (u - 0.5) ** 2 + (v - 0.38) ** 2 <= 0.032 ** 2: return INK
        if seg_dist(u, v, 0.5, 0.38, TX, TOPY) <= 0.014: return GREEN
        return WHITE
    if 0.29 <= u <= 0.71 and 0.44 <= v <= 0.58 + 0.05 * (1 - ((u - 0.5) / 0.21) ** 2): return SHADE
    return None

def building(u, v):
    """Building in its own 0..1 box → colour or None."""
    if 0.20 <= u <= 0.80 and 0.10 <= v <= 0.86:
        for i in range(3):
            for j in range(3):
                wx, wy = 0.27 + i * 0.17, 0.20 + j * 0.20
                if wx <= u <= wx + 0.12 and wy <= v <= wy + 0.12:
                    return GREEN if (i, j) == (2, 0) else INK
        return WHITE
    if 0.12 <= u <= 0.88 and 0.86 <= v <= 0.92: return WHITE  # steps / ground
    return None

def color_at(x, y, maskable):
    """x, y in 0..1 → (r, g, b, a)."""
    if not maskable:  # rounded square with transparent corners
        r = 0.22
        cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r: return (0, 0, 0, 0)
    bg = lerp(TOP, BOTTOM, (x * 0.4 + y * 0.6))
    s = 0.80 if maskable else 1.0  # maskable: keep the drawing inside the safe zone
    u, v = 0.5 + (x - 0.5) / s, 0.5 + (y - 0.5) / s
    # cap sits on the roof: cap box (0.17..0.83) x (0.06..0.50), building box (0.25..0.75) x (0.38..0.86)
    c = cap((u - 0.17) / 0.66, (v - 0.115) / 0.50)
    if c: return (*c, 255)
    c = building((u - 0.25) / 0.50, (v - 0.37) / 0.52)
    if c: return (*c, 255)
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
