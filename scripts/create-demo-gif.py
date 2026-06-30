#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEMO_SOURCE_SCREENSHOT = ROOT / "docs" / "assets" / "icc-go-demo-source.png"
DEMO_SOURCE_C3_SCREENSHOT = ROOT / "docs" / "assets" / "icc-go-demo-source-c3.png"
SITE_SCREENSHOT = ROOT.parent / "icc-go-site" / "public" / "screenshots" / "notebook-home.png"
OUT = ROOT / "docs" / "assets" / "icc-go-60s-demo.gif"

W, H = 1180, 760
CAPTION_H = 90
SHOT_H = H - CAPTION_H
BG = "#f5f7ff"
INK = "#101010"
MUTED = "#62625d"
GREEN = "#29b83a"
GREEN_SOFT = "#e9f8ee"
BORDER = "#c7d8c5"
WHITE = "#ffffff"


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


TITLE = font(26, bold=True)
BODY = font(21)
SMALL = font(18)


SOURCES = {
    "top": DEMO_SOURCE_SCREENSHOT,
    "c3": DEMO_SOURCE_C3_SCREENSHOT,
}


def source_image(name="top"):
    preferred = SOURCES.get(name, DEMO_SOURCE_SCREENSHOT)
    source = preferred if preferred.exists() else DEMO_SOURCE_SCREENSHOT
    source = source if source.exists() else SITE_SCREENSHOT
    if not source.exists():
        raise FileNotFoundError(
            f"Demo GIF needs a real notebook screenshot at {DEMO_SOURCE_SCREENSHOT} or {SITE_SCREENSHOT}."
        )
    return Image.open(source).convert("RGB")


def cover_to_viewport(image, focus_rect):
    scale = max(W / image.width, SHOT_H / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - W) // 2)
    _, focus_y, _, focus_height = focus_rect
    focus_center = round((focus_y + focus_height / 2) * scale)
    top = max(0, min(resized.height - SHOT_H, focus_center - SHOT_H // 2))
    crop = resized.crop((left, top, left + W, top + SHOT_H))
    return crop, scale, left, top


def transform_rect(rect, scale, left, top):
    x, y, width, height = rect
    return (
        round(x * scale - left),
        round(y * scale - top),
        round((x + width) * scale - left),
        round((y + height) * scale - top),
    )


def wrap_text(draw, text, max_width, line_font):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textbbox((0, 0), candidate, font=line_font)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def frame(step):
    source = source_image(step.get("source", "top"))
    base, scale, left, top = cover_to_viewport(source, step["rect"])
    img = Image.new("RGB", (W, H), BG)
    img.paste(base, (0, 0))

    draw = ImageDraw.Draw(img)
    rect = transform_rect(step["rect"], scale, left, top)
    draw.rounded_rectangle(rect, radius=16, outline=GREEN, width=4)

    draw.rounded_rectangle((0, SHOT_H, W, H), radius=0, fill=WHITE)
    draw.line((0, SHOT_H, W, SHOT_H), fill=BORDER, width=2)
    draw.rounded_rectangle((42, SHOT_H + 24, 114, SHOT_H + 58), radius=17, fill=GREEN_SOFT)
    draw.text((65, SHOT_H + 28), step["index"], fill=GREEN, font=SMALL)
    draw.text((138, SHOT_H + 18), step["title"], fill=INK, font=TITLE)

    y = SHOT_H + 52
    for line in wrap_text(draw, step["caption"], W - 180, BODY):
        draw.text((138, y), line, fill=MUTED, font=BODY)
        y += 26
    return img


STEPS = [
    {
        "index": "01",
        "title": "Draft product spec",
        "caption": "c1 keeps the prompt readable while route, output limit, and @forward c2 stay explicit.",
        "rect": (285, 125, 820, 435),
    },
    {
        "index": "02",
        "title": "Critique with context",
        "caption": "c2 can reuse %from c1 directly, so prior output becomes addressable input instead of copied chat text.",
        "rect": (285, 565, 820, 370),
    },
    {
        "index": "03",
        "title": "Export an artifact",
        "caption": "c3 declares @file -markdown final_spec.md, making the expected output visible before the run.",
        "rect": (285, 500, 820, 425),
        "source": "c3",
    },
    {
        "index": "04",
        "title": "Inspect and share",
        "caption": "The notebook preserves cells, references, run history, and generated files as one reproducible workflow.",
        "rect": (1120, 78, 300, 790),
    },
]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [frame(step) for step in STEPS]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=[2600, 2600, 2600, 3000],
        loop=0,
        optimize=True,
    )
    print(f"Generated {OUT}")


if __name__ == "__main__":
    main()
