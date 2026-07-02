"""Tool definitions (OpenAI function-calling format) and their execution against the game."""
import asyncio
import json
from typing import Any

from .bridge import BridgeError, KspBridge
from .telemetry import TelemetryStore


def _fn(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }

SAS_MODES = [
    "StabilityAssist",
    "Prograde",
    "Retrograde",
    "Normal",
    "Antinormal",
    "RadialIn",
    "RadialOut",
    "Target",
    "AntiTarget",
    "Maneuver",
    "Navigation",
    "Autopilot",
]

ACTION_GROUPS = [
    "RCS",
    "Gear",
    "Lights",
    "Brakes",
    "Abort",
    "SolarPanels",
    "RadiatorPanels",
    "Science",
    "Custom01",
    "Custom02",
    "Custom03",
    "Custom04",
    "Custom05",
]

TOOLS: list[dict[str, Any]] = [
    _fn(
        "get_telemetry",
        (
            "Get a fresh telemetry snapshot of the active vessel: universe time (ut, seconds), "
            "altitude, speeds, flight_path_angle_deg (velocity angle above horizon: 90=up, 0=level), "
            "nose_pitch_deg (where the NOSE points above horizon — compare with your set_attitude "
            "pitch to confirm the vessel actually turned), heading_deg (compass heading of travel), "
            "orbit (apoapsis/periapsis above sea level in "
            "meters, eccentricity, inclination, time to Ap/Pe in seconds), SAS state, throttle, mass, "
            "maneuver nodes, "
            "fuel (fuel.stage_pct / fuel.total_pct / fuel.under_thrust), staging "
            "(staging.active_engines, staging.burning_stage, staging.stages[] with per-stage "
            "dv_vac_ms / thrust_vac / twr_vac / burn_time_s / active_engines) and stage_stack "
            "(stage_stack.stage_count / current_stage, and stages[] with parts role→count map "
            "engine/decoupler/parachute/fairing/... so you know what each stage press does). "
            "dynamics (dynamics.g_force / dynamic_pressure_kpa / mach / in_atmosphere / "
            "external_temp_k) and resources (resources.<Name>.stored/capacity, e.g. "
            "ElectricCharge, Methalox, MonoPropellant — watch ElectricCharge, low charge disables "
            "control). Use the fuel, staging, stage_stack, dynamics and resource fields to decide "
            "when and how to stage and burn. Always call this before planning or acting."
        ),
        {"type": "object", "properties": {}},
    ),
    _fn(
        "wait",
        (
            "Wait a short interval of REAL time (game keeps running), then return a fresh telemetry "
            "snapshot. This is your monitoring heartbeat — keep it SHORT so you react fast. "
            "Use 1-3 s during dynamic phases (ascent, any burn, descent, landing, staging), 5-10 s "
            "for slow changes, and only up to 30 s while coasting on a stable orbit with no engines "
            "running. Call it repeatedly rather than waiting one long interval — never miss a burnout, "
            "an apoapsis, or a ground approach. Max 30 s per call."
        ),
        {
            "type": "object",
            "properties": {
                "seconds": {"type": "number", "minimum": 0.5, "maximum": 30},
                "reason": {"type": "string", "description": "Short note shown in the mission log."},
            },
            "required": ["seconds"],
        },
    ),
    _fn(
        "set_throttle",
        "Set the main throttle of the active vessel. 0.0 = engines off, 1.0 = full thrust.",
        {
            "type": "object",
            "properties": {"level": {"type": "number", "minimum": 0, "maximum": 1}},
            "required": ["level"],
        },
    ),
    _fn(
        "stage",
        (
            "Activate the next stage (like pressing spacebar): ignites engines, separates boosters, "
            "deploys parachutes — whatever the next stage contains. Check telemetry/staging context first."
        ),
        {"type": "object", "properties": {}},
    ),
    _fn(
        "set_sas",
        (
            "Enable/disable SAS and optionally select its hold mode. Use 'Maneuver' to point along the "
            "next maneuver node, 'Prograde'/'Retrograde' for orbital velocity direction, "
            "'StabilityAssist' to just hold attitude. Calling this cancels any active set_attitude hold."
        ),
        {
            "type": "object",
            "properties": {
                "enabled": {"type": "boolean"},
                "mode": {"type": "string", "enum": SAS_MODES},
            },
            "required": ["enabled"],
        },
    ),
    _fn(
        "set_attitude",
        (
            "Actively point the vessel at a target attitude and HOLD it (SAS is engaged automatically). "
            "`pitch` is the elevation above the local horizon in degrees: 90 = straight up, 45 = halfway, "
            "0 = horizontal. `heading` is the compass direction in degrees: 0 = north, 90 = east (the "
            "direction to launch for a normal prograde orbit), 180 = south, 270 = west. This is the tool "
            "for flying a GRAVITY TURN: pitch over gradually from 90 toward 0 while heading 90 as you "
            "climb, so the vessel builds the horizontal speed needed for orbit. It keeps holding until "
            "you call it again, or set_sas, or hold_attitude. Watch vessel.flight_path_angle_deg and "
            "vessel.heading_deg in telemetry to see the actual result and correct."
        ),
        {
            "type": "object",
            "properties": {
                "pitch": {"type": "number", "minimum": 0, "maximum": 90},
                "heading": {"type": "number", "minimum": 0, "maximum": 360},
            },
            "required": ["pitch", "heading"],
        },
    ),
    _fn(
        "hold_attitude",
        "Stop the active set_attitude hold (leaves SAS as-is). Use before switching to a SAS mode.",
        {"type": "object", "properties": {}},
    ),
    _fn(
        "set_action_group",
        "Toggle an action group on the active vessel (RCS, Gear, Lights, Brakes, Abort, Custom01..05).",
        {
            "type": "object",
            "properties": {
                "group": {"type": "string", "enum": ACTION_GROUPS},
                "state": {"type": "boolean"},
            },
            "required": ["group", "state"],
        },
    ),
    _fn(
        "create_maneuver_node",
        (
            "Create a maneuver node. Specify the node time either as absolute universe time 'ut' or as "
            "'in_seconds' from now (e.g. telemetry time_to_ap_s to place it at apoapsis). Delta-v "
            "components are in m/s in the node's local frame: prograde (+forward), normal (+north of "
            "orbital plane), radial (+away from body). Returns the node's total dv and burn duration."
        ),
        {
            "type": "object",
            "properties": {
                "ut": {"type": "number", "description": "Absolute universe time of the node, seconds."},
                "in_seconds": {"type": "number", "description": "Node time relative to now, seconds."},
                "prograde": {"type": "number", "description": "m/s, default 0"},
                "normal": {"type": "number", "description": "m/s, default 0"},
                "radial": {"type": "number", "description": "m/s, default 0"},
            },
        },
    ),
    _fn(
        "clear_maneuver_nodes",
        "Delete all maneuver nodes of the active vessel.",
        {"type": "object", "properties": {}},
    ),
    _fn(
        "warp_to",
        (
            "Time-warp to a moment, specified as absolute 'ut' or 'in_seconds' from now. Warp stops "
            "automatically at the target. NEVER warp while engines are burning. For a maneuver node, "
            "warp to node_ut minus half the burn duration minus ~15s of margin."
        ),
        {
            "type": "object",
            "properties": {
                "ut": {"type": "number"},
                "in_seconds": {"type": "number"},
            },
        },
    ),
    _fn(
        "cancel_warp",
        "Immediately stop time warp.",
        {"type": "object", "properties": {}},
    ),
    _fn(
        "emergency_safe",
        (
            "Emergency safing: throttle to 0, cancel time warp, SAS to StabilityAssist. Use when "
            "something goes wrong or before handing control back."
        ),
        {"type": "object", "properties": {}},
    ),
    _fn(
        "list_targets",
        (
            "List other vessels near the active vessel (name + distance in meters, nearest first). "
            "Use this to find a docking/rendezvous target."
        ),
        {"type": "object", "properties": {}},
    ),
    _fn(
        "set_target",
        (
            "Set the navigation target to another vessel by name (case-insensitive substring; nearest "
            "match wins). Once set, telemetry includes a `target` block with distance and relative "
            "position/velocity in the vessel frame. Use SAS mode 'Target' to point at it."
        ),
        {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    ),
    _fn(
        "clear_target",
        "Clear the current navigation target.",
        {"type": "object", "properties": {}},
    ),
    _fn(
        "set_translation",
        (
            "RCS translation thrust (not rotation) for docking / close maneuvering. Each axis is -1..1 "
            "in the vessel's own frame: `forward` (+toward where the nose points), `right`, `up`. RCS "
            "must be ON (set_action_group RCS true). The command HOLDS until you change it — set all "
            "three to 0 to stop. Use small values (0.1-0.3) for gentle docking. Watch telemetry "
            "target.offset_* (where the target is) and target.rel_vel_* (relative velocity): translate "
            "to drive lateral offsets and relative velocity toward zero, then close forward slowly."
        ),
        {
            "type": "object",
            "properties": {
                "forward": {"type": "number", "minimum": -1, "maximum": 1},
                "right": {"type": "number", "minimum": -1, "maximum": 1},
                "up": {"type": "number", "minimum": -1, "maximum": 1},
            },
        },
    ),
]


class ToolExecutor:
    def __init__(self, bridge: KspBridge, telemetry: TelemetryStore) -> None:
        self._bridge = bridge
        self._telemetry = telemetry

    async def execute(self, name: str, args: dict[str, Any]) -> str:
        """Returns a JSON string for the tool_result. Raises BridgeError on game errors."""
        result = await self._dispatch(name, args)
        return json.dumps(result, ensure_ascii=False)

    async def _fresh_telemetry(self) -> Any:
        return await self._bridge.send_command("get_telemetry")

    async def _node_ut(self, args: dict[str, Any]) -> float:
        if args.get("ut") is not None:
            return float(args["ut"])
        if args.get("in_seconds") is not None:
            telemetry = await self._fresh_telemetry()
            return float(telemetry.get("ut", 0)) + float(args["in_seconds"])
        raise BridgeError("укажите либо 'ut', либо 'in_seconds'")

    async def _dispatch(self, name: str, args: dict[str, Any]) -> Any:
        if name == "get_telemetry":
            return await self._fresh_telemetry()

        if name == "wait":
            seconds = min(float(args.get("seconds", 1)), 30.0)
            await asyncio.sleep(seconds)
            return await self._fresh_telemetry()

        if name == "set_throttle":
            return await self._bridge.send_command(
                "set_throttle", {"value": float(args["level"])}
            )

        if name == "stage":
            return await self._bridge.send_command("stage")

        if name == "set_sas":
            payload: dict[str, Any] = {"enabled": bool(args["enabled"])}
            if args.get("mode"):
                payload["mode"] = str(args["mode"])
            return await self._bridge.send_command("set_sas", payload)

        if name == "set_attitude":
            return await self._bridge.send_command(
                "set_attitude",
                {"pitch": float(args["pitch"]), "heading": float(args["heading"])},
            )

        if name == "hold_attitude":
            return await self._bridge.send_command("hold_attitude")

        if name == "set_action_group":
            return await self._bridge.send_command(
                "set_action_group",
                {"group": str(args["group"]), "state": bool(args["state"])},
            )

        if name == "create_maneuver_node":
            ut = await self._node_ut(args)
            return await self._bridge.send_command(
                "create_node",
                {
                    "ut": ut,
                    "prograde": float(args.get("prograde", 0)),
                    "normal": float(args.get("normal", 0)),
                    "radial": float(args.get("radial", 0)),
                },
            )

        if name == "clear_maneuver_nodes":
            return await self._bridge.send_command("clear_nodes")

        if name == "warp_to":
            ut = await self._node_ut(args)
            return await self._bridge.send_command("warp_to", {"ut": ut})

        if name == "cancel_warp":
            return await self._bridge.send_command("cancel_warp")

        if name == "emergency_safe":
            await self._bridge.send_command("cancel_warp")
            await self._bridge.send_command("set_throttle", {"value": 0.0})
            await self._bridge.send_command("set_translation", {"right": 0, "up": 0, "forward": 0})
            await self._bridge.send_command(
                "set_sas", {"enabled": True, "mode": "StabilityAssist"}
            )
            return {"safed": True}

        if name == "list_targets":
            return await self._bridge.send_command("list_targets")

        if name == "set_target":
            return await self._bridge.send_command("set_target", {"name": str(args["name"])})

        if name == "clear_target":
            return await self._bridge.send_command("clear_target")

        if name == "set_translation":
            return await self._bridge.send_command(
                "set_translation",
                {
                    "right": float(args.get("right", 0)),
                    "up": float(args.get("up", 0)),
                    "forward": float(args.get("forward", 0)),
                },
            )

        raise BridgeError(f"неизвестный инструмент: {name}")
