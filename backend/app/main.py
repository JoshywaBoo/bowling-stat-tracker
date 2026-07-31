"""
main.py

FastAPI app: create an account / log in, then upload photos of a bowling
scoreboard, convert to PNG, parse with a local Ollama vision model
(app/ocr.py), and store both the image and the parsed result against your
account.

Run locally (from the backend/ directory):
    ollama pull qwen2.5vl
    pip install -r requirements.txt
    uvicorn app.main:app --reload

Then open http://127.0.0.1:8000
(index.html is served from the sibling frontend/ folder - see FRONTEND_DIR below)
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr

from app import auth
from app.convert import to_png_bytes
from app.db import get_db
from app.ocr import read_scoreboard
from app.storage import storage

app = FastAPI(title="Bowling Scoreboard Reader")

# main.py -> parent is app/, parent.parent is backend/, parent.parent.parent is the repo root
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_DIR = REPO_ROOT / "frontend"

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                image_key TEXT NOT NULL,
                frame_string TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
            """
        )


auth.init_auth_tables()
init_db()


def row_to_game(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "frame_string": row["frame_string"],
        "image_url": storage.url_for(row["image_key"]),
        "created_at": row["created_at"],
    }


# ---------------------------------------------------------------- accounts

class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@app.post("/api/signup")
def signup(payload: SignupRequest, response: Response):
    user = auth.create_user(payload.email, payload.password)
    token = auth.create_session(user["id"])
    auth.set_session_cookie(response, token)
    return user


@app.post("/api/login")
def login(payload: LoginRequest, response: Response):
    user = auth.authenticate_user(payload.email, payload.password)
    token = auth.create_session(user["id"])
    auth.set_session_cookie(response, token)
    return user


@app.post("/api/logout")
def logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/me")
def me(user: dict | None = Depends(auth.get_current_user_optional)):
    return user  # null if not logged in


# ------------------------------------------------------------------ games

class ConfirmGameRequest(BaseModel):
    image_key: str
    frame_string: str


class UpdateGameRequest(BaseModel):
    frame_string: str


@app.post("/api/upload")
async def upload_scoreboard(
    file: UploadFile = File(...), user: dict = Depends(auth.get_current_user)
):
    """Parse an uploaded scoreboard image but DO NOT save it yet.

    Returns the image_key and the OCR'd frame_string so the frontend can
    show an editable preview. Nothing is written to the `games` table
    until the user confirms via POST /api/games.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large (max 15 MB)")

    try:
        png_bytes = to_png_bytes(raw_bytes)
    except Exception:
        raise HTTPException(400, "Could not read that file as an image")

    image_key = storage.save(png_bytes)

    try:
        frame_string = read_scoreboard(png_bytes)
    except Exception as exc:
        raise HTTPException(502, f"Could not reach Ollama or parse the image: {exc}")

    return {
        "image_key": image_key,
        "frame_string": frame_string,
        "image_url": storage.url_for(image_key),
    }


@app.post("/api/games")
def confirm_game(
    payload: ConfirmGameRequest, user: dict = Depends(auth.get_current_user)
):
    """Save a (possibly user-edited) frame_string for a previously uploaded image.

    Called after the user reviews/corrects the OCR result returned by
    POST /api/upload.
    """
    path = storage.path_for(payload.image_key)
    if not path.exists():
        raise HTTPException(404, "Uploaded image not found; please re-upload")

    created_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO games (user_id, image_key, frame_string, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], payload.image_key, payload.frame_string, created_at),
        )
        game_id = cursor.lastrowid

    return {
        "id": game_id,
        "frame_string": payload.frame_string,
        "image_url": storage.url_for(payload.image_key),
        "created_at": created_at,
    }


@app.get("/api/games")
def list_games(user: dict = Depends(auth.get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, image_key, frame_string, created_at FROM games "
            "WHERE user_id = ? ORDER BY id DESC",
            (user["id"],),
        ).fetchall()
    return [row_to_game(r) for r in rows]


@app.put("/api/games/{game_id}")
def update_game(
    game_id: int,
    payload: UpdateGameRequest,
    user: dict = Depends(auth.get_current_user),
):
    if not payload.frame_string.strip():
        raise HTTPException(400, "Add at least one roll before saving.")

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

        if row is None or row["user_id"] != user["id"]:
            raise HTTPException(404, "Game not found")

        conn.execute(
            "UPDATE games SET frame_string = ? WHERE id = ?",
            (payload.frame_string, game_id),
        )

    return {"ok": True}


@app.get("/images/{key}")
def get_image(key: str, user: dict = Depends(auth.get_current_user)):
    path = storage.path_for(key)
    if not path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)

@app.delete("/api/games/{game_id}")
def delete_game(game_id: int, user: dict = Depends(auth.get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id, image_key FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

        if row is None or row["user_id"] != user["id"]:
            # Same 404 for "doesn't exist" and "not yours" - don't leak
            # which games exist for other accounts.
            raise HTTPException(404, "Game not found")

        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))

    # Best-effort image cleanup - a stray file on disk isn't worth failing
    # the request over, so don't let this raise.
    try:
        path = storage.path_for(row["image_key"])
        path.unlink(missing_ok=True)
    except Exception:
        pass

    return {"ok": True}


# Serve the frontend last so it doesn't shadow the /api and /images routes above.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
