"""
auth.py

Minimal cookie-session authentication for tying uploaded games to an
account. Deliberately simple - stdlib password hashing (PBKDF2) and random
session tokens stored in SQLite, no external auth library. Good enough for
"users have accounts and see their own scores"; if this app grows real
security requirements (password reset flows, email verification, OAuth),
reach for a proper library like fastapi-users instead of extending this.
"""

import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from app.db import execute, get_db, insert_and_get_id

PBKDF2_ITERATIONS = 260_000
SESSION_COOKIE_NAME = "session_token"
SESSION_LIFETIME = timedelta(days=30)

# Render (and most hosts) serve over HTTPS, so cookies should be marked
# Secure there. Locally over plain http that would block the cookie
# entirely, so default to off and flip it on via env var when deployed.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def init_auth_tables() -> None:
    with get_db() as conn:
        execute(
            conn,
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
        )
        execute(
            conn,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
            """,
        )


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest_hex = stored_hash.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(check.hex(), digest_hex)


def create_user(email: str, password: str) -> dict:
    email = email.strip().lower()
    if "@" not in email or len(email) < 3:
        raise HTTPException(400, "Enter a valid email address")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    password_hash = hash_password(password)
    created_at = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        try:
            user_id = insert_and_get_id(
                conn,
                "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id",
                (email, password_hash, created_at),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An account with that email already exists")
        except Exception as exc:
            if "duplicate key" in str(exc).lower() or "unique constraint" in str(exc).lower():
                raise HTTPException(409, "An account with that email already exists") from exc
            raise

    return {"id": user_id, "email": email}


def authenticate_user(email: str, password: str) -> dict:
    email = email.strip().lower()
    with get_db() as conn:
        row = execute(conn, "SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if row is None or not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")

    return {"id": row["id"], "email": row["email"]}


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + SESSION_LIFETIME).isoformat()
    with get_db() as conn:
        execute(
            conn,
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, expires_at),
        )
    return token


def delete_session(token: str) -> None:
    with get_db() as conn:
        execute(conn, "DELETE FROM sessions WHERE token = ?", (token,))


def _get_user_from_token(token: str) -> dict | None:
    with get_db() as conn:
        row = execute(
            conn,
            """
            SELECT users.id, users.email, sessions.expires_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()

    if row is None:
        return None

    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        delete_session(token)
        return None

    return {"id": row["id"], "email": row["email"]}


def get_current_user(request: Request) -> dict:
    """FastAPI dependency - raises 401 if there's no valid session cookie."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user = _get_user_from_token(token) if token else None
    if user is None:
        raise HTTPException(401, "Not logged in")
    return user


def get_current_user_optional(request: Request) -> dict | None:
    """Same as get_current_user, but returns None instead of raising."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return _get_user_from_token(token) if token else None


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=int(SESSION_LIFETIME.total_seconds()),
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME)