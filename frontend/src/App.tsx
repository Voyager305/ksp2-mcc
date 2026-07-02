import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CautionWarning } from "./components/CautionWarning";
import { Charts } from "./components/Charts";
import { Console } from "./components/Console";
import { DockingDisplay } from "./components/DockingDisplay";
import { EventLog } from "./components/EventLog";
import { GroundTrack } from "./components/GroundTrack";
import { Header } from "./components/Header";
import { ManualPanel } from "./components/ManualPanel";
import { Navball } from "./components/Navball";
import { OrbitalView } from "./components/OrbitalView";
import { StageStack } from "./components/StageStack";
import { StatTiles } from "./components/StatTiles";
import { Systems } from "./components/Systems";

import type { ChartPoint, ConsoleItem, MccState, Telemetry } from "./types";
import { MccSocket } from "./ws";

type TabId = "console" | "docking" | "systems" | "log";

const TABS: { id: TabId; label: string }[] = [
  { id: "console", label: "Пульт" },
  { id: "docking", label: "Стыковка" },
  { id: "systems", label: "Системы" },
  { id: "log", label: "Журнал" },
];

interface Api {
  sendDirective: (text: string) => void;
  stopAgent: () => void;
  sendCommand: (cmd: string, args?: Record<string, unknown>) => void;
  resetAgent: () => void;
}

// Panels that can be popped out into their own browser window (multi-monitor).
const PANELS: { id: string; label: string }[] = [
  { id: "groundtrack", label: "Трасса полёта" },
  { id: "docking", label: "Стыковка" },
  { id: "navball", label: "Ориентация" },
  { id: "orbital", label: "Орбита" },
  { id: "cw", label: "Аварийная сигнализация" },
  { id: "systems", label: "Бортовые системы" },
  { id: "charts", label: "Тренды" },
  { id: "console", label: "Руководитель полёта" },
  { id: "log", label: "Журнал операций" },
];

function renderPanel(id: string, state: MccState, api: Api) {
  switch (id) {
    case "groundtrack":
      return <GroundTrack vessel={state.telemetry?.vessel} track={state.track} body={state.trackBody} />;
    case "navball":
      return <Navball vessel={state.telemetry?.vessel} />;
    case "orbital":
      return <OrbitalView vessel={state.telemetry?.vessel} />;
    case "docking":
      return <DockingDisplay vessel={state.telemetry?.vessel} onCommand={api.sendCommand} />;
    case "systems":
      return <Systems telemetry={state.telemetry} />;
    case "cw":
      return <CautionWarning telemetry={state.telemetry} />;
    case "charts":
      return <Charts data={state.chart} />;
    case "tiles":
      return <StatTiles telemetry={state.telemetry} />;
    case "stack":
      return <StageStack telemetry={state.telemetry} />;
    case "console":
      return (
        <Console
          state={state}
          onDirective={api.sendDirective}
          onStop={api.stopAgent}
          onReset={api.resetAgent}
        />
      );
    case "log":
      return <EventLog log={state.log} />;
    default:
      return <div className="dock-empty">неизвестная панель: {id}</div>;
  }
}

function openPanel(id: string) {
  const url = `${location.pathname}?panel=${encodeURIComponent(id)}`;
  window.open(url, `mcc_${id}`, "width=760,height=620,menubar=no,toolbar=no,location=no");
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
      // Prepend fetched history before any live points already collected.
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

      // Ground track: reset when the vessel changes body; append moved points.
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
      // Attach the result to the most recent running tool with this name.
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

  const api = useMemo(
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

  // Pop-out window: render just one panel full-screen with its own live socket.
  if (panelParam) {
    const label = PANELS.find((p) => p.id === panelParam)?.label ?? panelParam;
    return (
      <div className="app panel-window">
        <div className="panel-titlebar">
          <span className={`pw-dot ${state.bridgeConnected ? "pw-on" : "pw-off"}`} />
          <span className="pw-label">{label}</span>
          <span className="pw-sub">ЦУП · выносное окно</span>
        </div>
        <div className="panel-content">{renderPanel(panelParam, state, api)}</div>
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
            <div className="popout-launcher">
              <span className="pl-label">⧉ Вынести:</span>
              {PANELS.map((p) => (
                <button key={p.id} className="pl-btn" onClick={() => openPanel(p.id)} title={`Открыть «${p.label}» в отдельном окне`}>
                  {p.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="tabpanel">
            {tab === "console" && (
              <div className="grid-console">
                <div className="gc-tiles">
                  <StatTiles telemetry={state.telemetry} />
                </div>
                <div className="gc-map">
                  <GroundTrack
                    vessel={state.telemetry?.vessel}
                    track={state.track}
                    body={state.trackBody}
                  />
                </div>
                <div className="gc-right">
                  <Navball vessel={state.telemetry?.vessel} />
                  <CautionWarning telemetry={state.telemetry} />
                </div>
                <div className="gc-charts">
                  <Charts data={state.chart} />
                </div>
              </div>
            )}

            {tab === "docking" && (
              <div className="grid-docking">
                <DockingDisplay vessel={state.telemetry?.vessel} onCommand={api.sendCommand} />
                <OrbitalView vessel={state.telemetry?.vessel} />
              </div>
            )}

            {tab === "systems" && (
              <div className="grid-systems">
                <CautionWarning telemetry={state.telemetry} />
                <Systems telemetry={state.telemetry} />
                <StageStack telemetry={state.telemetry} />
              </div>
            )}

            {tab === "log" && (
              <div className="grid-log">
                <EventLog log={state.log} />
                <ManualPanel state={state} onCommand={api.sendCommand} />
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
