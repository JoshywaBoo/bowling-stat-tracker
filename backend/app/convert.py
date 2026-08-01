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
from dotenv import load_dotenv
load_dotenv()

pillow_heif.register_heif_opener()

# Long-edge cap in pixels. Gemini and most vision models internally resize/tile
# above roughly this range anyway, so sending more doesn't improve OCR accuracy.
# Override with MAX_IMAGE_DIMENSION env var if scoreboard text is coming out blurry.
MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "1000"))

# downscale for detection only, not final output
MAX_DETECTION_DIMENSION = int(os.environ.get("MAX_DETECTION_DIMENSION", "1000"))

# If the detected "screen" region is smaller than this fraction of the total
# image area, treat detection as unreliable and skip cropping. Guards against
# accidentally cropping to some other bright object in the ceiling.
MIN_CROP_AREA_FRACTION = 0.03

# Extra margin added around the detected screen so we don't clip the bezel
# or the very edge of the scoreboard's outermost column.
CROP_PADDING_FRACTION = 0.18


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
    # Must be larger than the CLOSE kernel above, or bridges the CLOSE step
    # creates (e.g. thin gaps to overhead truss/lighting) survive this step.
    OPEN_KERNEL = int(os.environ.get("MASK_OPEN_KERNEL", "60"))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((OPEN_KERNEL, OPEN_KERNEL), np.uint8))

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

    # Among large bright/saturated regions, the scoreboard is the one the
    # photographer centered in frame - other bright objects (lit trusses,
    # neighboring lane monitors) tend to sit off to the side or along an edge.
    def dist_to_center(box):
        x, y, w, h = box
        return math.hypot((x + w / 2) - img_cx, (y + h / 2) - img_cy)
    
    x, y, w, h = min(candidates, key=dist_to_center)

    # The bounding box can include stray extra area beyond the actual
    # screen (e.g. a thin bridge up to overhead truss lighting, or a
    # sliver of a neighboring monitor). Trim it down to its dense "core":
    # scan rows/columns for how much of the mask is actually filled, and
    # shrink each edge inward until it's solid. Thin sparse appendages
    # get cut off.
    sub_mask = mask[y:y + h, x:x + w] > 0
    row_fill = sub_mask.mean(axis=1)
    col_fill = sub_mask.mean(axis=0)

    DENSITY_THRESHOLD = 0.5

    def trim_indices(fill):
        idx = np.where(fill >= DENSITY_THRESHOLD)[0]
        if len(idx) == 0:
            return 0, len(fill)
        return int(idx[0]), int(idx[-1]) + 1

    top, bottom = trim_indices(row_fill)
    left, right = trim_indices(col_fill)

    x0, y0 = x + left, y + top
    x1, y1 = x + right, y + bottom

    # Add back a margin so we don't clip the bezel or outermost column.
    pad_w = int((x1 - x0) * CROP_PADDING_FRACTION)
    pad_h = int((y1 - y0) * CROP_PADDING_FRACTION)
    x0 = max(0, x0 - pad_w)
    y0 = max(0, y0 - pad_h)
    x1 = min(w_img, x1 + pad_w)
    y1 = min(h_img, y1 + pad_h)

    return x0, y0, x1, y1


def to_png_bytes(
    raw_bytes: bytes,
    max_dimension: int = MAX_IMAGE_DIMENSION,
    auto_crop: bool = True,
) -> bytes:
    """Decode arbitrary image bytes, downscale if needed, and re-encode as PNG bytes."""
    img = Image.open(BytesIO(raw_bytes))

    img = ImageOps.exif_transpose(img)

    if img.mode != "RGB":
        img = img.convert("RGB")

    if auto_crop:
        width, height = img.size
        if max(width, height) > MAX_DETECTION_DIMENSION:
            # Detect on a downscaled copy - cv2 ops on a 24MP+ array can
            # use several hundred MB of intermediate buffers. Detection
            # only needs enough detail to find the bright screen region.
            detect_scale = MAX_DETECTION_DIMENSION / max(width, height)
            detect_size = (
                max(1, int(width * detect_scale)),
                max(1, int(height * detect_scale)),
            )
            detect_img = img.resize(detect_size, Image.BILINEAR)
            box = detect_scoreboard_box(detect_img)
            if box is not None:
                # Scale the box back up so the crop happens on the
                # full-resolution image, not the downscaled copy.
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
    return buf.getvalue()