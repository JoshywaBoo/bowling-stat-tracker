"""
ocr.py

Reads a photo of an LED bowling scoreboard using a local Ollama vision model
and returns the frame-by-frame score line as a single string, e.g.:

    X X X 7- 33 X X X X3/

Runs entirely locally through Ollama - no API key, no internet required, no
per-image cost. Accuracy on this stylized LED font will vary more than a
frontier hosted model (Claude/GPT-4-class) would give you, so test it
against a few of your real scoreboard photos before relying on it.

DESIGN NOTE
-----------
The vision model is only asked to read the raw sequence of roll symbols,
left to right, with no grouping into frames. Grouping symbols into frames
requires applying bowling's scoring rules (a strike ends a frame early; a
strike or spare in frame 10 adds bonus rolls) - that's deterministic logic,
not something to leave to an LLM's judgement. So the model just reads
pixels, and parse_frames() in this file does the grouping in plain Python,
which will be 100% consistent as long as the raw symbol reading is correct.

Requires:
    ollama pulled and running locally (https://ollama.com)
    ollama pull qwen2.5vl            (or a lighter model, see MODEL below)
    pip install ollama

To point at a different Ollama host (e.g. once this moves onto its own
Render service), set the OLLAMA_HOST environment variable - the ollama
client reads it automatically, no code change needed here.

Usage as a script (run from the backend/ directory):
    python -m app.ocr path/to/photo.png
    python -m app.ocr path/to/photo.heic     # HEIC converted automatically

Usage as an import (e.g. from a FastAPI route):
    from app.ocr import read_scoreboard
    frame_string = read_scoreboard(image_bytes)
"""

import re
import sys

import ollama

# Swap this for a different pulled model to compare accuracy/speed, e.g.
# "moondream" (much smaller/faster, less accurate) or "llama3.2-vision".
MODEL = "qwen2.5vl"

PROMPT = """This is a photo of a bowling alley's LED scoreboard display.

Read the row of small symbols for one bowler that shows what happened on
each individual roll/ball - NOT the running point totals, and not the
player's name. There are two rows per player, only read the top row.

Symbols you'll see, in order, left to right:
- X = strike
- a digit 0-9 = number of pins knocked down on that roll
- / = spare (this roll's symbol always follows a digit)
- - = a miss / zero pins on that roll
- F = a foul, which counts as a miss (0 pins) for scoring purposes. 

Output ONLY the raw sequence of these symbols, in the exact order they
appear on the display, separated by commas, with no grouping into frames
and no other text. Do not remove any Fs

Do not group rolls into frames yourself, do not add spaces, do not add
frame numbers, and do not include any explanation - output only the
comma-separated symbol sequence."""


def parse_frames(raw_symbols: list[str]) -> str:
    """
    Group a flat, in-order list of roll symbols into a standard 10-frame
    bowling score line, applying real scoring rules (not the model's guess).

    Frames 1-9: a strike ('X') is the whole frame; otherwise two symbols.
    Frame 10: 3 symbols if it opened with a strike or a spare, else 2.
    """
    symbols = list(raw_symbols)
    frames = []
    i = 0

    for frame_num in range(1, 11):
        if i >= len(symbols):
            break

        if frame_num < 10:
            if symbols[i] == "X":
                frames.append(symbols[i])
                i += 1
            else:
                chunk = symbols[i : i + 2]
                frames.append("".join(chunk))
                i += len(chunk)
        else:
            # Frame 10 special-cases bonus rolls.
            r1 = symbols[i]
            if r1 == "X":
                chunk = symbols[i : i + 3]
            else:
                r2 = symbols[i + 1] if i + 1 < len(symbols) else ""
                if r2 == "/":
                    chunk = symbols[i : i + 3]
                else:
                    chunk = symbols[i : i + 2]
            frames.append("".join(chunk))
            i += len(chunk)

    return " ".join(frames)


def read_scoreboard(image_bytes: bytes) -> str:
    """Send scoreboard image bytes to the local Ollama model, then deterministically group the returned rolls into frames."""
    response = ollama.chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": PROMPT,
                "images": [image_bytes],
            }
        ],
    )
    raw = response["message"]["content"].strip()

    # Be forgiving of formatting the model might slip in anyway (spaces,
    # stray newlines, bullet punctuation) - keep only the roll symbols.
    tokens = re.findall(r"X|[0-9]|/|-", raw.replace(",", " "))

    if not tokens:
        # Nothing usable came back - surface the raw text so it's visible
        # for debugging rather than silently returning an empty string.
        return raw

    return parse_frames(tokens)


if __name__ == "__main__":
    from app.convert import to_png_bytes

    if len(sys.argv) != 2:
        sys.exit("Usage: python -m app.ocr path/to/photo.png")

    path = sys.argv[1]

    with open(path, "rb") as f:
        raw_bytes = f.read()

    img_bytes = to_png_bytes(raw_bytes) if not path.lower().endswith(".png") else raw_bytes

    print(read_scoreboard(img_bytes))
