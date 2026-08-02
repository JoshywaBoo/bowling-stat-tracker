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
import math
import pillow_heif
from PIL import Image, ImageOps
from datetime import datetime

pillow_heif.register_heif_opener()

# Long-edge cap in pixels. Gemini and most vision models internally resize/tile
# above roughly this range anyway, so sending more doesn't improve OCR accuracy.
# Override with MAX_IMAGE_DIMENSION env var if scoreboard text is coming out blurry.
MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "1000"))

# Override with MAX_DETECTION_DIMENSION env var if detection is unreliable.
MAX_DETECTION_DIMENSION = int(os.environ.get("MAX_DETECTION_DIMENSION", "2000"))

# If the detected "screen" region is smaller than this fraction of the total
# image area, treat detection as unreliable and skip cropping. Guards against
# accidentally cropping to some other bright object in the ceiling.
MIN_CROP_AREA_FRACTION = 0.03

# Extra margin added around the detected screen so we don't clip the bezel
# or the very edge of the scoreboard's outermost column.
CROP_PADDING_FRACTION = 0.04


def extract_capture_date(img: Image.Image) -> str | None:
    """Read EXIF DateTimeOriginal (falls back to DateTime) and return an
    ISO 8601 string, or None if the image has no usable EXIF timestamp
    (common for screenshots, edited photos, or images that stripped EXIF)."""
    try:
        exif = img.getexif()
        if not exif:
            return None

        # DateTimeOriginal (36867) is when the shutter fired - what we want.
        # DateTime (306) is "file modified" and can reflect an edit, not
        # the capture - only used as a fallback if the original is missing.
        raw = exif.get(36867) or exif.get(306)
        if not raw:
            return None

        # EXIF datetimes look like "2024:08:01 14:32:07"
        dt = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
        return dt.isoformat()
    except Exception:
        # Malformed EXIF shouldn't break the upload - just skip the date.
        return None


def detect_scoreboard_box(img: Image.Image) -> tuple[int, int, int, int] | None:
    arr = np.array(img)
    img_bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    h_img, w_img = img_bgr.shape[:2]
    img_cx, img_cy = w_img / 2, h_img / 2

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    _, s, v = cv2.split(hsv)
    mask = ((s > 60) & (v > 80)).astype(np.uint8) * 255

    # Larger closing kernel than before (35 vs 15) - bridges small gaps
    # like the divider line between a scoreboard's score grid and its
    # info bar, so the whole screen forms one blob instead of fragmenting.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((35, 35), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))

    # debug mask output for testing
    if os.environ.get("DEBUG_MASK"):
        Image.fromarray(mask).save("debug_mask.png")

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    total_area = w_img * h_img
    candidates = [
        cv2.boundingRect(c) for c in contours
        if cv2.contourArea(c) >= total_area * MIN_CROP_AREA_FRACTION
    ]
    if not candidates:
        return None

    # A bowling scoreboard's roll grid and its info panel (name, speed,
    # team, lane graphic) are often two separate bright/saturated blobs
    # even after closing - e.g. if a divider line is thin or the panels
    # differ slightly in brightness. Picking only the single blob nearest
    # the image center can grab just the info panel and crop out the
    # actual roll grid entirely.
    #
    # Instead, keep every sufficiently large candidate that's reasonably
    # close to the frame center (so we don't pull in something unrelated,
    # like a lit sign off to the side), and take the union of their
    # bounding boxes. This tends to capture the whole lit display - all
    # of its panels - rather than just one piece of it.
    max_dist = math.hypot(w_img, h_img) / 2
    center_candidates = [
        box for box in candidates
        if dist_to_center(box, img_cx, img_cy) <= max_dist * 0.6
    ]
    if not center_candidates:
        # Nothing was close enough to center - fall back to the single
        # nearest candidate rather than refusing to crop at all.
        center_candidates = [min(candidates, key=lambda b: dist_to_center(b, img_cx, img_cy))]

    x0 = min(bx for bx, by, bw, bh in center_candidates)
    y0 = min(by for bx, by, bw, bh in center_candidates)
    x1 = max(bx + bw for bx, by, bw, bh in center_candidates)
    y1 = max(by + bh for bx, by, bw, bh in center_candidates)
    w, h = x1 - x0, y1 - y0
    x, y = x0, y0

    pad_x, pad_y = int(w * CROP_PADDING_FRACTION), int(h * CROP_PADDING_FRACTION)
    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(w_img, x + w + pad_x)
    y1 = min(h_img, y + h + pad_y)
    return (x0, y0, x1, y1)


def dist_to_center(box: tuple[int, int, int, int], cx: float, cy: float) -> float:
    x, y, w, h = box
    return math.hypot((x + w / 2) - cx, (y + h / 2) - cy)


def to_png_bytes(
    raw_bytes: bytes,
    max_dimension: int = MAX_IMAGE_DIMENSION,
    auto_crop: bool = True,
) -> tuple[bytes, str | None]:
    """Decode arbitrary image bytes, downscale if needed, and re-encode as
    PNG bytes. Returns (png_bytes, capture_date) where capture_date is an
    ISO 8601 string read from EXIF, or None if unavailable."""
    img = Image.open(BytesIO(raw_bytes))

    # Read capture date before any transform touches the image. Orientation
    # transposes don't strip EXIF, but this keeps the read as close to the
    # original file as possible so nothing downstream can affect it.
    capture_date = extract_capture_date(img)

    # Respect camera orientation (EXIF) before doing anything else, otherwise
    # a resize can lock in a sideways/upside-down image.
    img = ImageOps.exif_transpose(img)

    if img.mode != "RGB":
        img = img.convert("RGB")

    if auto_crop:
        width, height = img.size
        if max(width, height) > MAX_DETECTION_DIMENSION:
            detect_scale = MAX_DETECTION_DIMENSION / max(width, height)
            detect_size = (
                max(1, int(width * detect_scale)),
                max(1, int(height * detect_scale)),
            )
            detect_img = img.resize(detect_size, Image.BILINEAR)
            box = detect_scoreboard_box(detect_img)
            if box is not None:
                inv_scale = 1 / detect_scale
                x0, y0, x1, y1 = box
                img = img.crop((
                    int(x0 * inv_scale),
                    int(y0 * inv_scale),
                    int(x1 * inv_scale),
                    int(y1 * inv_scale),
                ))
        else:
            box = detect_scoreboard_box(img)
            if box is not None:
                img = img.crop(box)

    width, height = img.size
    if max(width, height) > max_dimension:
        scale = max_dimension / max(width, height)
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        img = img.resize(new_size, Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), capture_date