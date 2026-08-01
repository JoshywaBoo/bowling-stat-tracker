"""
main.py

FastAPI app: create an account / log in, then upload photos of a bowling
scoreboard, convert to PNG, parse with a vision model
(app/ocr.py), and store result in a PostgreSQL database with the user's account.

Then open http://127.0.0.1:8000
(index.html is served from the sibling frontend/ folder - see FRONTEND_DIR below)
"""

import sqlite3
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
import secrets
from app.email import send_email_code

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr

from app import auth
from app.convert import to_png_bytes
from app.db import execute, get_db, insert_and_get_id
from app.ocr import read_scoreboard

from fastapi.middleware.cors import CORSMiddleware

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Bowling Scoreboard Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bowling-stat-tracker.vercel.app",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# main.py -> parent is app/, parent.parent is backend/, parent.parent.parent is the repo root
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_DIR = REPO_ROOT / "frontend"

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "youremail@example.com")


def init_db() -> None:
    with get_db() as conn:
        execute(
            conn,
            """
            CREATE TABLE IF NOT EXISTS games (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                image_key TEXT NOT NULL,
                frame_string TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
            """,
        )


auth.init_auth_tables()
init_db()


def row_to_game(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "frame_string": row["frame_string"],
        "created_at": row["created_at"],
    }


# ---------------------------------------------------------------- accounts

class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    password: str   


class VerifyStatusResponse(BaseModel):
    verified: bool


@app.post("/api/signup")
def signup(payload: SignupRequest):

    user = auth.create_user(
        payload.email,
        payload.password
    )

    if not user:
        raise HTTPException(
            400,
            "Email already registered"
        )

    code = str(secrets.randbelow(900000) + 100000)

    auth.save_verification_code(
        user["id"],
        code
    )

    send_email_code(
        ADMIN_EMAIL,
        code,
        "verify",
        for_email=payload.email
    )

    return {
        "message": "Verification email sent"
    }


@app.post("/api/login")
def login(payload: LoginRequest, response: Response):
    user = auth.authenticate_user(payload.email, payload.password)

    if not user.get("email_verified", False):
        raise HTTPException(
            403,
            "Please verify your email first"
        )
    
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


@app.post("/api/verify-email")
def verify_email(
    payload: VerifyRequest,
    response: Response
):

    user = auth.verify_code(
        payload.email,
        payload.code
    )

    if not user:
        raise HTTPException(
            400,
            "Invalid verification code"
        )

    token = auth.create_session(user["id"])
    auth.set_session_cookie(response, token)

    return user


@app.get("/api/verify-link")
def verify_link(email: str, code: str):
    user = auth.verify_code(email, code)

    if not user:
        return HTMLResponse(
            "<h1>Invalid or expired code</h1><p>Ask for a new verification email.</p>",
            status_code=400,
        )

    return HTMLResponse(
        f"<h1>Verified {user['email']}!</h1><p>You can now log in.</p>"
    )


@app.post("/api/resend-verification")
def resend_verification(payload: ForgotPasswordRequest):

    user = auth.get_user_by_email(payload.email)

    if user and not user["email_verified"]:

        code = str(secrets.randbelow(900000) + 100000)

        auth.save_verification_code(
            user["id"],
            code,
            10
        )

        send_email_code(
            ADMIN_EMAIL,
            code,
            "verify",
            for_email=payload.email
        )

    return {
        "message": "If the account exists, a code was sent"
    }


@app.get("/api/verify-status", response_model=VerifyStatusResponse)
def verify_status(email: EmailStr):
    user = auth.get_user_by_email(email)
    return {"verified": bool(user and user.get("email_verified"))}


@app.post("/api/forgot-password")
def forgot_password(payload: ForgotPasswordRequest):
    user = auth.get_user_by_email(payload.email)

    if user:
        code = str(secrets.randbelow(900000) + 100000)
        auth.save_reset_code(user["id"], code, 10)
        send_email_code(ADMIN_EMAIL, code, "reset", for_email=payload.email)

    return {"message": "If the email exists, a code was sent"}


@app.post("/api/reset-password")
def reset_password(
    payload: ResetPasswordRequest
):

    success = auth.reset_password(
        payload.email,
        payload.code,
        payload.password
    )

    if not success:
        raise HTTPException(
            400,
            "Invalid reset code"
        )

    return {
        "message":"Password updated"
    }


# ------------------------------------------------------------------ games

class ConfirmGameRequest(BaseModel):
    image_key: str
    frame_string: str
    created_at: str | None = None


class UpdateGameRequest(BaseModel):
    frame_string: str
    created_at: str | None = None


@app.post("/api/upload")
async def upload_scoreboard(
    file: UploadFile = File(...), user: dict = Depends(auth.get_current_user)
):
    """Parse an uploaded scoreboard image but DO NOT save it yet.

    Returns the image_key and the OCR'd frame_string so the frontend can
    show an editable preview. Nothing is written to the `games` table
    until the user confirms via POST /api/games.
    """
    ext = Path(file.filename or "").suffix.lower()
    if file.content_type not in ALLOWED_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large (max 15 MB)")

    try:
        png_bytes = to_png_bytes(raw_bytes)
    except Exception:
        raise HTTPException(400, "Could not read that file as an image")

    try:
        frame_string = read_scoreboard(png_bytes)
    except Exception as exc:
        raise HTTPException(502, f"Could not read the scoreboard image: {exc}")

    return {
        "frame_string": frame_string,
    }


@app.post("/api/games")
def confirm_game(
    payload: ConfirmGameRequest, user: dict = Depends(auth.get_current_user)
):
    """Save a (possibly user-edited) frame_string for a previously uploaded image.

    Called after the user reviews/corrects the OCR result returned by
    POST /api/upload.
    """
    created_at_value = payload.created_at or datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        game_id = insert_and_get_id(
            conn,
            "INSERT INTO games (user_id, image_key, frame_string, created_at) VALUES (?, ?, ?, ?) RETURNING id",
            (user["id"], "", payload.frame_string, created_at_value),
        )

    return {
        "id": game_id,
        "frame_string": payload.frame_string,
        "created_at": created_at_value,
    }


@app.get("/api/games")
def list_games(user: dict = Depends(auth.get_current_user)):
    with get_db() as conn:
        rows = execute(
            conn,
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
        row = execute(
            conn,
            "SELECT id, user_id FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

        if row is None or row["user_id"] != user["id"]:
            raise HTTPException(404, "Game not found")

        if payload.created_at:
            execute(
                conn,
                "UPDATE games SET frame_string = ?, created_at = ? WHERE id = ?",
                (payload.frame_string, payload.created_at, game_id),
            )
        else:
            execute(
                conn,
                "UPDATE games SET frame_string = ? WHERE id = ?",
                (payload.frame_string, game_id),
            )

    return {"ok": True}


@app.delete("/api/games/{game_id}")
def delete_game(game_id: int, user: dict = Depends(auth.get_current_user)):
    with get_db() as conn:
        row = execute(
            conn,
            "SELECT id, user_id, image_key FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

        if row is None or row["user_id"] != user["id"]:
            # Same 404 for "doesn't exist" and "not yours" - don't leak
            # which games exist for other accounts.
            raise HTTPException(404, "Game not found")

        execute(conn, "DELETE FROM games WHERE id = ?", (game_id,))

    return {"ok": True}


# Serve the frontend last so it doesn't shadow the /api and /images routes above.
# app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
