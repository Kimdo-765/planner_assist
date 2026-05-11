#!/usr/bin/env python3
"""Generate PNG app icons (192, 512) without external SVG renderers."""
from PIL import Image, ImageDraw, ImageFilter
import os, math

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size[0]-1, size[1]-1), radius=radius, fill=255)
    return m

def draw_plane(img, color=(255, 255, 255, 255), scale=1.0, angle_deg=-25):
    w, h = img.size
    plane = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plane)
    cx, cy = w/2, h/2
    s = (min(w, h)/512) * scale
    poly = [
        (-150, -10), (-40, -20), (0, -110), (40, -110),
        (20, -25), (130, -10), (150, 10), (30, 40),
        (0, 140), (-40, 140), (-25, 50), (-130, 40), (-150, 20)
    ]
    rad = math.radians(angle_deg)
    cosA, sinA = math.cos(rad), math.sin(rad)
    pts = []
    for x, y in poly:
        x2 = x * s
        y2 = y * s
        rx = x2 * cosA - y2 * sinA
        ry = x2 * sinA + y2 * cosA
        pts.append((cx + rx, cy + ry))
    pd.polygon(pts, fill=color)
    img.alpha_composite(plane)

def make_gradient(size, top=(26, 115, 232), bottom=(13, 71, 161)):
    w, h = size
    base = Image.new('RGBA', size, top + (255,))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(h-1, 1)
        r = int(top[0]*(1-t) + bottom[0]*t)
        g = int(top[1]*(1-t) + bottom[1]*t)
        b = int(top[2]*(1-t) + bottom[2]*t)
        d.line([(0, y), (w, y)], fill=(r, g, b, 255))
    return base

def build_icon(size, maskable=False):
    img = make_gradient((size, size))
    if not maskable:
        radius = int(size * 0.20)
        mask = rounded_mask((size, size), radius)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    draw_plane(img, color=(255, 255, 255, 255), scale=0.95)
    return img

def main():
    os.makedirs(OUT, exist_ok=True)
    for sz in (192, 512):
        icon = build_icon(sz, maskable=True)
        icon.save(os.path.join(OUT, f'icon-{sz}.png'))
        print('wrote', os.path.join(OUT, f'icon-{sz}.png'))

if __name__ == '__main__':
    main()
