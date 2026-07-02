"""Mission event log persisted in SQLite."""
import json
import time
from typing import Any

import aiosqlite

from . import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
"""


class EventLog:
    def __init__(self) -> None:
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self._db = await aiosqlite.connect(config.DB_PATH)
        await self._db.executescript(_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def add(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        ts = time.time()
        entry = {"ts": ts, "kind": kind, "payload": payload}
        if self._db:
            await self._db.execute(
                "INSERT INTO events (ts, kind, payload) VALUES (?, ?, ?)",
                (ts, kind, json.dumps(payload, ensure_ascii=False)),
            )
            await self._db.commit()
        return entry

    async def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        if not self._db:
            return []
        cursor = await self._db.execute(
            "SELECT ts, kind, payload FROM events ORDER BY id DESC LIMIT ?", (limit,)
        )
        rows = await cursor.fetchall()
        await cursor.close()
        return [
            {"ts": ts, "kind": kind, "payload": json.loads(payload)}
            for ts, kind, payload in reversed(rows)
        ]
