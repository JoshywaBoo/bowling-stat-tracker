"""
storage.py

Minimal storage abstraction for uploaded scoreboard images.

Everything else in the app talks to `storage`, never to the filesystem
directly, so swapping LocalStorage for something like an S3/R2 backend
later only means writing a new class with the same three methods and
changing the one line at the bottom of this file.
"""

import os
import uuid
from pathlib import Path

# backend/app/storage.py -> parent is app/, parent.parent is backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent

STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(BACKEND_DIR / "data" / "images")))
STORAGE_DIR.mkdir(parents=True, exist_ok=True)


class LocalStorage:
    """Stores images as files on local disk."""

    def save(self, image_bytes: bytes, extension: str = "png") -> str:
        """Save image bytes to disk, return a storage key identifying it."""
        key = f"{uuid.uuid4().hex}.{extension}"
        (STORAGE_DIR / key).write_bytes(image_bytes)
        return key

    def url_for(self, key: str) -> str:
        """Return a path the frontend can fetch this image from."""
        return f"/images/{key}"

    def path_for(self, key: str) -> Path:
        """Return the on-disk path for a given key (local backend only)."""
        return STORAGE_DIR / key


# Swap this line for a different backend later, e.g.:
#   from app.s3_storage import S3Storage
#   storage = S3Storage(bucket=os.environ["S3_BUCKET"])
storage = LocalStorage()
