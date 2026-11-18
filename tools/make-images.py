#!/usr/bin/env python3
"""Make site images. Usage: python3 tools/make-images.py [path/to/headshot.jpg]
Without a photo: monogram favicon, apple-touch-icon and OG image.
With a photo: also assets/ben-600.webp (portrait, metadata stripped), assets/ben-300.webp,
and the photo is used in the favicon/apple-touch-icon and the OG image.
Needs Pillow."""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageOps
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
A = os.path.join(ROOT, 'assets'); os.makedirs(A, exist_ok=True)
BRAND = (15, 42, 61); TEAL = (11, 110, 110); LIGHT = (214, 243, 239)
def font(size, bold=True):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/System/Library/Fonts/Helvetica.ttc']:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()
photo = None
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    photo = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB')  # re-encoding drops EXIF
def crop(im, ratio, cy=0.35):
    w, h = im.size
    if w / h > ratio: nw = int(h * ratio); x = (w - nw) // 2; return im.crop((x, 0, x + nw, h))
    nh = int(w / ratio); y = int((h - nh) * cy); return im.crop((0, y, w, y + nh))
def mono(size):
    im = Image.new('RGB', (size, size), BRAND); d = ImageDraw.Draw(im)
    f = font(int(size * .46)); t = 'BL'; b = d.textbbox((0, 0), t, font=f)
    d.text(((size - (b[2] - b[0])) / 2 - b[0], (size - (b[3] - b[1])) / 2 - b[1]), t, font=f, fill=LIGHT); return im
if photo:
    p = crop(photo, 300 / 372).resize((600, 744), Image.LANCZOS); p.save(os.path.join(A, 'ben-600.webp'), 'WEBP', quality=82, method=6)
    p.resize((300, 372), Image.LANCZOS).save(os.path.join(A, 'ben-300.webp'), 'WEBP', quality=82, method=6)
    sq = crop(photo, 1.0, 0.2)
    icon = lambda s: sq.resize((s, s), Image.LANCZOS)
else:
    icon = mono
icon(180).save(os.path.join(A, 'apple-touch-icon.png'), optimize=True)
icon(32).save(os.path.join(A, 'favicon-32.png'), optimize=True)
# OG image 1200x630
og = Image.new('RGB', (1200, 630), BRAND); d = ImageDraw.Draw(og)
for i in range(630):  # soft vertical gradient
    k = i / 630; d.line([(0, i), (1200, i)], fill=(int(15 + 7 * k), int(42 + 32 * k), int(61 + 31 * k)))
x0 = 80
if photo:
    pw = crop(photo, 1.0, 0.2).resize((360, 360), Image.LANCZOS)
    m = Image.new('L', (360, 360), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, 359, 359), 48, fill=255)
    og.paste(pw, (80, 135), m); x0 = 500
d.text((x0, 150), 'Ben Lawson', font=font(92), fill=(255, 255, 255))
d.text((x0, 270), 'People Capability, L&D,', font=font(40, False), fill=LIGHT)
d.text((x0, 322), 'and AI Enablement', font=font(40, False), fill=LIGHT)
pill = 'Paste a job. Get YES or NOT YET.'; pf = font(28); tw = d.textlength(pill, font=pf)
d.rounded_rectangle((x0, 420, x0 + tw + 56, 484), 32, fill=(255, 255, 255))
d.text((x0 + 28, 432), pill, font=pf, fill=BRAND)
og.save(os.path.join(A, 'og.jpg'), 'JPEG', quality=88, optimize=True)
print('images written', 'with photo' if photo else 'monogram only')
