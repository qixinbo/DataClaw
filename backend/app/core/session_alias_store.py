from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.data_root import get_data_root


class SessionAliasStore:
    def __init__(self) -> None:
        data_dir = get_data_root()
        try:
            data_dir.mkdir(parents=True, exist_ok=True)
        except PermissionError as exc:
            raise RuntimeError(f"DATA_ROOT 权限不足: {data_dir}") from exc
        self.db_path = data_dir / "nanobot_sessions.db"
        try:
            self._init_db()
        except PermissionError as exc:
            raise RuntimeError(f"DATA_ROOT 权限不足: {data_dir}") from exc

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_cache (
                    session_key TEXT PRIMARY KEY,
                    created_at TEXT,
                    updated_at TEXT,
                    alias TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    last_seen_at TEXT NOT NULL
                )
                """
            )
            cols = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(session_cache)").fetchall()
            }
            if "pinned" not in cols:
                conn.execute("ALTER TABLE session_cache ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            if "archived" not in cols:
                conn.execute("ALTER TABLE session_cache ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            if "project_id" not in cols:
                conn.execute("ALTER TABLE session_cache ADD COLUMN project_id INTEGER")

    def sync_sessions(self, sessions: list[dict[str, Any]]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        keys: list[str] = []
        with self._connect() as conn:
            for item in sessions:
                key = str(item.get("key") or "").strip()
                if not key:
                    continue
                keys.append(key)
                created_at = str(item.get("created_at") or "")
                updated_at = str(item.get("updated_at") or "")
                conn.execute(
                    """
                    INSERT INTO session_cache (session_key, created_at, updated_at, last_seen_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(session_key) DO UPDATE SET
                      created_at = excluded.created_at,
                      updated_at = excluded.updated_at,
                      last_seen_at = excluded.last_seen_at
                    """,
                    (key, created_at, updated_at, now),
                )

            if keys:
                placeholders = ",".join("?" for _ in keys)
                conn.execute(
                    f"DELETE FROM session_cache WHERE session_key NOT IN ({placeholders})",
                    keys,
                )
            else:
                conn.execute("DELETE FROM session_cache")

    def list_cached_sessions(self, project_id: int | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if project_id is not None:
                rows = conn.execute(
                    """
                    SELECT session_key, created_at, updated_at, alias, pinned, archived, project_id
                    FROM session_cache
                    WHERE project_id = ? OR project_id IS NULL
                    ORDER BY pinned DESC, archived ASC, updated_at DESC
                    """,
                    (project_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT session_key, created_at, updated_at, alias, pinned, archived, project_id
                    FROM session_cache
                    ORDER BY pinned DESC, archived ASC, updated_at DESC
                    """
                ).fetchall()
        return [self._row_to_session_item(row) for row in rows]

    def sync_and_list(self, sessions: list[dict[str, Any]], project_id: int | None = None) -> list[dict[str, Any]]:
        self.sync_sessions(sessions)
        return self.list_cached_sessions(project_id)

    def set_alias(self, session_key: str, alias: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        clean_alias = alias.strip()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO session_cache (session_key, created_at, updated_at, alias, last_seen_at)
                VALUES (?, '', '', ?, ?)
                ON CONFLICT(session_key) DO UPDATE SET
                  alias = excluded.alias,
                  last_seen_at = excluded.last_seen_at
                """,
                (session_key, clean_alias, now),
            )

    def update_alias_meta(
        self,
        session_key: str,
        alias: str | None = None,
        pinned: bool | None = None,
        archived: bool | None = None,
        project_id: int | None = None,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT alias, pinned, archived, project_id FROM session_cache WHERE session_key = ?",
                (session_key,),
            ).fetchone()
            current_alias = (str(row["alias"]) if row and row["alias"] else "")
            current_pinned = bool(row["pinned"]) if row else False
            current_archived = bool(row["archived"]) if row else False
            current_project_id = row["project_id"] if row and "project_id" in row.keys() else None
            next_alias = current_alias if alias is None else alias.strip()
            next_pinned = current_pinned if pinned is None else bool(pinned)
            next_archived = current_archived if archived is None else bool(archived)
            next_project_id = current_project_id if project_id is None else project_id
            conn.execute(
                """
                INSERT INTO session_cache (session_key, created_at, updated_at, alias, pinned, archived, project_id, last_seen_at)
                VALUES (?, '', '', ?, ?, ?, ?, ?)
                ON CONFLICT(session_key) DO UPDATE SET
                  alias = excluded.alias,
                  pinned = excluded.pinned,
                  archived = excluded.archived,
                  project_id = excluded.project_id,
                  last_seen_at = excluded.last_seen_at
                """,
                (session_key, next_alias, int(next_pinned), int(next_archived), next_project_id, now),
            )
        return {"alias": next_alias or None, "pinned": next_pinned, "archived": next_archived, "project_id": next_project_id}

    def get_alias(self, session_key: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT alias FROM session_cache WHERE session_key = ?",
                (session_key,),
            ).fetchone()
        if not row:
            return None
        alias = row["alias"]
        return str(alias) if alias else None

    def get_alias_meta(self, session_key: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT alias, pinned, archived, project_id FROM session_cache WHERE session_key = ?",
                (session_key,),
            ).fetchone()
        if not row:
            return None
        alias = (row["alias"] or "").strip()
        return {
            "alias": alias or None,
            "pinned": bool(row["pinned"]) if "pinned" in row.keys() else False,
            "archived": bool(row["archived"]) if "archived" in row.keys() else False,
            "project_id": row["project_id"] if "project_id" in row.keys() else None,
        }

    def delete_session(self, session_key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM session_cache WHERE session_key = ?", (session_key,))

    def _row_to_session_item(self, row: sqlite3.Row) -> dict[str, Any]:
        alias = (row["alias"] or "").strip()
        fallback = str(row["session_key"]).replace("api:", "")
        title = alias or fallback
        pinned = bool(row["pinned"]) if "pinned" in row.keys() else False
        archived = bool(row["archived"]) if "archived" in row.keys() else False
        project_id = row["project_id"] if "project_id" in row.keys() else None
        return {
            "key": row["session_key"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "metadata": {"title": title},
            "alias": alias or None,
            "pinned": pinned,
            "archived": archived,
            "project_id": project_id,
        }


session_alias_store = SessionAliasStore()
