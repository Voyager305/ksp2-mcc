import asyncio
import contextlib
import logging
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, gmsec
from .agent import DispatcherAgent
from .bridge import BridgeError, KspBridge
from .db import EventLog
from .hub import Hub
from .telemetry import TelemetryStore
from .tools import ToolExecutor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("mcc.main")

hub = Hub()
telemetry = TelemetryStore()
bridge = KspBridge(hub, telemetry)
event_log = EventLog()
executor = ToolExecutor(bridge, telemetry)
agent = DispatcherAgent(hub, executor, event_log)

_background: list[asyncio.Task] = []


async def heartbeat_loop() -> None:
    """Периодический C2CX.HB backend'а — как компонент шины GMSEC.

    COMPONENT-STATUS по конвенции GMSEC: 0 GREEN, 1 YELLOW, 2 ORANGE, 4 RED.
    """
    period = config.MCC_HEARTBEAT_S
    if period <= 0:
        return
    while True:
        age = (
            None
            if telemetry.latest is None
            else round(max(0.0, time.time() - telemetry.latest_at), 1)
        )
        if not bridge.connected:
            status = 4  # RED — нет связи с бортом
        elif age is None or age > 5:
            status = 1  # YELLOW — связь есть, телеметрия устарела
        else:
            status = 0  # GREEN
        hub.publish(
            {
                "type": "heartbeat",
                "data": {
                    "component": "MCC-BACKEND",
                    "component_status": status,
                    "bridge_connected": bridge.connected,
                    "agent_state": "running" if agent.busy else "idle",
                    "telemetry_age_s": age,
                    "subscribers": hub.subscriber_count,
                    "pub_rate_s": period,
                },
            }
        )
        await asyncio.sleep(period)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    await event_log.open()
    _background.append(asyncio.create_task(bridge.run()))
    _background.append(asyncio.create_task(heartbeat_loop()))
    log.info("MCC backend started; bridge target %s:%s", config.KSP_BRIDGE_HOST, config.KSP_BRIDGE_PORT)
    yield
    await agent.stop()
    for task in _background:
        task.cancel()
    await event_log.close()


app = FastAPI(title="KSP2 Mission Control", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------- REST


class DirectiveIn(BaseModel):
    text: str


class CommandIn(BaseModel):
    cmd: str
    args: dict = {}


@app.get("/api/status")
async def status():
    return {
        "bridge_connected": bridge.connected,
        "agent_state": agent.state if not agent.busy else "running",
        "model": config.MCC_MODEL,
        "telemetry_age_s": None
        if telemetry.latest is None
        else round(max(0.0, time.time() - telemetry.latest_at), 1),
    }


@app.get("/api/telemetry/history")
async def telemetry_history(seconds: int = 900, max_points: int = 400):
    return telemetry.history(seconds=seconds, max_points=max_points)


@app.get("/api/events")
async def events(limit: int = 200):
    return await event_log.recent(limit=limit)


@app.post("/api/directive")
async def directive(body: DirectiveIn):
    accepted = await agent.handle_directive(body.text.strip())
    return {"accepted": accepted, "reason": None if accepted else "agent busy"}


@app.post("/api/agent/stop")
async def agent_stop():
    await agent.stop()
    return {"ok": True}


@app.post("/api/agent/reset")
async def agent_reset():
    ok = agent.reset_history()
    return {"ok": ok, "reason": None if ok else "agent busy"}


@app.post("/api/command")
async def manual_command(body: CommandIn):
    """Manual console command, bypassing the LLM."""
    try:
        result = await bridge.send_command(body.cmd, body.args)
    except BridgeError as e:
        entry = await event_log.add(
            "manual_command",
            {"cmd": body.cmd, "args": body.args, "ok": False, "error": str(e)},
        )
        hub.publish({"type": "event_log", "entry": entry})
        return {"ok": False, "error": str(e)}
    entry = await event_log.add(
        "manual_command", {"cmd": body.cmd, "args": body.args, "ok": True}
    )
    hub.publish({"type": "event_log", "entry": entry})
    return {"ok": True, "result": result}


# ----------------------------------------------------------------- WebSocket


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    queue = hub.subscribe()

    async def send(msg: dict) -> None:
        # Единый выход в шину: каждое сообщение — в GMSEC-конверте.
        await ws.send_json(gmsec.envelope(msg))

    # Initial state snapshot so the UI renders immediately.
    await send({"type": "bridge_status", "connected": bridge.connected})
    await send({"type": "agent_status", "state": "running" if agent.busy else "idle"})
    if telemetry.latest is not None:
        await send({"type": "telemetry", "data": telemetry.latest})
    for entry in await event_log.recent(limit=100):
        await send({"type": "event_log", "entry": entry})

    async def sender():
        while True:
            msg = await queue.get()
            await ws.send_json(msg)

    send_task = asyncio.create_task(sender())
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "directive":
                text = (msg.get("text") or "").strip()
                if text:
                    accepted = await agent.handle_directive(text)
                    if not accepted:
                        await send(
                            {
                                "type": "agent_event",
                                "event": {
                                    "kind": "rejected",
                                    "message": "Диспетчер занят текущей директивой. Остановите её или дождитесь завершения.",
                                },
                            }
                        )
            elif kind == "stop_agent":
                await agent.stop()
            elif kind == "command":
                try:
                    result = await bridge.send_command(
                        msg.get("cmd", ""), msg.get("args") or {}
                    )
                    entry = await event_log.add(
                        "manual_command",
                        {"cmd": msg.get("cmd"), "args": msg.get("args"), "ok": True},
                    )
                    hub.publish({"type": "event_log", "entry": entry})
                    await send({"type": "command_result", "ok": True, "result": result})
                except BridgeError as e:
                    await send({"type": "command_result", "ok": False, "error": str(e)})
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        hub.unsubscribe(queue)
