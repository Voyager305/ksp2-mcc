import { useEffect, useState } from "react";
import { fmtSituation } from "../format";
import type { MccState } from "../types";

function StatusPill(props: { ok: boolean; okText: string; badText: string; pulse?: boolean }) {
  const { ok, okText, badText, pulse } = props;
  return (
    <span className={`pill ${ok ? "pill-good" : "pill-bad"} ${pulse && ok ? "pill-pulse" : ""}`}>
      <span className="pill-dot" aria-hidden="true" />
      {ok ? okText : badText}
    </span>
  );
}

function fmtUT(ut: number | undefined): string {
  if (ut == null) return "--:--:--";
  // Kerbin: 6-hour days, but for a clock just show D / HH:MM:SS of the day.
  const total = Math.floor(ut);
  const day = Math.floor(total / 21600); // 6h * 3600
  const rem = total % 21600;
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  const s = rem % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `D${day} ${p2(h)}:${p2(m)}:${p2(s)}`;
}

function useUtcClock(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return new Date(now).toISOString().slice(0, 19).replace("T", " ");
}

const HB_COLOR = ["hb-green", "hb-yellow", "hb-orange", "hb-orange", "hb-red"];

function BusIndicator({ state }: { state: MccState }) {
  const hb = state.heartbeat;
  // Шина считается «живой», если heartbeat приходил недавно (< 3 периодов).
  const alive =
    hb != null && Date.now() - hb.at < Math.max(3000, (hb.pub_rate_s || 5) * 3000);
  const cls = alive ? HB_COLOR[hb!.component_status] ?? "hb-red" : "hb-dead";
  return (
    <span className={`bus ${cls}`} title="Шина сообщений GMSEC (C2CX.HB)">
      <span className="bus-dot" aria-hidden="true" />
      ШИНА GMSEC
      {hb?.counter != null ? <span className="bus-seq">#{hb.counter}</span> : null}
    </span>
  );
}

export function Header({ state }: { state: MccState }) {
  const v = state.telemetry?.vessel;
  const ut = state.telemetry?.ut;
  const utc = useUtcClock();
  return (
    <header className="header">
      <div className="header-title">
        <span className="header-logo" aria-hidden="true">
          ⏣
        </span>
        <h1>
          Mission Control Center <span className="header-sub"> </span>
        </h1>
      </div>

      <div className="header-clock">
        <div className="clock-main">
          <span className="clock-label">БВ</span>
          <span className="clock-value">{fmtUT(ut)}</span>
        </div>
        <div className="clock-phase">{v ? fmtSituation(v.situation) : "борт не в зоне"}</div>
      </div>

      <div className="header-status">
        <span className="header-utc">{utc} UTC</span>
        <BusIndicator state={state} />
        <StatusPill
          ok={state.wsConnected}
          okText="Наз. комплекс: готов"
          badText="Наз. комплекс: отказ"
        />
        <StatusPill
          ok={state.bridgeConnected}
          okText="Борт: на связи"
          badText="Борт: нет связи"
        />
        <span className={`pill ${state.agentState === "running" ? "pill-accent pill-pulse" : "pill-idle"}`}>
          <span className="pill-dot" aria-hidden="true" />
          {state.agentState === "running" ? "Рук. полёта: работа" : "Рук. полёта: ожидание"}
        </span>
      </div>
    </header>
  );
}
