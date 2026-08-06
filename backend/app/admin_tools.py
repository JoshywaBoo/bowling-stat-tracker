"""
admin_tools.py

Command-line helper for deleting a user account (and their games) without
needing to open the database dashboard. Uses the same connection logic as
the rest of the app (db.py), so it respects DATABASE_URL/.env automatically.

Usage (run from the backend/ directory):
    python -m app.admin_tools delete-user someusername
    python -m app.admin_tools delete-user someone@example.com
"""

import sys

from app.db import execute, get_db


def find_user(identifier: str):
    with get_db() as conn:
        return execute(
            conn,
            "SELECT id, email, username FROM users WHERE email = ? OR username = ?",
            (identifier.lower(), identifier),
        ).fetchone()


def delete_user(identifier: str):
    user = find_user(identifier)
    if user is None:
        print(f"No user found matching '{identifier}'")
        return

    print(f"Found user: id={user['id']} email={user['email']} username={user['username']}")
    confirm = input("Type 'yes' to permanently delete this user and all their games: ")
    if confirm.strip().lower() != "yes":
        print("Cancelled.")
        return

    with get_db() as conn:
        execute(conn, "DELETE FROM games WHERE user_id = ?", (user["id"],))
        execute(conn, "DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        execute(conn, "DELETE FROM users WHERE id = ?", (user["id"],))

    print(f"Deleted user '{user['username']}' and all their games.")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "delete-user":
        sys.exit("Usage: python -m app.admin_tools delete-user <username-or-email>")

    delete_user(sys.argv[2])