import { fmtDuration, fmtMeters, fmtSituation, fmtSpeed, fmtTons } from "../format";
import type { Telemetry } from "../types";

function Tile(props: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`tile ${props.warn ? "tile-warn" : ""}`}>
      <div className="tile-label">{props.label}</div>
      <div className="tile-value">{props.value}</div>
      {props.hint ? <div className="tile-hint">{props.hint}</div> : null}
    </div>
  );
}

function pct(v: number | undefined): string {
  return v == null ? "—" : Math.round(v) + "%";
}

export function StatTiles({ telemetry }: { telemetry: Telemetry | null }) {
  const v = telemetry?.vessel;
  const o = v?.orbit;
  const node = v?.maneuver_nodes?.[0];
  const st = v?.staging;
  const fuel = v?.fuel;
  const stack = v?.stage_stack;

  // The stage currently burning, from delta-v staging.
  const burning = st?.stages?.find((s) => s.stage === st.burning_stage);
  const dv = st?.total_dv_vac_ms;

  return (
    <section className="card">
      <div className="card-title">
        <h2>Телеметрия борта</h2>
        <span className="card-note">
          {v?.name ? `${v.name} · ${v.body ?? "—"}` : "борт не в зоне"}
        </span>
      </div>
      <div className="tiles">
        <Tile label="Высота H" value={fmtMeters(v?.alt_sealevel_m)} hint={fmtSituation(v?.situation)} />
        <Tile label="Апогей Ha" value={fmtMeters(o?.apoapsis_m)} hint={`T до Ha ${fmtDuration(o?.time_to_ap_s)}`} />
        <Tile label="Перигей Hp" value={fmtMeters(o?.periapsis_m)} hint={`T до Hp ${fmtDuration(o?.time_to_pe_s)}`} />
        <Tile label="Скорость V" value={fmtSpeed(v?.surface_speed_ms)} hint={`Vверт ${fmtSpeed(v?.vertical_speed_ms)}`} />

        <Tile
          label="Хар. скорость ΔV"
          value={dv != null ? Math.round(dv) + " м/с" : "—"}
          hint={burning?.twr_vac != null ? `тяговоор. ${burning.twr_vac.toFixed(2)}` : undefined}
          warn={dv != null && dv < 100}
        />
        <Tile
          label="Топливо ступени"
          value={pct(fuel?.stage_pct)}
          hint={fuel?.under_thrust ? "тяга есть" : "тяги нет"}
          warn={fuel?.stage_pct != null && fuel.stage_pct < 5}
        />
        <Tile
          label="ДУ, работающих"
          value={st?.active_engines != null ? String(st.active_engines) : "—"}
          hint={
            fuel?.under_thrust
              ? "тяга есть"
              : v?.throttle && v.throttle > 0
                ? "нет тяги при РРД>0"
                : "отсечка"
          }
          warn={!!v?.throttle && v.throttle > 0 && !fuel?.under_thrust}
        />
        <Tile
          label="Ступень"
          value={
            stack?.current_stage != null && stack?.stage_count != null
              ? `${stack.stage_count - stack.current_stage}/${stack.stage_count}`
              : st?.burning_stage != null && st.burning_stage >= 0
                ? `№${st.burning_stage}`
                : "—"
          }
          hint={stack?.stage_count != null ? `осталось ${stack.stage_count}` : undefined}
        />

        <Tile label="Масса M" value={fmtTons(v?.mass_t)} hint={`запас топл. ${pct(fuel?.total_pct)}`} />
        <Tile label="Режим РРД" value={v?.throttle != null ? Math.round(v.throttle * 100) + "%" : "—"} hint={v?.sas?.enabled ? `СУД: ${v.sas.mode ?? "вкл"}` : "СУД откл"} />
        <Tile
          label="Угол накл. тр. θ"
          value={v?.flight_path_angle_deg != null ? Math.round(v.flight_path_angle_deg) + "°" : "—"}
          hint={
            [
              v?.nose_pitch_deg != null ? `тангаж ${Math.round(v.nose_pitch_deg)}°` : null,
              v?.heading_deg != null ? `курс ${Math.round(v.heading_deg)}°` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "над горизонтом"
          }
        />
        <Tile
          label="Наклонение i"
          value={o?.inclination_deg != null ? o.inclination_deg.toFixed(1) + "°" : "—"}
          hint={o?.eccentricity != null ? `эксц. e = ${o.eccentricity.toFixed(3)}` : undefined}
        />
        <Tile
          label="Коррекция ΔV"
          value={node ? `${Math.round(node.dv_ms)} м/с` : "—"}
          hint={node ? `старт через ${fmtDuration(node.time_until_s)}` : "коррекций нет"}
        />
      </div>
    </section>
  );
}
