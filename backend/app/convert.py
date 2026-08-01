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

import cv2
import numpy as np
import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# Long-edge cap in pixels. Gemini and most vision models internally resize/tile
# above roughly this range anyway, so sending more doesn't improve OCR accuracy.
# Override with MAX_IMAGE_DIMENSION env var if scoreboard text is coming out blurry.
MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "1000"))

# If the detected "screen" region is smaller than this fraction of the total
# image area, treat detection as unreliable and skip cropping. Guards against
# accidentally cropping to some other bright object in the ceiling.
MIN_CROP_AREA_FRACTION = 0.03

# Extra margin added around the detected screen so we don't clip the bezel
# or the very edge of the scoreboard's outermost column.
CROP_PADDING_FRACTION = 0.04


def _detect_scoreboard_box(img: Image.Image) -> tuple[int, int, int, int] | None:
    """Find the bounding box of the scoreboard monitor in a photo.

    Bowling scoreboard screens are backlit and glow - high brightness and
    high saturation - against a comparatively dark ceiling/rigging
    background. We threshold on that, clean up the mask, and take the
    largest resulting blob as the screen.

    Returns (x0, y0, x1, y1) in pixel coordinates, or None if nothing
    confident was found (caller should fall back to using the full image).
    """
    arr = np.array(img)  # RGB
    img_bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    h_img, w_img = img_bgr.shape[:2]

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    _, s, v = cv2.split(hsv)
    mask = ((s > 60) & (v > 80)).astype(np.uint8) * 255

    kernel = np.ones((15, 15), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(best)
    if area < (w_img * h_img) * MIN_CROP_AREA_FRACTION:
        return None

    x, y, w, h = cv2.boundingRect(best)
    pad_x = int(w * CROP_PADDING_FRACTION)
    pad_y = int(h * CROP_PADDING_FRACTION)

    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(w_img, x + w + pad_x)
    y1 = min(h_img, y + h + pad_y)
    return (x0, y0, x1, y1)


def to_png_bytes(
    raw_bytes: bytes,
    max_dimension: int = MAX_IMAGE_DIMENSION,
    auto_crop: bool = True,
) -> bytes:
    """Decode arbitrary image bytes, downscale if needed, and re-encode as PNG bytes."""
    img = Image.open(BytesIO(raw_bytes))

    # Respect camera orientation (EXIF) before doing anything else, otherwise
    # a resize can lock in a sideways/upside-down image.
    img = ImageOps.exif_transpose(img)

    if img.mode != "RGB":
        img = img.convert("RGB")

    if img.mode != "RGB":
        img = img.convert("RGB")

    if auto_crop:                   
        box = _detect_scoreboard_box(img)
        if box is not None:
            img = img.crop(box)

    width, height = img.size
    if max(width, height) > max_dimension:
        scale = max_dimension / max(width, height)
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        img = img.resize(new_size, Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()