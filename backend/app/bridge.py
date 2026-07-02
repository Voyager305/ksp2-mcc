"""Async TCP client for the MccLink mod (newline-delimited JSON)."""
import asyncio
import itertools
import json
import logging
from typing import Any

from . import config
from .hub import Hub
from .telemetry import TelemetryStore

log = logging.getLogger("mcc.bridge")


class BridgeError(Exception):
    pass


class KspBridge:
    def __init__(self, hub: Hub, telemetry: TelemetryStore) -> None:
        self._hub = hub
        self._telemetry = telemetry
        self._writer: asyncio.StreamWriter | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._ids = itertools.count(1)
        self.connected = False

    async def run(self) -> None:
        """Reconnect loop; runs for the lifetime of the app."""
        while True:
            try:
                reader, writer = await asyncio.open_connection(
                    config.KSP_BRIDGE_HOST, config.KSP_BRIDGE_PORT
                )
                self._writer = writer
                self._set_connected(True)
                log.info(
                    "connected to KSP2 at %s:%s",
                    config.KSP_BRIDGE_HOST,
                    config.KSP_BRIDGE_PORT,
                )
                try:
                    while True:
                        line = await reader.readline()
                        if not line:
                            break
                        self._handle_line(line)
                finally:
                    self._set_connected(False)
                    self._writer = None
                    self._fail_pending("connection to game lost")
                    log.warning("disconnected from KSP2")
            except (ConnectionError, OSError):
                if self.connected:
                    self._set_connected(False)
            await asyncio.sleep(3.0)

    def _set_connected(self, value: bool) -> None:
        if self.connected != value:
            self.connected = value
            self._hub.publish({"type": "bridge_status", "connected": value})

    def _fail_pending(self, reason: str) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(BridgeError(reason))
        self._pending.clear()

    def _handle_line(self, line: bytes) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            log.warning("bad json from game: %r", line[:200])
            return

        kind = msg.get("type")
        if kind == "telemetry":
            data = msg.get("data") or {}
            self._telemetry.add(data)
            self._hub.publish({"type": "telemetry", "data": data})
        elif kind == "response":
            fut = self._pending.pop(str(msg.get("id")), None)
            if fut and not fut.done():
                fut.set_result(msg)
        elif kind == "event":
            self._hub.publish({"type": "game_event", "data": msg.get("data")})

    async def send_command(
        self, cmd: str, args: dict[str, Any] | None = None, timeout: float = 15.0
    ) -> Any:
        """Send a command to the game, wait for the matching response."""
        if not self._writer:
            raise BridgeError(
                "нет соединения с игрой (KSP2 с модом MccLink не запущена?)"
            )
        cmd_id = str(next(self._ids))
        payload = json.dumps(
            {"id": cmd_id, "cmd": cmd, "args": args or {}}, ensure_ascii=False
        )
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[cmd_id] = fut
        try:
            self._writer.write(payload.encode("utf-8") + b"\n")
            await self._writer.drain()
            msg = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(cmd_id, None)
            raise BridgeError(f"команда {cmd} не получила ответ за {timeout}s")

        if not msg.get("ok"):
            raise BridgeError(msg.get("error") or "неизвестная ошибка игры")
        return msg.get("result")
