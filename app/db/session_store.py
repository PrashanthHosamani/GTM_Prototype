import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = os.getenv("OUTMATE_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "outmate.db"))

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                title TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                created_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                title TEXT,
                summary TEXT,
                columns_json TEXT,
                rows_json TEXT,
                created_at TEXT
            )
        """)
        conn.commit()

init_db()

class SessionStore:
    def __init__(self, db_path: Optional[str] = None):
        if db_path:
            global DB_PATH
            DB_PATH = db_path
            init_db()

    def get_or_create_session(self, session_id: str, title: str = "New Prospect Search") -> str:
        now = datetime.utcnow().isoformat()
        with get_connection() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO sessions (session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (session_id, title, now, now)
            )
            conn.commit()
        return session_id

    def add_message(self, session_id: str, role: str, content: str) -> None:
        self.get_or_create_session(session_id)
        now = datetime.utcnow().isoformat()
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content, now)
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                (now, session_id)
            )
            conn.commit()

    def get_messages(self, session_id: str, limit: int = 15) -> List[Dict[str, str]]:
        with get_connection() as conn:
            cursor = conn.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?",
                (session_id, limit)
            )
            return [{"role": row["role"], "content": row["content"]} for row in cursor.fetchall()]

    def save_sheet(self, session_id: str, title: str, summary: str, columns: List[Any], rows: List[Any]) -> None:
        self.get_or_create_session(session_id, title)
        now = datetime.utcnow().isoformat()
        cols_payload = [c.dict() if hasattr(c, "dict") else c for c in columns]
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO sheets (session_id, title, summary, columns_json, rows_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, title, summary, json.dumps(cols_payload), json.dumps(rows), now)
            )
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?",
                (title, now, session_id)
            )
            conn.commit()

    def get_latest_sheet(self, session_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                "SELECT title, summary, columns_json, rows_json FROM sheets WHERE session_id = ? ORDER BY id DESC LIMIT 1",
                (session_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "title": row["title"],
                "summary": row["summary"],
                "columns": json.loads(row["columns_json"]),
                "rows": json.loads(row["rows_json"])
            }

    def get_first_sheet(self, session_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                "SELECT title, summary, columns_json, rows_json FROM sheets WHERE session_id = ? ORDER BY id ASC LIMIT 1",
                (session_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "title": row["title"],
                "summary": row["summary"],
                "columns": json.loads(row["columns_json"]),
                "rows": json.loads(row["rows_json"])
            }

    def clear_session(self, session_id: str) -> None:
        with get_connection() as conn:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM sheets WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            conn.commit()
