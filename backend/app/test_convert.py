print("SCRIPT STARTED", flush=True)

"""
test_convert.py

Quick local test harness for convert.py. Runs to_png_bytes() on a photo,
saves the result, and opens it in your system's default image viewer.

Usage:
    python test_convert.py path/to/photo.jpg
    python test_convert.py path/to/photo.jpg --no-crop
    DEBUG_MASK=1 python test_convert.py path/to/photo.jpg
"""

import argparse
import os
import sys
from io import BytesIO
from pathlib import Path

print("Imports starting...", flush=True)
from PIL import Image
print("PIL imported", flush=True)
from convert import to_png_bytes
print("convert imported", flush=True)


def main():
    print("main() started", flush=True)
    parser = argparse.ArgumentParser(description="Test convert.py's to_png_bytes()")
    parser.add_argument("image_path", help="Path to a test photo (jpg/png/heic/webp)")
    parser.add_argument("--no-crop", action="store_true", help="Disable auto_crop")
    parser.add_argument(
        "--max-dimension", type=int, default=None, help="Override MAX_IMAGE_DIMENSION for this run"
    )
    parser.add_argument(
        "--out", default="output.png", help="Where to write the converted PNG (default: output.png)"
    )
    parser.add_argument("--no-show", action="store_true", help="Don't auto-open the result")
    args = parser.parse_args()
    print(f"Args parsed: {args}", flush=True)

    image_path = Path(args.image_path)
    if not image_path.exists():
        print(f"File not found: {image_path}", flush=True)
        sys.exit(1)
    print(f"Image file found: {image_path}", flush=True)

    raw = image_path.read_bytes()
    print(f"Read {len(raw)} bytes", flush=True)

    kwargs = {"auto_crop": not args.no_crop}
    if args.max_dimension is not None:
        kwargs["max_dimension"] = args.max_dimension

    print("Calling to_png_bytes...", flush=True)
    png_bytes, capture_date = to_png_bytes(raw, **kwargs)
    print("to_png_bytes returned", flush=True)
    print(f"Capture date: {capture_date}", flush=True)

    out_path = Path(args.out)
    out_path.write_bytes(png_bytes)
    print(f"Wrote {out_path} ({len(png_bytes):,} bytes)", flush=True)

    if not args.no_show:
        print("Opening viewer...", flush=True)
        Image.open(BytesIO(png_bytes)).show()
        print("Viewer call returned", flush=True)


print("About to check __name__", flush=True)
if __name__ == "__main__":
    main()
else:
    print(f"__name__ was {__name__!r}, not '__main__' - main() not called", flush=True)