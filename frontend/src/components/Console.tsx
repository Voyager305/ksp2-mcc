import { FormEvent, useEffect, useRef, useState } from "react";
import type { ConsoleItem, MccState } from "../types";

function ToolItem({ item }: { item: Extract<ConsoleItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const icon = item.status === "running" ? "◌" : item.status === "ok" ? "✓" : "✕";
  return (
    <div className={`console-tool console-tool-${item.status}`}>
      <button className="console-tool-head" onClick={() => setOpen(!open)}>
        <span className="console-tool-icon" aria-hidden="true">
          {icon}
        </span>
        <code>{item.name}</code>
        <span className="console-tool-args">{JSON.stringify(item.args)}</span>
      </button>
      {open && item.output ? <pre className="console-tool-output">{item.output}</pre> : null}
    </div>
  );
}

function ConsoleItemView({ item }: { item: ConsoleItem }) {
  switch (item.kind) {
    case "directive":
      return (
        <div className="console-directive">
          <span className="console-role">ОПЕРАТОР</span>
          <p>{item.text}</p>
        </div>
      );
    case "thinking":
      return (
        <details className="console-thinking">
          <summary>анализ обстановки…</summary>
          <p>{item.text}</p>
        </details>
      );
    case "text":
      return (
        <div className="console-agent">
          <span className="console-role console-role-agent">FLIGHT</span>
          <p>{item.text}</p>
        </div>
      );
    case "tool":
      return <ToolItem item={item} />;
    case "status":
      return <div className={`console-status console-status-${item.variant}`}>{item.text}</div>;
  }
}

export function Console(props: {
  state: MccState;
  onDirective: (text: string) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const { state, onDirective, onStop, onReset } = props;
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.console, state.pendingTool]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onDirective(t);
    setText("");
  }

  const running = state.agentState === "running";

  return (
    <section className="card console">
      <div className="card-title">
        <h2>Руководитель полёта</h2>
        <div className="console-actions">
          {running ? (
            <button className="btn btn-danger" onClick={onStop}>
              ■ Отбой
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={onReset} title="Очистить контекст сеанса">
              Сброс сеанса
            </button>
          )}
        </div>
      </div>

      <div className="console-scroll" ref={scrollRef}>
        {state.console.length === 0 ? (
          <div className="console-empty">
            Передайте задание руководителю полёта — например: «вывести на круговую орбиту 100 км»,
            «исполнить коррекцию по узлу», «поднять апогей до 200 км».
          </div>
        ) : (
          state.console.map((item, i) => <ConsoleItemView key={i} item={item} />)
        )}
        {state.pendingTool ? (
          <div className="console-pending">◌ подготовка команды {state.pendingTool}…</div>
        ) : null}
      </div>

      <form className="console-input" onSubmit={submit}>
        <textarea
          value={text}
          placeholder={running ? "Идёт исполнение задания…" : "Задание руководителю полёта…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={2}
        />
        <button className="btn btn-primary" type="submit" disabled={running || !text.trim()}>
          Передать
        </button>
      </form>
    </section>
  );
}
