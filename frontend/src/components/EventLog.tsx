import { useEffect, useRef } from "react";
import { fmtClock } from "../format";
import type { LogEntry } from "../types";

const KIND_LABEL: Record<string, string> = {
  directive: "ЗАДАНИЕ",
  tool_call: "КОМАНДА",
  tool_result: "КВИТАНЦИЯ",
  agent_done: "ВЫПОЛНЕНО",
  agent_error: "ОТКАЗ",
  agent_stopped: "ОТБОЙ",
  manual_command: "РУЧНАЯ",
};

function describe(entry: LogEntry): string {
  const p = entry.payload as Record<string, unknown>;
  switch (entry.kind) {
    case "directive":
      return String(p.text ?? "");
    case "tool_call":
      return `${p.name} ${JSON.stringify(p.args ?? {})}`;
    case "tool_result":
      return `${p.name}${p.is_error ? " — ОШИБКА: " : ": "}${String(p.output ?? "").slice(0, 160)}`;
    case "agent_done":
      return String(p.text ?? "").slice(0, 200);
    case "agent_error":
      return String(p.message ?? "");
    case "manual_command":
      return `${p.cmd} ${JSON.stringify(p.args ?? {})}${p.ok ? "" : " — ошибка: " + String(p.error ?? "")}`;
    default:
      return JSON.stringify(p).slice(0, 160);
  }
}

export function EventLog({ log }: { log: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <section className="card eventlog">
      <div className="card-title">
        <h2>Журнал операций</h2>
      </div>
      <div className="eventlog-scroll" ref={scrollRef}>
        <table>
          <tbody>
            {log.map((e, i) => (
              <tr key={i} className={`log-${e.kind}`}>
                <td className="log-time">{fmtClock(e.ts)}</td>
                <td className="log-kind">{KIND_LABEL[e.kind] ?? e.kind}</td>
                <td className="log-text">{describe(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
