"""Generate Substack header banners from the adamdaniel.ai design tokens.

Output: 2688x512 PNG (2x of 1344x256, exactly 21:4 — the wide banner end
of Substack's 3:2..21:4 allowed range).
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 2688, 512
OUT = "/home/user/adamdaniel.ai/brand/substack"

# --- design tokens (assets/css/main.css :root) -----------------------------
BG0      = (4, 6, 15)       # --bg-0  #04060f  site base
BG1      = (8, 12, 30)      # #080c1e  (Substack bg the user chose)
BG_DARK  = (3, 4, 12)       # #03040c  thermal low point
ACCENT   = (40, 90, 255)    # --accent #285aff
TEXT     = (216, 228, 255)  # --text-primary #d8e4ff (user's Substack accent)
TEXT_DIM = (138, 176, 232)  # --text-dim #8ab0e8

MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
MONO_R = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def vgrad(top, bot):
    """Vertical gradient base."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    return img.convert("RGBA")


def glow(cx, cy, rx, ry, color, alpha):
    """Soft radial glow via a blurred low-res ellipse, upscaled."""
    s = 12
    lw, lh = W // s, H // s
    layer = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(
        [ (cx - rx) // s, (cy - ry) // s, (cx + rx) // s, (cy + ry) // s ],
        fill=color + (alpha,),
    )
    layer = layer.resize((W, H), Image.BICUBIC).filter(
        ImageFilter.GaussianBlur(60)
    )
    return layer


def textsize(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1], b[0], b[1]


def variant_wordmark():
    base = vgrad((9, 14, 34), BG0)                       # subtle top sheen
    base = Image.alpha_composite(base, glow(int(W * 0.74), int(H * 0.42),
                                            900, 620, ACCENT, 80))
    base = Image.alpha_composite(base, glow(int(W * 0.10), int(H * 0.85),
                                            700, 480, BG_DARK, 150))
    d = ImageDraw.Draw(base)

    name = "adamdaniel.ai"
    f = ImageFont.truetype(MONO_B, 168)
    tw, th, ox, oy = textsize(d, name, f)
    x = 200
    y = int(H * 0.40) - th // 2 - oy
    d.text((x, y), name, font=f, fill=TEXT)

    # thin cobalt rule under the wordmark
    ry = y + oy + th + 40
    d.rounded_rectangle([x, ry, x + tw, ry + 8], radius=4, fill=ACCENT + (235,))

    tag = "essays · systems · notes"
    ft = ImageFont.truetype(MONO_R, 52)
    d.text((x + 4, ry + 40), tag, font=ft, fill=TEXT_DIM)

    base.convert("RGB").save(f"{OUT}/header-wordmark.png")


def variant_thermal():
    base = vgrad(BG0, BG_DARK)
    # wide luminous thermal sweep across the middle
    base = Image.alpha_composite(base, glow(int(W * 0.50), int(H * 0.50),
                                            1700, 360, ACCENT, 70))
    base = Image.alpha_composite(base, glow(int(W * 0.50), int(H * 0.50),
                                            900, 220, ACCENT, 70))
    # edge vignette for depth
    base = Image.alpha_composite(base, glow(int(W * -0.05), int(H * 0.5),
                                            600, 900, BG_DARK, 170))
    base = Image.alpha_composite(base, glow(int(W * 1.05), int(H * 0.5),
                                            600, 900, BG_DARK, 170))
    d = ImageDraw.Draw(base)

    name = "adamdaniel.ai"
    f = ImageFont.truetype(MONO_B, 184)
    tw, th, ox, oy = textsize(d, name, f)
    x = (W - tw) // 2 - ox
    y = int(H * 0.46) - th // 2 - oy
    d.text((x, y), name, font=f, fill=TEXT)

    ry = y + oy + th + 44
    rw = tw // 2
    d.rounded_rectangle(
        [(W - rw) // 2, ry, (W + rw) // 2, ry + 8], radius=4,
        fill=ACCENT + (235,),
    )
    base.convert("RGB").save(f"{OUT}/header-thermal.png")


variant_wordmark()
variant_thermal()
print("done")
