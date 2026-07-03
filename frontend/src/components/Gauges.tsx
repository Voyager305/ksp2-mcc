import { Gauge } from "./Gauge";
import type { Telemetry } from "../types";

export function Gauges({ telemetry }: { telemetry: Telemetry | null }) {
  const v = telemetry?.vessel;
  const dyn = v?.dynamics;
  const throttle = v?.throttle != null ? v.throttle * 100 : null;
  const stageFuel = v?.fuel?.stage_pct ?? null;
  const g = dyn?.g_force ?? null;
  const q = dyn?.dynamic_pressure_kpa ?? null;
  const theta = v?.flight_path_angle_deg ?? null;

  return (
    <section className="card gauges">
      <div className="card-title">
        <h2>Приборный контроль</h2>
        <span className="card-note">ключевые параметры</span>
      </div>
      <div className="gauge-row">
        <Gauge
          label="РРД, тяга"
          value={throttle}
          display={throttle != null ? String(Math.round(throttle)) : "—"}
          unit="%"
          min={0}
          max={100}
        />
        <Gauge
          label="Топливо ступени"
          value={stageFuel}
          display={stageFuel != null ? String(Math.round(stageFuel)) : "—"}
          unit="%"
          min={0}
          max={100}
          lowLimit={0.05}
          inLimit={stageFuel != null && stageFuel < 5}
        />
        <Gauge
          label="Перегрузка n"
          value={g}
          display={g != null ? g.toFixed(1) : "—"}
          unit="g"
          min={0}
          max={10}
          highLimit={0.7}
          inLimit={g != null && g > 9}
        />
        <Gauge
          label="Скор. напор q"
          value={q}
          display={q != null ? String(Math.round(q)) : "—"}
          unit="кПа"
          min={0}
          max={60}
          highLimit={0.66}
          inLimit={q != null && q > 50}
        />
        <Gauge
          label="Угол θ"
          value={theta}
          display={theta != null ? String(Math.round(theta)) : "—"}
          unit="°"
          min={0}
          max={90}
        />
      </div>
    </section>
  );
}
