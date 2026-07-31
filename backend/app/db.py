"""
db.py

Shared database helper for the app. Defaults to SQLite for local development,
but can use PostgreSQL when DATABASE_URL (or AIVEN_DATABASE_URL) is provided,
which is useful for Aiven-managed databases.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

try:
    import psycopg2
    import psycopg2.extras
except ImportError:  # pragma: no cover
    psycopg2 = None
    psycopg2_extras = None

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = BACKEND_DIR / "data" / "games.db"
load_dotenv(dotenv_path=BACKEND_DIR / ".env")
DB_PATH = Path(os.environ.get("DB_PATH", str(DEFAULT_SQLITE_PATH)))


def get_db_url() -> str | None:
    return os.environ.get("DATABASE_URL") or os.environ.get("AIVEN_DATABASE_URL") or os.environ.get("POSTGRES_URL")


def is_postgres() -> bool:
    db_url = get_db_url()
    return bool(db_url and db_url.startswith(("postgres://", "postgresql://")))


def execute(conn, query: str, params: tuple[Any, ...] | list[Any] | None = None):
    params = tuple(params or ())
    if is_postgres():
        if psycopg2 is None:
            raise RuntimeError("psycopg2 is required when using PostgreSQL")
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute(query.replace("?", "%s"), params)
        return cursor

    return conn.execute(query, params)


def insert_and_get_id(conn, query: str, params: tuple[Any, ...] | list[Any] | None = None):
    cursor = execute(conn, query, params)
    if is_postgres():
        row = cursor.fetchone()
        return row["id"] if row else None
    return cursor.lastrowid


@contextmanager
def get_db():
    db_url = get_db_url()
    if db_url and db_url.startswith(("postgres://", "postgresql://")):
        if psycopg2 is None:
            raise RuntimeError("psycopg2 is required when using PostgreSQL")
        conn = psycopg2.connect(db_url, sslmode="require")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()