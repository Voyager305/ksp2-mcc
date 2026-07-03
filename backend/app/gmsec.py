"""GMSEC-стиль конверта сообщений шины ЦУП (по образцу NASA GMSEC).

GMSEC (Goddard Mission Services Evolution Center) — стандарт NASA для обмена
сообщениями между компонентами наземного комплекса управления. Каждое
сообщение имеет иерархический subject

    <MISSION-ID>.<COMPONENT>.<MESSAGE-TYPE>.<MESSAGE-SUBTYPE>

и стандартный заголовок (COUNTER, PUBLISH-TIME и т.д.). Здесь мы придаём нашей
внутренней шине (Hub) те же свойства, НЕ ломая существующее поле "type" —
оно остаётся для совместимости с фронтендом и Open MCT.
"""
from __future__ import annotations

import itertools
import time
from typing import Any

from . import config

_counter = itertools.count(1)

# type сообщения -> (COMPONENT, MESSAGE-TYPE, MESSAGE-SUBTYPE)
# MESSAGE-TYPE следует конвенции GMSEC: MSG (публикация), REQ (запрос), RESP (ответ).
_ROUTING: dict[str, tuple[str, str, str]] = {
    "telemetry":      ("TLM",    "MSG",  "TLM"),        # телеметрия борта
    "event_log":      ("LOG",    "MSG",  "LOG"),        # журнал операций
    "bridge_status":  ("BRIDGE", "MSG",  "C2CX.CONN"),  # связь с бортом
    "agent_status":   ("FD",     "MSG",  "C2CX.STATE"), # состояние диспетчера (руководитель полёта)
    "agent_event":    ("FD",     "MSG",  "AGENT"),      # события диспетчера
    "command_result": ("CMD",    "RESP", "DIR"),        # ответ на команду (директиву)
    "heartbeat":      ("MCC",    "MSG",  "C2CX.HB"),    # heartbeat backend
}


def subject_for(mtype: str) -> str:
    comp, kind, subtype = _ROUTING.get(mtype, ("MCC", "MSG", (mtype or "GENERIC").upper()))
    return f"{config.MCC_MISSION}.{comp}.{kind}.{subtype}"


def envelope(message: dict[str, Any]) -> dict[str, Any]:
    """Добавляет GMSEC-заголовок к сообщению шины (мутирует и возвращает его)."""
    if "gmsec" in message:  # уже в конверте — не переоборачиваем
        return message
    mtype = str(message.get("type", ""))
    comp, kind, subtype = _ROUTING.get(mtype, ("MCC", "MSG", (mtype or "GENERIC").upper()))
    message["gmsec"] = {
        "SUBJECT": f"{config.MCC_MISSION}.{comp}.{kind}.{subtype}",
        "COUNTER": next(_counter),
        "PUBLISH-TIME": round(time.time(), 3),
        "MESSAGE-TYPE": kind,
        "MESSAGE-SUBTYPE": subtype,
        "COMPONENT": comp,
        "MISSION-ID": config.MCC_MISSION,
    }
    return message
