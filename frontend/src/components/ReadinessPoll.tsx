import type { Telemetry } from "../types";

/* Контроль готовности (GO / NO-GO) — по образцу предстартового опроса
 * оперативной группы управления. Каждая позиция докладывает ГОТОВ / НЕ ГОТОВ,
 * статус выводится из телеметрии борта. Руководитель полёта (ГОГУ / ЛЛМ)
 * принимает решение на пуск по итогам опроса. */

type Verdict = "go" | "nogo" | "na";

interface Position {
  id: string;
  call: string; // позывной позиции
  role: string; // зона ответственности
  verdict: Verdict;
  note?: string;
}

function poll(t: Telemetry | null): Position[] {
  const v = t?.vessel;
  if (!v) {
    return [
      { id: "gogu", call: "ГОГУ", role: "руководитель полёта", verdict: "na", note: "борт не в зоне" },
    ];
  }

  const fuel = v.fuel;
  const dyn = v.dynamics;
  const o = v.orbit;
  const ec = v.resources?.ElectricCharge;
  const ecPct = ec && ec.capacity > 0 ? (ec.stored / ec.capacity) * 100 : null;
  const st = v.staging;
  const burning = st?.stages?.find((s) => s.stage === st.burning_stage);

  const P: Position[] = [];

  // ДВИЖЕНИЕ — двигательная установка: наличие топлива и тяги
  if (fuel?.stage_pct == null) {
    P.push({ id: "du", call: "ДВИЖЕНИЕ", role: "двигательная установка", verdict: "na" });
  } else if (fuel.stage_pct < 5) {
    P.push({ id: "du", call: "ДВИЖЕНИЕ", role: "двигательная установка", verdict: "nogo", note: `топливо ${Math.round(fuel.stage_pct)}%` });
  } else {
    P.push({ id: "du", call: "ДВИЖЕНИЕ", role: "двигательная установка", verdict: "go", note: `топливо ${Math.round(fuel.stage_pct)}%` });
  }

  // БОРТ — бортовые системы / электропитание (СЭП)
  if (ecPct == null) {
    P.push({ id: "sep", call: "БОРТ", role: "электропитание, СЭП", verdict: "na" });
  } else if (ecPct < 15) {
    P.push({ id: "sep", call: "БОРТ", role: "электропитание, СЭП", verdict: "nogo", note: `СЭП ${Math.round(ecPct)}%` });
  } else {
    P.push({ id: "sep", call: "БОРТ", role: "электропитание, СЭП", verdict: "go", note: `СЭП ${Math.round(ecPct)}%` });
  }

  // ТЯГОВООРУЖЁННОСТЬ — способность к выведению
  if (burning?.twr_vac == null) {
    P.push({ id: "twr", call: "НАГРУЗКИ", role: "тяговооружённость", verdict: "na" });
  } else if (burning.twr_vac < 1) {
    P.push({ id: "twr", call: "НАГРУЗКИ", role: "тяговооружённость", verdict: "nogo", note: `n₀=${burning.twr_vac.toFixed(2)}` });
  } else {
    P.push({ id: "twr", call: "НАГРУЗКИ", role: "тяговооружённость", verdict: "go", note: `n₀=${burning.twr_vac.toFixed(2)}` });
  }

  // ТЕРМО — тепловой режим (СОТР)
  const temp = dyn?.external_temp_k;
  if (temp == null) {
    P.push({ id: "termo", call: "ТЕРМО", role: "тепловой режим, СОТР", verdict: "na" });
  } else if (temp > 1600) {
    P.push({ id: "termo", call: "ТЕРМО", role: "тепловой режим, СОТР", verdict: "nogo", note: `${Math.round(temp)} K` });
  } else {
    P.push({ id: "termo", call: "ТЕРМО", role: "тепловой режим, СОТР", verdict: "go", note: `${Math.round(temp)} K` });
  }

  // ДИНАМИКА — управляемость / перегрузки
  const g = dyn?.g_force;
  if (g == null) {
    P.push({ id: "din", call: "ДИНАМИКА", role: "динамика полёта", verdict: "na" });
  } else if (g > 9) {
    P.push({ id: "din", call: "ДИНАМИКА", role: "динамика полёта", verdict: "nogo", note: `${g.toFixed(1)} g` });
  } else {
    P.push({ id: "din", call: "ДИНАМИКА", role: "динамика полёта", verdict: "go", note: `${g.toFixed(1)} g` });
  }

  // БАЛЛИСТИКА — параметры орбиты / траектории
  if (o?.periapsis_m == null) {
    P.push({ id: "ball", call: "БАЛЛИСТИКА", role: "траектория, орбита", verdict: "na" });
  } else if (o.periapsis_m < 0) {
    P.push({ id: "ball", call: "БАЛЛИСТИКА", role: "траектория, орбита", verdict: "nogo", note: "Hp < 0 (суборбита)" });
  } else {
    P.push({ id: "ball", call: "БАЛЛИСТИКА", role: "траектория, орбита", verdict: "go", note: `Hp ${Math.round(o.periapsis_m / 1000)} км` });
  }

  return P;
}

const MARK: Record<Verdict, string> = { go: "ГОТОВ", nogo: "НЕ ГОТОВ", na: "Н/Д" };

export function ReadinessPoll({
  telemetry,
  onDirective,
}: {
  telemetry: Telemetry | null;
  onDirective?: (text: string) => void;
}) {
  const positions = poll(telemetry);
  const applicable = positions.filter((p) => p.verdict !== "na");
  const nogo = applicable.filter((p) => p.verdict === "nogo");
  const allGo = applicable.length > 0 && nogo.length === 0;
  const verdict: Verdict = applicable.length === 0 ? "na" : allGo ? "go" : "nogo";

  return (
    <section className="card poll">
      <div className="card-title">
        <h2>Контроль готовности · GO / NO-GO</h2>
        <span className={`poll-verdict pv-${verdict}`}>
          {verdict === "na" ? "НЕТ ДАННЫХ" : allGo ? "ПУСК РАЗРЕШЁН" : `ЗАДЕРЖКА · ${nogo.length}`}
        </span>
      </div>

      <div className="poll-list">
        {positions.map((p) => (
          <div key={p.id} className={`poll-row pr-${p.verdict}`}>
            <span className="poll-call">{p.call}</span>
            <span className="poll-role">{p.role}</span>
            <span className="poll-note">{p.note ?? ""}</span>
            <span className={`poll-mark pm-${p.verdict}`}>{MARK[p.verdict]}</span>
          </div>
        ))}
      </div>

      {onDirective ? (
        <button
          className="poll-req"
          onClick={() =>
            onDirective(
              "Проведи контроль готовности к операции: опроси системы борта по телеметрии и доложи GO/NO-GO по каждой позиции и итоговое решение.",
            )
          }
        >
          ⇢ Запросить опрос у руководителя полёта
        </button>
      ) : null}
    </section>
  );
}
