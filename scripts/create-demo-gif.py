#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "icc-go-60s-demo.gif"
W, H = 1180, 760
BG = "#f6f8ff"
INK = "#071a33"
MUTED = "#506050"
GREEN = "#22c55e"
GREEN_DARK = "#0b7a35"
BLUE = "#1f5aaa"
PURPLE = "#6d35e8"
ORANGE = "#a36608"
BORDER = "#b7c9b5"
CARD = "#ffffff"


def font(size, bold=False, mono=False):
    candidates = []
    if mono:
        candidates = [
            "/System/Library/Fonts/SFNSMono.ttf",
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ]
    elif bold:
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


TITLE = font(34, bold=True)
BODY = font(25)
SMALL = font(18)
MONO = font(24, mono=True)
MONO_BOLD = font(24, bold=True, mono=True)


def rounded(draw, box, radius=24, fill=CARD, outline=BORDER, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def wrapped(draw, text, x, y, max_width, fill, line_font, line_gap=7):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        width = draw.textbbox((0, 0), candidate, font=line_font)[2]
        if current and width > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    yy = y
    for line in lines:
        draw.text((x, yy), line, fill=fill, font=line_font)
        yy += line_font.size + line_gap
    return yy


def draw_code(draw, x, y, lines):
    yy = y
    for text, color, bold in lines:
        draw.text((x, yy), text, fill=color, font=MONO_BOLD if bold else MONO)
        yy += 36


def base_frame(step, active_cell=1, artifact=False):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    rounded(draw, (70, 44, W - 70, H - 52), radius=28, fill="#ffffff", outline=BORDER, width=2)
    draw.ellipse((112, 88, 136, 112), fill="#ff6678")
    draw.ellipse((146, 88, 170, 112), fill="#ffbd2e")
    draw.ellipse((180, 88, 204, 112), fill=GREEN)
    draw.text((245, 82), "icc-go/notebook", fill="#6d7b6d", font=font(28, mono=True))
    draw.line((70, 142, W - 70, 142), fill="#d8e4d6", width=2)

    draw.text((112, 176), "60-second ICC-GO workflow", fill=INK, font=TITLE)
    draw.text((112, 221), "c1 -> @forward c2 -> %from c1 -> @file -markdown -> artifact", fill=MUTED, font=BODY)

    cell_y = 278
    for idx, title in [(1, "Generate candidate"), (2, "Review and package"), (3, "Artifact record")]:
        top = cell_y + (idx - 1) * 132
        fill = "#f3fbf6" if idx == active_cell else CARD
        outline = GREEN if idx == active_cell else "#dfe7dd"
        rounded(draw, (112, top, 690, top + 96), radius=20, fill=fill, outline=outline, width=2)
        draw.rounded_rectangle((137, top + 20, 184, top + 68), radius=14, fill="#f7f8f7")
        draw.text((151, top + 29), f"c{idx}", fill=INK, font=font(22, bold=True))
        draw.text((205, top + 21), title, fill=INK, font=font(22, bold=True))
        if idx == 1:
            draw.text((205, top + 55), "> openai.max    @forward c2", fill=BLUE, font=font(18, mono=True))
        elif idx == 2:
            draw.text((205, top + 55), "%from c1    @file -markdown strategy.md", fill=PURPLE, font=font(18, mono=True))
        else:
            label = "strategy.md created" if artifact else "waiting for output"
            draw.text((205, top + 55), label, fill=GREEN_DARK if artifact else MUTED, font=font(18, mono=True))

    panel = (735, 278, 1060, 626)
    rounded(draw, panel, radius=20, fill="#fbfdfa", outline="#d8e4d6", width=2)
    draw.text((765, 306), step["title"], fill=INK, font=font(24, bold=True))
    wrapped(draw, step["body"], 765, 344, 255, MUTED, font(18), line_gap=6)
    draw.line((765, 388, 1030, 388), fill="#e3ebe1", width=2)
    draw_code(draw, 765, 420, step["code"])

    draw.rounded_rectangle((112, 652, 1060, 677), radius=12, fill="#e9f7ef")
    fill_width = 948 * step["progress"] // 8
    draw.rounded_rectangle((112, 652, 112 + fill_width, 677), radius=12, fill=GREEN)
    wrapped(draw, step["caption"], 112, 691, 900, MUTED, SMALL, line_gap=4)
    return img


STEPS = [
    {
        "title": "1. Write the intent",
        "body": "The prompt stays readable, while the route is explicit.",
        "code": [
            ("> openai.max", BLUE, True),
            ("@forward c2", PURPLE, True),
            ("Find an HFT hypothesis.", INK, False),
        ],
        "caption": "Cell c1 is an inspectable unit, not a transient chat message.",
        "progress": 1,
        "active": 1,
        "artifact": False,
    },
    {
        "title": "2. Run c1",
        "body": "ICC-GO compiles route, constraints, and prompt together.",
        "code": [
            ("route: openai.max", BLUE, True),
            ("status: completed", GREEN_DARK, True),
            ("next: c2", PURPLE, True),
        ],
        "caption": "The notebook records what ran and where the output can be reused.",
        "progress": 2,
        "active": 1,
        "artifact": False,
    },
    {
        "title": "3. Forward to c2",
        "body": "@forward c2 moves the workflow to the next cell.",
        "code": [
            ("@forward c2", PURPLE, True),
            ("target: c2", INK, False),
            ("autorun: true", GREEN_DARK, True),
        ],
        "caption": "Flow is visible in the cell header instead of hidden in prose.",
        "progress": 3,
        "active": 2,
        "artifact": False,
    },
    {
        "title": "4. Reuse prior output",
        "body": "%from c1 addresses the previous result directly.",
        "code": [
            ("> claude.max", BLUE, True),
            ("%from c1", GREEN_DARK, True),
            ("Review and improve.", INK, False),
        ],
        "caption": "Outputs become addressable inputs without copy-paste drift.",
        "progress": 4,
        "active": 2,
        "artifact": False,
    },
    {
        "title": "5. Declare a file",
        "body": "@file -markdown makes the artifact contract explicit.",
        "code": [
            ("@file -markdown strategy.md", PURPLE, True),
            ("Required artifact:", ORANGE, True),
            ("strategy.md", INK, False),
        ],
        "caption": "The model is asked for a named file, not a vague answer blob.",
        "progress": 5,
        "active": 2,
        "artifact": False,
    },
    {
        "title": "6. Artifact appears",
        "body": "The generated file is stored next to the run record.",
        "code": [
            ("[file] strategy.md", GREEN_DARK, True),
            ("Copy reference", INK, False),
            ("Download", INK, False),
        ],
        "caption": "Artifacts can be opened, copied, downloaded, and referenced later.",
        "progress": 6,
        "active": 3,
        "artifact": True,
    },
    {
        "title": "7. Inspect the workflow",
        "body": "Cells keep route, constraints, inputs, outputs, and history.",
        "code": [
            ("route: claude.max", BLUE, True),
            ("input: %from c1", GREEN_DARK, True),
            ("artifact: strategy.md", PURPLE, True),
        ],
        "caption": "A notebook can be reviewed like code instead of read like chat.",
        "progress": 7,
        "active": 3,
        "artifact": True,
    },
    {
        "title": "8. Package and share",
        "body": "Export the notebook and artifacts as a reproducible bundle.",
        "code": [
            ("local-first", GREEN_DARK, True),
            ("BYOK", BLUE, True),
            ("reproducible workflow", INK, False),
        ],
        "caption": "ICC-GO keeps the workflow portable and inspectable.",
        "progress": 8,
        "active": 3,
        "artifact": True,
    },
]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [base_frame(step, active_cell=step["active"], artifact=step["artifact"]) for step in STEPS]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=[7500] * len(frames),
        loop=0,
        optimize=True,
    )
    print(f"Generated {OUT}")


if __name__ == "__main__":
    main()
