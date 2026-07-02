import type { Telemetry } from "../types";

const RES_LABEL: Record<string, string> = {
  ElectricCharge: "СЭП, заряд",
  Methalox: "Метан-кислород",
  MonoPropellant: "Однокомп. топл.",
  XenonGas: "Ксенон (ЭРД)",
  Hydrogen: "Водород",
  LiquidFuel: "Горючее",
  Oxidizer: "Окислитель",
  SolidFuel: "ТТ-заряд",
  IntakeAir: "Забор. воздух",
  Ablator: "Теплозащита",
  Uranium: "Уран (ЯЭУ)",
};

const RES_ORDER = Object.keys(RES_LABEL);

function ResBar(props: { name: string; stored: number; capacity: number }) {
  const pct = props.capacity > 0 ? (props.stored / props.capacity) * 100 : 0;
  const low = pct < 10;
  const isEC = props.name === "ElectricCharge";
  const color = low ? "#e66767" : isEC ? "#eda100" : "#3987e5";
  return (
    <div className="res-row">
      <span className="res-name">{RES_LABEL[props.name] ?? props.name}</span>
      <div className="res-track">
        <div className="res-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      <span className="res-val">{Math.round(pct)}%</span>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="sys-metric">
      <span className="sys-k">{props.label}</span>
      <span className="sys-v">{props.value}</span>
    </div>
  );
}

export function Systems({ telemetry }: { telemetry: Telemetry | null }) {
  const v = telemetry?.vessel;
  const res = v?.resources ?? {};
  const dyn = v?.dynamics;
  const present = RES_ORDER.filter((k) => res[k] && res[k].capacity > 0);

  return (
    <section className="card systems">
      <div className="card-title">
        <h2>Бортовые системы</h2>
        <span className="card-note">{dyn?.in_atmosphere ? "в атмосфере" : "вне атмосферы"}</span>
      </div>

      <div className="sys-metrics">
        <Metric label="Перегрузка n" value={dyn?.g_force != null ? dyn.g_force.toFixed(1) + " g" : "—"} />
        <Metric label="Скор. напор q" value={dyn?.dynamic_pressure_kpa != null ? dyn.dynamic_pressure_kpa.toFixed(1) + " кПа" : "—"} />
        <Metric label="Число М" value={dyn?.mach != null ? dyn.mach.toFixed(2) : "—"} />
        <Metric label="Т обшивки" value={dyn?.external_temp_k != null ? Math.round(dyn.external_temp_k) + " K" : "—"} />
        <Metric label="Стат. давление p" value={dyn?.static_pressure_kpa != null ? dyn.static_pressure_kpa.toFixed(1) + " кПа" : "—"} />
        <Metric label="Плотн. атм. ρ" value={dyn?.atm_density != null ? dyn.atm_density.toFixed(3) : "—"} />
      </div>

      <div className="sys-res-title">Бортовые запасы</div>
      <div className="sys-res">
        {present.length === 0 ? (
          <div className="sys-empty">нет данных о ресурсах</div>
        ) : (
          present.map((k) => <ResBar key={k} name={k} stored={res[k].stored} capacity={res[k].capacity} />)
        )}
      </div>
    </section>
  );
}
