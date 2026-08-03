"""
ocr.py

Reads a photo of an LED bowling scoreboard using a Gemini vision model
and returns the frame-by-frame score line as a single string, e.g.:

    X X X 7- 33 X X X X3/

DESIGN NOTE
-----------
The vision model is only asked to read the raw sequence of roll symbols,
left to right, with no grouping into frames. Grouping symbols into frames
requires applying bowling's scoring rules (a strike ends a frame early; a
strike or spare in frame 10 adds bonus rolls) - that's deterministic logic,
not something to leave to an LLM's judgement. So the model just reads
pixels, and parse_frames() in this file does the grouping in plain Python,
which will be 100% consistent as long as the raw symbol reading is correct.

Usage as a script (run from the backend/ directory):
    python -m app.ocr path/to/photo.png
    python -m app.ocr path/to/photo.heic     # HEIC converted automatically

Usage as an import (e.g. from a FastAPI route):
    from app.ocr import read_scoreboard
    frame_string = read_scoreboard(image_bytes)
"""

import re
import sys

import os
from google import genai
from google.genai import types
import json

from dotenv import load_dotenv
load_dotenv()

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = os.environ.get("MODEL", "gemini-3.5-flash-lite")

PROMPT = """This is a photo of a bowling alley's LED scoreboard display,
showing one or more bowlers.

For EACH bowler shown, read:
- their name (as displayed)
- the row of roll symbols (top row of their two rows - NOT the running
  point totals row)

Symbols: X = strike, 1-9 = pins knocked down, / = spare, - = miss, F = foul.

SPLITS: many scoreboards visually flag a split (a specific pattern of
remaining pins after the first roll of a frame) by highlighting, circling,
or coloring that roll's digit differently from the others. If a roll's
symbol is shown with this kind of visual split indicator, prefix that
symbol with an asterisk, e.g. "*7" instead of "7". Only the roll that is
visually marked gets the asterisk - do not infer splits from the numbers
yourself, only report what is visually indicated on the display. If you
see no visual split indicators anywhere, don't add any asterisks.

Return a JSON array, one object per bowler, in left-to-right/top-to-bottom
display order:
[{"name": "...", "rolls": "X,7,-,*9,/,..."}, ...]

Output ONLY the JSON array, no other text."""


def parse_frames(raw_symbols: list[str]) -> str:
    """
    Group a flat, in-order list of roll symbols into a standard 10-frame
    bowling score line, applying real scoring rules (not the model's guess).

    Frames 1-9: a strike ('X') is the whole frame; otherwise two symbols.
    Frame 10: 3 symbols if it opened with a strike or a spare, else 2.

    Each symbol may optionally carry a leading '*' (split indicator, as
    reported by the vision model). The '*' is cosmetic - all frame-boundary
    logic below is based on the bare symbol - but it's preserved in the
    output chunks unchanged, matching the frontend's split-marker format.
    """
    def bare(tok: str) -> str:
        return tok[1:] if tok.startswith("*") else tok

    symbols = list(raw_symbols)
    frames = []
    i = 0

    for frame_num in range(1, 11):
        if i >= len(symbols):
            break

        if frame_num < 10:
            if bare(symbols[i]) == "X":
                frames.append(symbols[i])
                i += 1
            else:
                chunk = symbols[i : i + 2]
                frames.append("".join(chunk))
                i += len(chunk)
        else:
            # Frame 10 special-cases bonus rolls.
            r1 = symbols[i]
            if bare(r1) == "X":
                chunk = symbols[i : i + 3]
            else:
                r2 = symbols[i + 1] if i + 1 < len(symbols) else ""
                if bare(r2) == "/":
                    chunk = symbols[i : i + 3]
                else:
                    chunk = symbols[i : i + 2]
            frames.append("".join(chunk))
            i += len(chunk)

    return " ".join(frames)


def read_scoreboard(image_bytes: bytes) -> str:
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            PROMPT,
        ],
    )
    raw = response.text.strip()

    # Be forgiving of formatting the model might slip in anyway (spaces,
    # stray newlines, bullet punctuation) - keep only the roll symbols.
    tokens = re.findall(r"\*?(?:X|[0-9]|/|-|F)", raw.replace(",", " "))

    if not tokens:
        # Nothing usable came back - surface the raw text so it's visible
        # for debugging rather than silently returning an empty string.
        return raw

    return parse_frames(tokens)


def read_scoreboard_multiplayer(image_bytes: bytes) -> list[dict]:
    """
    TEST-ONLY: parallel implementation for multiplayer support, not yet
    wired into main.py. Returns one {"name", "frame_string"} dict per
    bowler detected in the photo.
    """
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            PROMPT,
        ],
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    raw = response.text.strip()

    print("--- raw model output ---")
    print(raw)
    print("------------------------")

    players = json.loads(raw)  # let this throw on malformed JSON - we want to see it

    if not isinstance(players, list):
        raise ValueError(f"Expected a JSON array, got: {type(players)}")

    results = []
    for i, p in enumerate(players):
        name = p.get("name", "").strip()
        rolls_raw = p.get("rolls", "")
        tokens = re.findall(r"\*?(?:X|[0-9]|/|-|F)", rolls_raw.replace(",", " "))

        if not tokens:
            print(f"WARNING: player {i} ('{name}') had no readable rolls: {rolls_raw!r}")

        results.append({
            "name": name,
            "frame_string": parse_frames(tokens) if tokens else "",
        })

    return results


if __name__ == "__main__":

    from app.convert import to_png_bytes

    if len(sys.argv) != 2:
        sys.exit("Usage: python -m app.ocr path/to/photo.png")

    path = sys.argv[1]

    with open(path, "rb") as f:
        raw_bytes = f.read()

    img_bytes = to_png_bytes(raw_bytes) if not path.lower().endswith(".png") else raw_bytes

    for player in read_scoreboard_multiplayer(img_bytes):
        print(player)