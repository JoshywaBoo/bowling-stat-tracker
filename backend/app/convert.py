"""
convert.py

Normalizes any uploaded image (JPEG, PNG, HEIC, WEBP, etc.) to PNG bytes,
since that's the format ocr.py / the Ollama vision model expects.

Pulled out of ocr.py's old __main__ block so both the CLI and the web app
use the exact same conversion step.
"""

from io import BytesIO

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()


def to_png_bytes(raw_bytes: bytes) -> bytes:
    """Decode arbitrary image bytes and re-encode as PNG bytes."""
    img = Image.open(BytesIO(raw_bytes)).convert("RGB")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
