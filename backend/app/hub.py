"""In-process pub/sub hub: everything the UI needs to see flows through here.

Шина в стиле NASA GMSEC: каждое публикуемое сообщение получает GMSEC-конверт
(иерархический subject + заголовок) через gmsec.envelope().
"""
import asyncio
from typing import Any

from . import gmsec


class Hub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, message: dict[str, Any]) -> None:
        gmsec.envelope(message)
        for q in list(self._subscribers):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                # Slow consumer: drop it rather than stall everyone else.
                self._subscribers.discard(q)
