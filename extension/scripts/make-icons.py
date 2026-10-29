# Generates the calm sage "nudge" icon (a soft circle with a small rising dot).
from PIL import Image, ImageDraw
import os

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 128):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, s - 1, s - 1), fill=(79, 125, 102, 255))
    # gentle arc ("a hand up")
    w = max(2, s // 11)
    d.arc((s * 0.24, s * 0.30, s * 0.76, s * 0.82), start=200, end=340, fill=(246, 245, 241, 255), width=w)
    r = s * 0.09
    cx, cy = s * 0.5, s * 0.36
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(246, 238, 221, 255))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(out, f'icon{size}.png'))
print('icons written')
