import { useState } from "react";
import type { MccState } from "../types";

const SAS_MODES = [
  ["StabilityAssist", "Стабилизация"],
  ["Prograde", "Прогрейд"],
  ["Retrograde", "Ретроград"],
  ["Normal", "Нормаль"],
  ["Antinormal", "Антинормаль"],
  ["RadialIn", "Радиал −"],
  ["RadialOut", "Радиал +"],
  ["Maneuver", "Манёвр"],
  ["Target", "Цель"],
  ["AntiTarget", "Анти-цель"],
] as const;

export function ManualPanel(props: {
  state: MccState;
  onCommand: (cmd: string, args?: Record<string, unknown>) => void;
}) {
  const { state, onCommand } = props;
  const [throttle, setThrottle] = useState(0);
  const [sasMode, setSasMode] = useState<string>("StabilityAssist");
  const [pitch, setPitch] = useState(90);
  const [heading, setHeading] = useState(90);
  const disabled = !state.bridgeConnected;

  return (
    <section className="card manual">
      <div className="card-title">
        <h2>Ручной контур управления</h2>
        <span className="card-note">команды в обход РП</span>
      </div>

      <div className="manual-grid">
        <div className="manual-row">
          <label className="manual-label" htmlFor="throttle">
            РРД {Math.round(throttle * 100)}%
          </label>
          <input
            id="throttle"
            type="range"
            min={0}
            max={100}
            value={Math.round(throttle * 100)}
            disabled={disabled}
            onChange={(e) => setThrottle(Number(e.target.value) / 100)}
            onMouseUp={() => onCommand("set_throttle", { value: throttle })}
            onTouchEnd={() => onCommand("set_throttle", { value: throttle })}
          />
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => {
              setThrottle(0);
              onCommand("set_throttle", { value: 0 });
            }}
          >
            0%
          </button>
        </div>

        <div className="manual-row">
          <label className="manual-label" htmlFor="sas-mode">
            СУД
          </label>
          <select
            id="sas-mode"
            value={sasMode}
            disabled={disabled}
            onChange={(e) => setSasMode(e.target.value)}
          >
            {SAS_MODES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_sas", { enabled: true, mode: sasMode })}
          >
            Вкл
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_sas", { enabled: false })}
          >
            Выкл
          </button>
        </div>

        <div className="manual-row">
          <label className="manual-label">Ориентация</label>
          <span className="manual-mini">тангаж</span>
          <input
            className="manual-numin"
            type="number"
            min={0}
            max={90}
            value={pitch}
            disabled={disabled}
            onChange={(e) => setPitch(Number(e.target.value))}
          />
          <span className="manual-mini">курс</span>
          <input
            className="manual-numin"
            type="number"
            min={0}
            max={360}
            value={heading}
            disabled={disabled}
            onChange={(e) => setHeading(Number(e.target.value))}
          />
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_attitude", { pitch, heading })}
          >
            Навести
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("hold_attitude")}
          >
            Отпустить
          </button>
        </div>

        <div className="manual-row manual-buttons">
          <button className="btn btn-warn" disabled={disabled} onClick={() => onCommand("stage")}>
            ⏏ Разделение
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_action_group", { group: "RCS", state: true })}
          >
            ДПО вкл
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_action_group", { group: "RCS", state: false })}
          >
            ДПО выкл
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => onCommand("set_action_group", { group: "Gear", state: true })}
          >
            Шасси
          </button>
          <button className="btn btn-ghost" disabled={disabled} onClick={() => onCommand("cancel_warp")}>
            Отмена варпа
          </button>
          <button
            className="btn btn-danger"
            disabled={disabled}
            onClick={() => {
              onCommand("cancel_warp");
              onCommand("set_throttle", { value: 0 });
              onCommand("set_sas", { enabled: true, mode: "StabilityAssist" });
            }}
          >
            ⚠ Безопасный режим
          </button>
        </div>
      </div>
    </section>
  );
}
