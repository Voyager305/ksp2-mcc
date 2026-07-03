import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CautionWarning } from "./components/CautionWarning";
import { Console } from "./components/Console";
import { DockingDisplay } from "./components/DockingDisplay";
import { EventLog } from "./components/EventLog";
import { Header } from "./components/Header";
import { ManualPanel } from "./components/ManualPanel";
import { Navball } from "./components/Navball";
import { ReadinessPoll } from "./components/ReadinessPoll";

import type { ChartPoint, ConsoleItem, MccState, Telemetry } from "./types";
import { MccSocket } from "./ws";

type TabId = "console" | "docking" | "manual" | "log";

const TABS: { id: TabId; label: string }[] = [
  { id: "console", label: "Пульт руководителя" },
  { id: "docking", label: "Стыковка" },
  { id: "manual", label: "Ручное управление" },
  { id: "log", label: "Журнал операций" },
];

interface Api {
  sendDirective: (text: string) => void;
  stopAgent: () => void;
  sendCommand: (cmd: string, args?: Record<string, unknown>) => void;
  resetAgent: () => void;
}

// Телеметрия, тренды и приборы вынесены в Open MCT (порт 3001).
// Кастомный пульт отвечает только за командование: диспетчер (ЛЛМ),
// контроль готовности, стыковку и ручное управление.
const OPENMCT_URL = `http://${location.hostname || "localhost"}:3001`;

// Стыковку можно вынести в отдельное окно (второй монитор оператора сближения).
function openDocking() {
  const url = `${location.pathname}?panel=docking`;
  window.open(url, "mcc_docking", "width=760,height=680,menubar=no,toolbar=no,location=no");
}

const MAX_CHART_POINTS = 900;
const MAX_TRACK_POINTS = 2000;
const MAX_LOG = 300;
const MAX_CONSOLE = 500;

type Action =
  | { type: "ws_status"; connected: boolean }
  | { type: "server"; msg: Record<string, unknown> }
  | { type: "history"; points: ChartPoint[] }
  | { type: "local_directive"; text: string };

const initial: MccState = {
  wsConnected: false,
  bridgeConnected: false,
  agentState: "idle",
  telemetry: null,
  chart: [],
  track: [],
  trackBody: null,
  log: [],
  console: [],
  pendingTool: null,
  heartbeat: null,
};

function telemetryToPoint(t: Telemetry): ChartPoint {
  const v = t.vessel ?? {};
  const o = v.orbit ?? {};
  return {
    ts: Date.now() / 1000,
    alt_m: v.alt_sealevel_m ?? null,
    apoapsis_m: o.apoapsis_m ?? null,
    periapsis_m: o.periapsis_m ?? null,
    surface_speed_ms: v.surface_speed_ms ?? null,
    vertical_speed_ms: v.vertical_speed_ms ?? null,
    throttle: v.throttle ?? null,
  };
}

function appendConsole(items: ConsoleItem[], item: ConsoleItem): ConsoleItem[] {
  const next = [...items, item];
  return next.length > MAX_CONSOLE ? next.slice(next.length - MAX_CONSOLE) : next;
}

function appendStream(
  items: ConsoleItem[],
  kind: "text" | "thinking",
  chunk: string,
): ConsoleItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === kind) {
    const updated = { ...last, text: last.text + chunk };
    return [...items.slice(0, -1), updated];
  }
  return appendConsole(items, { kind, text: chunk });
}

function reduce(state: MccState, action: Action): MccState {
  switch (action.type) {
    case "ws_status":
      return { ...state, wsConnected: action.connected };

    case "history": {
      const firstLive = state.chart[0]?.ts ?? Infinity;
      const old = action.points.filter((p) => p.ts < firstLive);
      return { ...state, chart: [...old, ...state.chart] };
    }

    case "local_directive":
      return {
        ...state,
        console: appendConsole(state.console, { kind: "directive", text: action.text }),
      };

    case "server":
      return applyServer(state, action.msg);
  }
}

function applyServer(state: MccState, msg: Record<string, unknown>): MccState {
  switch (msg.type) {
    case "bridge_status":
      return { ...state, bridgeConnected: Boolean(msg.connected) };

    case "agent_status":
      return {
        ...state,
        agentState: msg.state === "running" ? "running" : "idle",
        pendingTool: msg.state === "running" ? state.pendingTool : null,
      };

    case "telemetry": {
      const t = msg.data as Telemetry;
      const point = telemetryToPoint(t);
      const last = state.chart[state.chart.length - 1];
      let chart = state.chart;
      if (!last || point.ts - last.ts >= 1.0) {
        chart = [...state.chart, point];
        if (chart.length > MAX_CHART_POINTS) chart = chart.slice(chart.length - MAX_CHART_POINTS);
      }

      const v = t.vessel;
      const body = v?.body ?? null;
      let track = state.track;
      let trackBody = state.trackBody;
      if (body !== trackBody) {
        track = [];
        trackBody = body;
      }
      if (v?.latitude_deg != null && v?.longitude_deg != null) {
        const lp = track[track.length - 1];
        if (!lp || Math.abs(lp.lat - v.latitude_deg) > 0.02 || Math.abs(lp.lon - v.longitude_deg) > 0.02) {
          track = [...track, { lat: v.latitude_deg, lon: v.longitude_deg }];
          if (track.length > MAX_TRACK_POINTS) track = track.slice(track.length - MAX_TRACK_POINTS);
        }
      }

      return { ...state, telemetry: t, chart, track, trackBody };
    }

    case "event_log": {
      const entry = msg.entry as MccState["log"][number];
      const log = [...state.log, entry];
      return { ...state, log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log };
    }

    case "heartbeat": {
      const d = (msg.data ?? {}) as Record<string, unknown>;
      const gm = (msg.gmsec ?? {}) as Record<string, unknown>;
      return {
        ...state,
        heartbeat: {
          component: String(d.component ?? "MCC"),
          component_status: Number(d.component_status ?? 4),
          bridge_connected: Boolean(d.bridge_connected),
          agent_state: String(d.agent_state ?? "idle"),
          telemetry_age_s: d.telemetry_age_s == null ? null : Number(d.telemetry_age_s),
          subscribers: Number(d.subscribers ?? 0),
          pub_rate_s: Number(d.pub_rate_s ?? 0),
          counter: gm.COUNTER == null ? undefined : Number(gm.COUNTER),
          at: Date.now(),
        },
      };
    }

    case "agent_event":
      return applyAgentEvent(state, msg.event as Record<string, unknown>);

    default:
      return state;
  }
}

function applyAgentEvent(state: MccState, ev: Record<string, unknown>): MccState {
  const kind = ev.kind as string;
  switch (kind) {
    case "text_delta":
      return { ...state, console: appendStream(state.console, "text", String(ev.text ?? "")) };
    case "thinking_delta":
      return {
        ...state,
        console: appendStream(state.console, "thinking", String(ev.text ?? "")),
      };
    case "tool_pending":
      return { ...state, pendingTool: String(ev.name ?? "") };
    case "tool_call":
      return {
        ...state,
        pendingTool: null,
        console: appendConsole(state.console, {
          kind: "tool",
          name: String(ev.name ?? ""),
          args: ev.args,
          status: "running",
        }),
      };
    case "tool_result": {
      const items = [...state.console];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "tool" && it.status === "running" && it.name === ev.name) {
          items[i] = {
            ...it,
            status: ev.is_error ? "error" : "ok",
            output: String(ev.output ?? ""),
          };
          break;
        }
      }
      return { ...state, console: items };
    }
    case "done":
      return {
        ...state,
        console: appendConsole(state.console, {
          kind: "status",
          variant: "done",
          text: "Задание выполнено",
        }),
      };
    case "stopped":
      return {
        ...state,
        console: appendConsole(state.console, {
          kind: "status",
          variant: "stopped",
          text: "Отбой по команде оператора",
        }),
      };
    case "error":
    case "rejected":
      return {
        ...state,
        console: appendConsole(state.console, {
          kind: "status",
          variant: kind === "error" ? "error" : "rejected",
          text: String(ev.message ?? "Ошибка"),
        }),
      };
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reduce, initial);
  const [tab, setTab] = useState<TabId>("console");
  const socketRef = useRef<MccSocket | null>(null);
  const panelParam = new URLSearchParams(location.search).get("panel");

  useEffect(() => {
    const socket = new MccSocket(
      (msg) => dispatch({ type: "server", msg }),
      (connected) => dispatch({ type: "ws_status", connected }),
    );
    socketRef.current = socket;
    socket.connect();

    fetch("/api/telemetry/history?seconds=900&max_points=400")
      .then((r) => r.json())
      .then((points: ChartPoint[]) => dispatch({ type: "history", points }))
      .catch(() => undefined);

    return () => socket.close();
  }, []);

  const api = useMemo<Api>(
    () => ({
      sendDirective(text: string) {
        if (socketRef.current?.send({ type: "directive", text })) {
          dispatch({ type: "local_directive", text });
        }
      },
      stopAgent() {
        socketRef.current?.send({ type: "stop_agent" });
      },
      sendCommand(cmd: string, args: Record<string, unknown> = {}) {
        socketRef.current?.send({ type: "command", cmd, args });
      },
      resetAgent() {
        fetch("/api/agent/reset", { method: "POST" }).catch(() => undefined);
      },
    }),
    [],
  );

  // Выносное окно стыковки: только пульт сближения на весь экран.
  if (panelParam === "docking") {
    return (
      <div className="app panel-window">
        <div className="panel-titlebar">
          <span className={`pw-dot ${state.bridgeConnected ? "pw-on" : "pw-off"}`} />
          <span className="pw-label">Стыковка · пульт оператора сближения</span>
          <span className="pw-sub">ЦУП · выносное окно</span>
        </div>
        <div className="panel-content">
          <DockingDisplay vessel={state.telemetry?.vessel} onCommand={api.sendCommand} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header state={state} />
      <div className="workspace">
        <div className="main-area">
          <nav className="tabbar">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? "tab-active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <div className="tabbar-spacer" />
            <a className="omct-link" href={OPENMCT_URL} target="_blank" rel="noreferrer" title="Телеметрия, тренды и приборы борта в Open MCT">
              ◱ Телеметрия · Open MCT
            </a>
          </nav>

          <div className="tabpanel">
            {tab === "console" && (
              <div className="grid-pult">
                <ReadinessPoll telemetry={state.telemetry} onDirective={api.sendDirective} />
                <CautionWarning telemetry={state.telemetry} />
                <div className="card omct-card">
                  <div className="card-title">
                    <h2>Телеметрия борта</h2>
                    <span className="card-note">внешний пост</span>
                  </div>
                  <p className="omct-hint">
                    Приборы, тренды, трасса полёта и орбита выведены в Open MCT —
                    штатное ПО отображения телеметрии.
                  </p>
                  <a className="omct-open" href={OPENMCT_URL} target="_blank" rel="noreferrer">
                    Открыть пост телеметрии (Open MCT) →
                  </a>
                </div>
              </div>
            )}

            {tab === "docking" && (
              <div className="grid-docking">
                <DockingDisplay vessel={state.telemetry?.vessel} onCommand={api.sendCommand} />
                <div className="dock-side">
                  <Navball vessel={state.telemetry?.vessel} />
                  <button className="dock-popout" onClick={openDocking}>
                    ⧉ Вынести стыковку в отдельное окно
                  </button>
                </div>
              </div>
            )}

            {tab === "manual" && (
              <div className="grid-manual">
                <ManualPanel state={state} onCommand={api.sendCommand} />
                <Navball vessel={state.telemetry?.vessel} />
              </div>
            )}

            {tab === "log" && (
              <div className="grid-log">
                <EventLog log={state.log} />
              </div>
            )}
          </div>
        </div>

        <div className="console-rail">
          <Console
            state={state}
            onDirective={api.sendDirective}
            onStop={api.stopAgent}
            onReset={api.resetAgent}
          />
        </div>
      </div>
    </div>
  );
}
