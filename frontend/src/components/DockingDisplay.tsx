import { fmtMeters } from "../format";
import type { Vessel } from "../types";

const RANGES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function niceRange(x: number): number {
  for (const r of RANGES) if (x <= r) return r;
  return RANGES[RANGES.length - 1];
}

function Readout(props: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`dock-read ${props.warn ? "dock-read-warn" : ""}`}>
      <span className="dock-k">{props.label}</span>
      <span className="dock-v">{props.value}</span>
    </div>
  );
}

export function DockingDisplay(props: {
  vessel: Vessel | null | undefined;
  onCommand: (cmd: string, args?: Record<string, unknown>) => void;
}) {
  const { vessel, onCommand } = props;
  const t = vessel?.target;
  const rcsLevel = 0.2;

  const rcsPad = (
    <div className="dock-rcs">
      <div className="dock-rcs-title">ДПО · причаливание</div>
      <div className="dock-rcs-grid">
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { up: rcsLevel })}>
          ↑ вверх
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { forward: rcsLevel })}>
          ⤒ вперёд
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { up: -rcsLevel })}>
          ↓ вниз
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { right: -rcsLevel })}>
          ← влево
        </button>
        <button className="btn btn-danger" onClick={() => onCommand("set_translation", { forward: 0, right: 0, up: 0 })}>
          ■ стоп
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { right: rcsLevel })}>
          → вправо
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_action_group", { group: "RCS", state: true })}>
          ДПО вкл
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_translation", { forward: -rcsLevel })}>
          ⤓ назад
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand("set_action_group", { group: "RCS", state: false })}>
          ДПО выкл
        </button>
      </div>
    </div>
  );

  if (!t || t.distance_m == null) {
    return (
      <section className="card docking">
        <div className="card-title">
          <h2>Причаливание и стыковка</h2>
          <span className="card-note">цель не назначена</span>
        </div>
        <div className="dock-empty">
          Цель не назначена. Дайте руководителю полёта команду назначить цель, либо используйте
          команду set_target.
        </div>
        {rcsPad}
      </section>
    );
  }

  const oR = t.offset_right_m ?? 0;
  const oU = t.offset_up_m ?? 0;
  const range = niceRange(Math.max(5, Math.abs(oR), Math.abs(oU)));
  const scale = 80 / range;
  const tx = 100 + oR * scale;
  const ty = 100 - oU * scale;

  // Lateral relative velocity vector (scaled arbitrarily for display).
  const vR = t.rel_vel_right_ms ?? 0;
  const vU = t.rel_vel_up_ms ?? 0;
  const vScale = 6;
  const vx = tx + vR * vScale;
  const vy = ty - vU * vScale;

  const relSpeed = t.rel_speed_ms ?? 0;

  return (
    <section className="card docking">
      <div className="card-title">
        <h2>Причаливание и стыковка</h2>
        <span className="card-note">цель: {t.name ?? "—"}</span>
      </div>

      <div className="dock-body">
        <svg viewBox="0 0 200 200" className="dock-svg">
          {[80, 53, 26].map((r) => (
            <circle key={r} cx={100} cy={100} r={r} fill="none" stroke="#2c2c2a" strokeWidth={1} />
          ))}
          <line x1={20} y1={100} x2={180} y2={100} stroke="#2c2c2a" strokeWidth={0.6} />
          <line x1={100} y1={20} x2={100} y2={180} stroke="#2c2c2a" strokeWidth={0.6} />
          {/* center = own docking axis */}
          <circle cx={100} cy={100} r={3} fill="none" stroke="#f5c542" strokeWidth={1.5} />

          {/* relative velocity vector */}
          <line x1={tx} y1={ty} x2={vx} y2={vy} stroke="#ff3c00" strokeWidth={1.5} />
          {/* target marker */}
          <circle cx={Math.max(6, Math.min(194, tx))} cy={Math.max(6, Math.min(194, ty))} r={4} fill="#03ace4" stroke="#fff" strokeWidth={1} />

          <text x={6} y={14} fill="#898781" fontSize={9}>
            ±{range >= 1000 ? range / 1000 + " км" : range + " м"}
          </text>
        </svg>

        <div className="dock-reads">
          <Readout label="Дальность D" value={fmtMeters(t.distance_m)} />
          <Readout label="Скор. сближения" value={relSpeed.toFixed(2) + " м/с"} warn={relSpeed > 5 && (t.distance_m ?? 0) < 200} />
          <Readout label="Ось X (прод.)" value={(t.offset_fwd_m ?? 0).toFixed(1) + " м"} />
          <Readout label="Промах Y →" value={oR.toFixed(1) + " м"} warn={Math.abs(oR) > 2} />
          <Readout label="Промах Z ↑" value={oU.toFixed(1) + " м"} warn={Math.abs(oU) > 2} />
          <Readout label="Vсбл по X" value={(t.rel_vel_fwd_ms ?? 0).toFixed(2) + " м/с"} />
        </div>
      </div>

      {rcsPad}
    </section>
  );
}
