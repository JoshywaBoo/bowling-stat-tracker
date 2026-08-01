"""
convert.py

Normalizes any uploaded image (JPEG, PNG, HEIC, WEBP, etc.) to PNG bytes,
since that's the format ocr.py / the vision model expects.

Also downscales large images before encoding - phone photos are often
3000-4000px on the long edge, which is far more resolution than the
vision model needs (and just costs bandwidth/tokens for no OCR benefit).

Pulled out of ocr.py's old __main__ block so both the CLI and the web app
use the exact same conversion step.
"""

import os
from io import BytesIO

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# Long-edge cap in pixels. Gemini and most vision models internally resize/tile
# above roughly this range anyway, so sending more doesn't improve OCR accuracy.
# Override with MAX_IMAGE_DIMENSION env var if scoreboard text is coming out blurry.
MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "1000"))


def to_png_bytes(raw_bytes: bytes, max_dimension: int = MAX_IMAGE_DIMENSION) -> bytes:
    """Decode arbitrary image bytes, downscale if needed, and re-encode as PNG bytes."""
    img = Image.open(BytesIO(raw_bytes))

    # Respect camera orientation (EXIF) before doing anything else, otherwise
    # a resize can lock in a sideways/upside-down image.
    img = ImageOps.exif_transpose(img)

    if img.mode != "RGB":
        img = img.convert("RGB")

    width, height = img.size
    if max(width, height) > max_dimension:
        scale = max_dimension / max(width, height)
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        img = img.resize(new_size, Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()