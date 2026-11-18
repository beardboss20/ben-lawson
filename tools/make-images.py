#!/usr/bin/env python3
"""Make site images. Usage: python3 tools/make-images.py [path/to/headshot.jpg]
Without a photo: monogram favicon, apple-touch-icon and OG image.
With a photo: also assets/ben-480 and ben-960 in WebP and JPEG (4:5 portrait,
metadata stripped), and the photo is used in the favicon/apple-touch-icon and
the OG image.
Needs Pillow."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
A = os.path.join(ROOT, 'assets')
os.makedirs(A, exist_ok=True)
BRAND = (15, 42, 61)
TEAL = (11, 110, 110)
LIGHT = (214, 243, 239)
# Classic 4:5 portrait; 480 and 960 widths are exact.
PORTRAIT_RATIO = 4 / 5
PORTRAIT_SIZES = ((480, 600), (960, 1200))


def font(size, bold=True):
    for p in [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def clean_rgb(im):
    """Copy pixels into a new RGB image so EXIF, GPS, ICC, and comments are dropped."""
    out = Image.new('RGB', im.size)
    out.paste(im)
    return out


def crop(im, ratio, cy=0.35):
    """Center crop to ratio, with cy biasing the window toward the face (0 = top, 1 = bottom)."""
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio)
        x = (w - nw) // 2
        return im.crop((x, 0, x + nw, h))
    nh = int(w / ratio)
    y = int((h - nh) * cy)
    return im.crop((0, y, w, y + nh))


def save_webp(im, path, quality=82):
    clean_rgb(im).save(path, 'WEBP', quality=quality, method=6)


def save_jpeg(im, path, quality=85):
    clean_rgb(im).save(path, 'JPEG', quality=quality, optimize=True, progressive=True)


photo = None
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    photo = clean_rgb(ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB'))


def mono(size):
    im = Image.new('RGB', (size, size), BRAND)
    d = ImageDraw.Draw(im)
    f = font(int(size * .46))
    t = 'BL'
    b = d.textbbox((0, 0), t, font=f)
    d.text(((size - (b[2] - b[0])) / 2 - b[0], (size - (b[3] - b[1])) / 2 - b[1]), t, font=f, fill=LIGHT)
    return im


if photo:
    # cy=0.35 keeps the face high in the 4:5 frame and a little of the shoulders.
    portrait = crop(photo, PORTRAIT_RATIO, cy=0.35)
    for w, h in PORTRAIT_SIZES:
        resized = portrait.resize((w, h), Image.LANCZOS)
        save_webp(resized, os.path.join(A, f'ben-{w}.webp'))
        save_jpeg(resized, os.path.join(A, f'ben-{w}.jpg'), quality=85 if w <= 480 else 82)
    for stale in ('ben-300.webp', 'ben-600.webp'):
        p = os.path.join(A, stale)
        if os.path.exists(p):
            os.remove(p)
    sq = crop(photo, 1.0, 0.2)
    def icon(s):
        return sq.resize((s, s), Image.LANCZOS)
else:
    icon = mono

icon(180).save(os.path.join(A, 'apple-touch-icon.png'), optimize=True)
icon(32).save(os.path.join(A, 'favicon-32.png'), optimize=True)

# OG image 1200x630
og = Image.new('RGB', (1200, 630), BRAND)
d = ImageDraw.Draw(og)
for i in range(630):  # soft vertical gradient
    k = i / 630
    d.line([(0, i), (1200, i)], fill=(int(15 + 7 * k), int(42 + 32 * k), int(61 + 31 * k)))
x0 = 80
if photo:
    pw = crop(photo, 1.0, 0.2).resize((360, 360), Image.LANCZOS)
    m = Image.new('L', (360, 360), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, 359, 359), 48, fill=255)
    og.paste(pw, (80, 135), m)
    x0 = 500
d.text((x0, 150), 'Ben Lawson', font=font(92), fill=(255, 255, 255))
d.text((x0, 270), 'People Capability, L&D,', font=font(40, False), fill=LIGHT)
d.text((x0, 322), 'and AI Enablement', font=font(40, False), fill=LIGHT)
pill = 'Paste a job. Get YES or NOT YET.'
pf = font(28)
tw = d.textlength(pill, font=pf)
d.rounded_rectangle((x0, 420, x0 + tw + 56, 484), 32, fill=(255, 255, 255))
d.text((x0 + 28, 432), pill, font=pf, fill=BRAND)
save_jpeg(og, os.path.join(A, 'og.jpg'), quality=88)
print('images written', 'with photo' if photo else 'monogram only')
