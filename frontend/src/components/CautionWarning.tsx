import type { Telemetry } from "../types";

type Level = "ok" | "caution" | "warning" | "critical" | "off";

interface Lamp {
  id: string;
  label: string;
  level: Level;
  note?: string;
}

function evaluate(t: Telemetry | null): Lamp[] {
  const v = t?.vessel;
  if (!v) {
    return [{ id: "novessel", label: "БОРТ НЕ В ЗОНЕ", level: "off" }];
  }
  const st = v.staging;
  const fuel = v.fuel;
  const dyn = v.dynamics;
  const o = v.orbit;
  const burning = st?.stages?.find((s) => s.stage === st.burning_stage);
  const landed = ["PreLaunch", "Landed", "Splashed"].includes(v.situation ?? "");

  const ec = v.resources?.ElectricCharge;
  const ecPct = ec && ec.capacity > 0 ? (ec.stored / ec.capacity) * 100 : null;

  const lamps: Lamp[] = [];

  // Thrust / engines (двигательная установка)
  const throttle = v.throttle ?? 0;
  if (throttle > 0.02 && fuel?.under_thrust === false) {
    lamps.push({ id: "thrust", label: "ДУ", level: "critical", note: "нет тяги при РРД" });
  } else {
    lamps.push({ id: "thrust", label: "ДУ", level: "ok" });
  }

  // Stage fuel
  if (fuel?.stage_pct != null && fuel.stage_pct < 5 && !landed) {
    lamps.push({ id: "fuel", label: "ТОПЛ", level: "warning", note: "ступень пуста" });
  } else {
    lamps.push({ id: "fuel", label: "ТОПЛ", level: "ok" });
  }

  // Electric (система электропитания)
  if (ecPct != null && ecPct < 10) {
    lamps.push({ id: "elec", label: "СЭП", level: "warning", note: `${Math.round(ecPct)}%` });
  } else {
    lamps.push({ id: "elec", label: "СЭП", level: ecPct == null ? "off" : "ok" });
  }

  // Тяговооружённость на выведении
  if (burning?.twr_vac != null && burning.twr_vac < 1 && dyn?.in_atmosphere && !landed) {
    lamps.push({ id: "twr", label: "ТЯГОВ.", level: "caution", note: burning.twr_vac.toFixed(2) });
  } else {
    lamps.push({ id: "twr", label: "ТЯГОВ.", level: "ok" });
  }

  // Перегрузка
  const g = dyn?.g_force;
  if (g != null && g > 9) lamps.push({ id: "g", label: "ПЕРЕГР n", level: "critical", note: `${g.toFixed(1)}g` });
  else if (g != null && g > 6) lamps.push({ id: "g", label: "ПЕРЕГР n", level: "caution", note: `${g.toFixed(1)}g` });
  else lamps.push({ id: "g", label: "ПЕРЕГР n", level: "ok" });

  // Скоростной напор
  const q = dyn?.dynamic_pressure_kpa;
  if (q != null && q > 40) lamps.push({ id: "q", label: "НАПОР q", level: "caution", note: `${Math.round(q)} кПа` });
  else lamps.push({ id: "q", label: "НАПОР q", level: "ok" });

  // Тепловой режим
  const temp = dyn?.external_temp_k;
  if (temp != null && temp > 1600) lamps.push({ id: "heat", label: "ТЕПЛ", level: "critical", note: `${Math.round(temp)}K` });
  else if (temp != null && temp > 1000) lamps.push({ id: "heat", label: "ТЕПЛ", level: "caution", note: `${Math.round(temp)}K` });
  else lamps.push({ id: "heat", label: "ТЕПЛ", level: "ok" });

  // Орбита / суборбита
  if (o?.periapsis_m != null && o.periapsis_m < 0 && !landed) {
    lamps.push({ id: "orb", label: "ОРБ", level: "caution", note: "Hp < 0" });
  } else {
    lamps.push({ id: "orb", label: "ОРБ", level: o?.periapsis_m != null ? "ok" : "off" });
  }

  return lamps;
}

export function CautionWarning({ telemetry }: { telemetry: Telemetry | null }) {
  const lamps = evaluate(telemetry);
  const active = lamps.filter((l) => l.level === "warning" || l.level === "critical").length;

  return (
    <section className="card cw">
      <div className="card-title">
        <h2>Аварийная сигнализация</h2>
        <span className={`card-note ${active > 0 ? "cw-alarm" : ""}`}>
          {active > 0 ? `⚠ ОТКАЗ: ${active}` : "НОРМА"}
        </span>
      </div>
      <div className="cw-grid">
        {lamps.map((l) => (
          <div key={l.id} className={`cw-lamp cw-${l.level}`}>
            <span className="cw-label">{l.label}</span>
            {l.note ? <span className="cw-note">{l.note}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
