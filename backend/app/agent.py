"""FLIGHT — the LLM flight director. Streaming agentic loop over an OpenAI-compatible API."""
import asyncio
import json
import logging
from typing import Any

import openai
from openai import AsyncOpenAI

from . import config
from .bridge import BridgeError
from .db import EventLog
from .hub import Hub
from .tools import TOOLS, ToolExecutor

log = logging.getLogger("mcc.agent")

SYSTEM_PROMPT = """\
You are FLIGHT — the AI flight director of a Mission Control Center connected to a live
Kerbal Space Program 2 game session. The human operator gives you mission directives;
you plan and execute them by commanding the active vessel through your tools, reading
real telemetry between actions.

## Operating doctrine
- ALWAYS start by calling get_telemetry to see the actual state before planning anything.
- Work step by step: one control action, then verify its effect with telemetry before the next.
- Telemetry units: distances in meters, speeds in m/s, times in seconds, mass in tons.
  `ut` is universe time in seconds — maneuver node times and warp targets use it.
- If the bridge reports "нет соединения с игрой", stop and tell the operator to check that
  KSP2 with the MccLink mod is running and a vessel is on the launchpad / in flight.

## Monitoring cadence — check OFTEN, react fast
The game runs in real time while you think, so poll telemetry frequently and keep each wait
SHORT. Prefer many short checks over one long wait:
- Dynamic phases (ascent, any engine burn, staging, descent, landing): wait 1-3 s between
  checks so you never miss a burnout, an apoapsis, or a ground approach.
- Slow changes: 5-10 s. Only use up to 30 s while coasting on a stable orbit with engines off.
- Prefer SAS hold modes over constant manual inputs, but still verify state on a short cadence.
Never wait a long fixed interval during a critical phase — a burnout or impact happens between
your checks.

## Plan the delta-v budget UP FRONT (before launch / before a maneuver)
As soon as you have telemetry, compute whether the vehicle can actually complete the plan:
- Read `staging.total_dv_vac_ms` (whole vehicle) and each `staging.stages[].dv_vac_ms`.
- Compare against the budget the mission needs. Rough Kerbin references (vacuum m/s):
  surface → low orbit ≈ 3400; deorbit burn ≈ 100-300; Mun transfer ≈ 860 + capture ≈ 300.
- Also check `stages[].twr_vac`: the first burning stage needs TWR > ~1.2 to lift off Kerbin;
  a landing/hover stage needs TWR > 1 at the target body.
- If the delta-v or TWR is clearly insufficient for the requested plan, SAY SO before launching
  and propose the achievable goal instead of stranding the craft mid-flight. State the numbers.

## Reading fuel & staging (CRITICAL for knowing when to stage)
Each telemetry snapshot includes:
- `vessel.fuel.stage_pct` — fuel remaining in the CURRENT stage (percent, 0 = empty).
- `vessel.fuel.total_pct` — fuel remaining in the whole vessel.
- `vessel.fuel.under_thrust` — true only while engines are actually producing thrust.
- `vessel.staging.active_engines` (engines producing thrust now, whole vessel),
  `vessel.staging.burning_stage` (stage number currently burning, -1 if none), and
  `vessel.staging.stages[]` — per remaining stage: `dv_vac_ms`, `thrust_vac`, `twr_vac`,
  `burn_time_s`, `active_engines`, `engines_in_stage`.
Decide staging from DATA, not from a fixed timer:
- STAGE when the current stage is spent: `stage_pct` near 0, OR (`throttle` > 0 AND
  `under_thrust` is false), OR `active_engines` == 0 while you still need thrust. A booster
  burnout also shows as `mass_t` no longer decreasing between snapshots.
- After staging, verify with the next snapshot that `active_engines` > 0 and `under_thrust`
  is true and the vessel is accelerating (surface_speed rising / apoapsis rising). If the new
  stage is inert (a decoupler or parachute stage), stage again.
- If a stage has `twr_vac` < 1 low in the atmosphere it cannot lift off — report it.
- Before circularizing, check `staging.stages[].dv_vac_ms` — ensure you have enough delta-v
  for the planned burn; if not, say so instead of stranding the craft.

## The staging stack — each stage press is ONE discrete action
`vessel.stage_stack` describes the whole staging sequence so you know exactly what each
`stage` command will do:
- `stage_count` — how many stages are left; `current_stage` — the index that the NEXT
  `stage` press activates.
- `stages[]` — one entry per stage with `stage` (index), `active` (already fired), `parts`
  (a role→count map: `engine`, `decoupler`, `parachute`, `fairing`, `launch_clamp`,
  `docking_port`, `rcs`, `solar_panel`, `generator`, `other`) and `engines_ignited`.
A single `stage` press activates ONLY the current stage. Stages are separate steps: e.g.
after the solid boosters burn out, the next stage may be a `decoupler` (just separates the
spent boosters — no thrust yet), and the stage AFTER that ignites the next `engine`. So:
- Read `stage_stack` before launching to plan the sequence, and consult it whenever you need
  to stage: look at the current stage's `parts` to know whether this press ignites an engine,
  drops a spent stage, deploys a parachute, or jettisons a fairing.
- If the current stage is only a `decoupler`/`separator`, press `stage`, then IMMEDIATELY
  press `stage` again (with a short telemetry check) to ignite the engine underneath — a
  decoupler alone produces no thrust.
- Deploy a `parachute` stage only when safe (subsonic, low altitude). Jettison a `fairing`
  once out of the dense atmosphere.
- Never blindly stage repeatedly: each press is irreversible. Check the stack, stage the one
  step you intend, verify the result, then decide the next.
- The game runs in real time while you think. For fast-changing phases (ascent, burns,
  landing) use short wait() calls to monitor, and prefer SAS hold modes over frequent inputs.
- If the bridge reports "нет соединения с игрой", stop and tell the operator to check that
  KSP2 with the MccLink mod is running and a vessel is on the launchpad / in flight.

## Navigation — steer with set_attitude, not just SAS modes
SAS 'Prograde' only FOLLOWS the current velocity vector — if you are going straight up it keeps
you going straight up, so periapsis never rises. To change where the rocket points you MUST use
set_attitude(pitch, heading): pitch = elevation above horizon (90 up, 0 horizontal), heading =
compass (90 = east). After commanding, confirm it worked: `nose_pitch_deg` should move toward your
commanded pitch within a few seconds (that is where the NOSE points), and then
`flight_path_angle_deg` (where the vessel MOVES) follows as speed builds. If nose_pitch_deg does
NOT move toward your command, the vessel lacks control authority at that moment (e.g. too little
airspeed/no gimbal) — increase throttle or wait for more speed, don't assume the command failed.

## Standard procedures
Launch to orbit (Kerbin: atmosphere ends at 70 km, orbital velocity ~2250 m/s, needs ~3400 m/s dv):
1) Set_attitude(pitch=90, heading=90) (straight up, aimed east), throttle 1.0, stage to ignite.
2) Fly a GRADUAL gravity turn — do NOT go straight up. Pitch over on a schedule vs altitude,
   holding heading 90 (east) the whole way. A good Kerbin profile:
     ~0.5-1 km: set_attitude(pitch=85, heading=90)
     ~2 km:  pitch 75      ~5 km:  pitch 65      ~10 km: pitch 55
     ~20 km: pitch 40      ~30 km: pitch 30      ~45 km: pitch 20      ~60 km: pitch 10
   Adjust from feedback: `flight_path_angle_deg` should track a bit below your commanded pitch and
   decrease steadily. If apoapsis shoots up while periapsis stays deeply negative, you are too
   STEEP — lower the pitch faster (more horizontal). If you start falling before reaching space,
   you pitched over too early/too far — raise pitch. Keep checking every 1-3 s during the burn.
3) When apoapsis reaches the target (e.g. 80-90 km), cut throttle to 0. Do not overshoot.
4) Coast to space; once above 70 km you can hold_attitude then create a maneuver node at apoapsis
   (in_seconds = time_to_ap_s) with prograde dv to circularize (raise periapsis to match apoapsis;
   typically ~900-1000 m/s from a low suborbital arc). 5) Execute the node (SAS Maneuver).
Executing a maneuver node:
1) SAS mode Maneuver; wait ~20-30s for alignment; 2) warp_to node ut minus half burn duration
minus ~15s margin; 3) at burn start throttle up; monitor remaining dv via telemetry maneuver
node dv_ms with short waits; throttle down to ~0.1 near the end for precision; 4) throttle 0,
clear the node if fully executed, verify the resulting orbit.
Deorbit/landing: retrograde burn to lower periapsis (into atmosphere for Kerbin: <30 km),
SAS Retrograde during descent, stage parachutes when safe (subsonic, < 5 km for drogues).

Rendezvous & docking (requires two vessels on similar orbits):
1) list_targets to find the target; set_target by name. Telemetry now has a `target` block:
   distance_m, rel_speed_ms, offset_fwd_m/right_m/up_m (where the target is, in YOUR frame),
   rel_vel_fwd_ms/right_ms/up_ms (target velocity relative to you).
2) Close the distance first if far (>2 km): create a maneuver node to match orbits / reduce
   rel_speed, or point SAS Target and burn main engine gently toward it, killing rel_speed with
   retrograde-to-target as you arrive. Get within a few hundred meters at low rel_speed (<10 m/s).
3) Final approach with RCS: set_action_group RCS true. SAS mode Target (nose points at target).
   Then use set_translation (small, 0.1-0.3) to null out the LATERAL terms first — drive
   offset_right_m/offset_up_m and rel_vel_right_ms/rel_vel_up_ms toward ~0 — then translate
   forward slowly to reduce offset_fwd_m. Keep rel_speed under ~1 m/s inside 50 m, ~0.3 m/s for
   contact. Check telemetry every 1-2 s and correct; set_translation 0/0/0 to coast.
4) The game auto-docks when the ports touch aligned and slow. If you overshoot or tumble, back
   off (translate forward negative), stabilize, retry. Turn RCS off when done.
Note: axis signs may need one correction — after the first set_translation, verify from the next
telemetry whether the offset moved the intended way; if it grew, flip that axis sign.

## Safety rules
- NEVER time-warp while the throttle is above 0 or during atmospheric flight below 70 km.
- After every burn set throttle to 0 explicitly.
- Before staging, consider what the next stage does (engines? parachutes? decoupler?) based
  on context and mission phase; if uncertain, ask the operator.
- If telemetry looks wrong or an action fails twice, use emergency_safe and report.

## Reporting
- Be a concise, professional flight director: short status reports, key numbers only.
- Respond in the operator's language (they usually write in Russian).
- When the directive is complete, summarize what was achieved with final orbit/state numbers.
"""


class DispatcherAgent:
    def __init__(self, hub: Hub, executor: ToolExecutor, event_log: EventLog) -> None:
        self._hub = hub
        self._executor = executor
        self._log = event_log
        self._client = AsyncOpenAI(
            api_key=config.MCC_API_KEY or "not-set",
            base_url=config.MCC_BASE_URL,
        )
        # Conversation history WITHOUT the system prompt (prepended per request).
        self._messages: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        self.state = "idle"

    # ------------------------------------------------------------------ API

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def handle_directive(self, text: str) -> bool:
        """Returns False if the agent is busy with a previous directive."""
        if self.busy:
            return False
        entry = await self._log.add("directive", {"text": text})
        self._hub.publish({"type": "event_log", "entry": entry})
        self._task = asyncio.create_task(self._run(text))
        return True

    async def stop(self) -> None:
        if self.busy:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    def reset_history(self) -> bool:
        if self.busy:
            return False
        self._messages.clear()
        return True

    # ----------------------------------------------------------------- loop

    def _set_state(self, state: str) -> None:
        self.state = state
        self._hub.publish({"type": "agent_status", "state": state})

    def _publish(self, event: dict[str, Any]) -> None:
        self._hub.publish({"type": "agent_event", "event": event})

    async def _run(self, directive: str) -> None:
        self._set_state("running")
        self._messages.append({"role": "user", "content": directive})
        try:
            await self._agent_loop()
        except asyncio.CancelledError:
            entry = await self._log.add("agent_stopped", {})
            self._hub.publish({"type": "event_log", "entry": entry})
            self._publish({"kind": "stopped"})
            self._trim_dangling_tool_calls()
            raise
        except openai.APIError as e:
            log.exception("openai-compatible api error")
            detail = getattr(e, "message", None) or str(e)
            await self._report_error(f"Ошибка LLM API: {e.__class__.__name__}: {detail}")
        except Exception as e:  # noqa: BLE001
            log.exception("agent loop crashed")
            await self._report_error(f"Внутренняя ошибка агента: {e}")
        finally:
            self._set_state("idle")

    def _trim_dangling_tool_calls(self) -> None:
        # A valid history must not end with an assistant tool_calls turn that has
        # no matching tool results (e.g. after a mid-run cancel).
        while self._messages:
            last = self._messages[-1]
            if last.get("role") == "assistant" and last.get("tool_calls"):
                self._messages.pop()
                continue
            break

    async def _report_error(self, message: str) -> None:
        entry = await self._log.add("agent_error", {"message": message})
        self._hub.publish({"type": "event_log", "entry": entry})
        self._publish({"kind": "error", "message": message})
        self._trim_dangling_tool_calls()

    def _compact_old_tool_results(self) -> None:
        """Replace telemetry in old tool results with a placeholder so the LLM
        context does not grow without bound over a long mission. Keeps message
        structure and tool_call pairing intact — only the content string shrinks."""
        keep = config.MCC_KEEP_RECENT_TOOL_RESULTS
        if keep <= 0:
            return
        tool_idxs = [i for i, m in enumerate(self._messages) if m.get("role") == "tool"]
        for i in tool_idxs[:-keep] if len(tool_idxs) > keep else []:
            content = self._messages[i].get("content")
            if isinstance(content, str) and len(content) > 80:
                self._messages[i]["content"] = "[старые данные опущены для экономии контекста]"

    async def _agent_loop(self) -> None:
        step = 0
        limit = config.MCC_MAX_TOOL_ITERATIONS  # 0 = unlimited
        while limit <= 0 or step < limit:
            step += 1
            self._compact_old_tool_results()
            text, tool_calls, finish_reason = await self._complete_once()

            assistant_msg: dict[str, Any] = {"role": "assistant", "content": text or ""}
            if tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["args"]},
                    }
                    for tc in tool_calls
                ]
            self._messages.append(assistant_msg)

            if finish_reason == "length":
                await self._report_error(
                    "Ответ обрезан по лимиту токенов — увеличьте MCC_MAX_TOKENS "
                    "или разбейте директиву на шаги."
                )
                return

            if not tool_calls:
                entry = await self._log.add("agent_done", {"text": text})
                self._hub.publish({"type": "event_log", "entry": entry})
                self._publish({"kind": "done", "text": text})
                return

            await self._execute_tools(tool_calls)

        await self._report_error(
            f"Достигнут лимит {config.MCC_MAX_TOOL_ITERATIONS} шагов — директива остановлена."
        )

    def _request_params(self) -> dict[str, Any]:
        return {
            "model": config.MCC_MODEL,
            "max_tokens": config.MCC_MAX_TOKENS,
            "temperature": config.MCC_TEMPERATURE,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *self._messages],
            "tools": TOOLS,
            "tool_choice": "auto",
        }

    async def _complete_once(self) -> tuple[str, list[dict[str, Any]], str | None]:
        if config.MCC_STREAM:
            return await self._stream()
        return await self._non_stream()

    async def _stream(self) -> tuple[str, list[dict[str, Any]], str | None]:
        text_parts: list[str] = []
        # index -> {"id", "name", "args"}
        calls: dict[int, dict[str, str]] = {}
        announced: set[int] = set()
        finish_reason: str | None = None

        stream = await self._client.chat.completions.create(
            **self._request_params(), stream=True
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta

            content = getattr(delta, "content", None)
            if content:
                text_parts.append(content)
                self._publish({"kind": "text_delta", "text": content})

            # Reasoning models (e.g. DeepSeek-R1) stream a separate field.
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                self._publish({"kind": "thinking_delta", "text": reasoning})

            for tc in getattr(delta, "tool_calls", None) or []:
                slot = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function.arguments:
                        slot["args"] += tc.function.arguments
                if slot["name"] and tc.index not in announced:
                    announced.add(tc.index)
                    self._publish({"kind": "tool_pending", "name": slot["name"]})

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        tool_calls = [calls[i] for i in sorted(calls) if calls[i]["name"]]
        return "".join(text_parts), tool_calls, finish_reason

    async def _non_stream(self) -> tuple[str, list[dict[str, Any]], str | None]:
        resp = await self._client.chat.completions.create(**self._request_params())
        choice = resp.choices[0]
        msg = choice.message
        text = msg.content or ""
        if text:
            self._publish({"kind": "text_delta", "text": text})
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning:
            self._publish({"kind": "thinking_delta", "text": reasoning})

        tool_calls: list[dict[str, Any]] = []
        for tc in msg.tool_calls or []:
            self._publish({"kind": "tool_pending", "name": tc.function.name})
            tool_calls.append(
                {"id": tc.id, "name": tc.function.name, "args": tc.function.arguments or "{}"}
            )
        return text, tool_calls, choice.finish_reason

    async def _execute_tools(self, tool_calls: list[dict[str, Any]]) -> None:
        for tc in tool_calls:
            name = tc["name"]
            try:
                args = json.loads(tc["args"] or "{}")
                if not isinstance(args, dict):
                    raise ValueError("arguments must be a JSON object")
            except (json.JSONDecodeError, ValueError) as e:
                output, is_error, args = f"неверные аргументы вызова: {e}", True, {}
            else:
                output, is_error = None, False

            entry = await self._log.add("tool_call", {"name": name, "args": args})
            self._hub.publish({"type": "event_log", "entry": entry})
            self._publish({"kind": "tool_call", "name": name, "args": args})

            if output is None:
                try:
                    output = await self._executor.execute(name, args)
                except BridgeError as e:
                    output, is_error = str(e), True
                except Exception as e:  # noqa: BLE001
                    log.exception("tool %s failed", name)
                    output, is_error = f"internal error: {e}", True

            entry = await self._log.add(
                "tool_result",
                {"name": name, "output": output[:2000], "is_error": is_error},
            )
            self._hub.publish({"type": "event_log", "entry": entry})
            self._publish(
                {"kind": "tool_result", "name": name, "output": output[:2000], "is_error": is_error}
            )

            self._messages.append(
                {"role": "tool", "tool_call_id": tc["id"], "content": output}
            )
