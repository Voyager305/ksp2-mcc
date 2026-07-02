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

export function Header({ state }: { state: MccState }) {
  const v = state.telemetry?.vessel;
  const ut = state.telemetry?.ut;
  return (
    <header className="header">
      <div className="header-title">
        <span className="header-logo" aria-hidden="true">
          ⏣
        </span>
        <h1>
          ЦУП <span className="header-sub">Mission Control Center</span>
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
