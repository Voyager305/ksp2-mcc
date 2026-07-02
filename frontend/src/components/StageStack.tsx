import type { StackStage, Staging, Telemetry } from "../types";

// Role → short Russian label + glyph. Order = display priority.
const ROLE_LABEL: Record<string, { label: string; icon: string }> = {
  engine: { label: "двигатель", icon: "▲" },
  decoupler: { label: "разделитель", icon: "⊟" },
  separator: { label: "сепаратор", icon: "⊟" },
  parachute: { label: "парашют", icon: "⛱" },
  fairing: { label: "обтекатель", icon: "◑" },
  launch_clamp: { label: "зажим", icon: "⎇" },
  docking_port: { label: "стык. узел", icon: "⊕" },
  rcs: { label: "RCS", icon: "✦" },
  solar_panel: { label: "солн. панель", icon: "☀" },
  generator: { label: "генератор", icon: "⚡" },
  other: { label: "прочее", icon: "•" },
};

function StageRow(props: {
  stage: StackStage;
  isNext: boolean;
  burning: boolean;
}) {
  const { stage, isNext, burning } = props;
  const parts = stage.parts ?? {};
  const roles = Object.keys(parts);

  let cls = "stack-row";
  if (stage.active) cls += " stack-row-spent";
  if (burning) cls += " stack-row-burning";
  if (isNext) cls += " stack-row-next";

  return (
    <div className={cls}>
      <div className="stack-num">{stage.stage}</div>
      <div className="stack-parts">
        {roles.length === 0 ? (
          <span className="stack-empty">пусто</span>
        ) : (
          roles.map((role) => {
            const meta = ROLE_LABEL[role] ?? ROLE_LABEL.other;
            const count = parts[role];
            return (
              <span className={`stack-part stack-part-${role}`} key={role}>
                <span className="stack-part-icon" aria-hidden="true">
                  {meta.icon}
                </span>
                {meta.label}
                {count > 1 ? ` ×${count}` : ""}
                {role === "engine" && stage.engines_ignited ? " 🔥" : ""}
              </span>
            );
          })
        )}
      </div>
      <div className="stack-tag">
        {burning ? "горит" : stage.active ? "отраб." : isNext ? "далее" : ""}
      </div>
    </div>
  );
}

export function StageStack({ telemetry }: { telemetry: Telemetry | null }) {
  const stack = telemetry?.vessel?.stage_stack;
  const staging: Staging | undefined = telemetry?.vessel?.staging;

  if (!stack || !stack.stages || stack.stages.length === 0) {
    return (
      <section className="card stagestack">
        <div className="card-title">
          <h2>Схема разделения</h2>
          <span className="card-note">нет данных</span>
        </div>
        <div className="stack-hint">
          Обновите мод (stage_stack) и перезапустите игру, чтобы видеть состав ступеней.
        </div>
      </section>
    );
  }

  // Highest-numbered stage is the top of the stack (fired last). The "next"
  // stage to activate is current_stage.
  const stages = [...stack.stages].sort((a, b) => b.stage - a.stage);
  const next = stack.current_stage;
  const burning = staging?.burning_stage;

  return (
    <section className="card stagestack">
      <div className="card-title">
        <h2>Ступени</h2>
        <span className="card-note">
          {stack.stage_count != null ? `осталось ${stack.stage_count}` : ""}
          {burning != null && burning >= 0 ? ` · горит #${burning}` : ""}
        </span>
      </div>
      <div className="stack-list">
        {stages.map((s) => (
          <StageRow
            key={s.stage}
            stage={s}
            isNext={s.stage === next && !s.active}
            burning={burning != null && s.stage === burning}
          />
        ))}
      </div>
    </section>
  );
}
