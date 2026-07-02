export function fmtMeters(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + " Мм";
  if (abs >= 10_000) return (v / 1000).toFixed(1) + " км";
  if (abs >= 1000) return (v / 1000).toFixed(2) + " км";
  return Math.round(v).toLocaleString("ru-RU") + " м";
}

export function fmtSpeed(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString("ru-RU") + " м/с";
}

export function fmtDuration(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "—";
  const sign = s < 0 ? "-" : "";
  s = Math.abs(Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}ч ${m}м ${sec}с`;
  if (m > 0) return `${sign}${m}м ${sec}с`;
  return `${sign}${sec}с`;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("ru-RU", { hour12: false });
}

export function fmtTons(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(1) + " т";
}

const SITUATIONS: Record<string, string> = {
  PreLaunch: "Предстарт",
  Landed: "На поверхности",
  Splashed: "На воде",
  Flying: "Полёт в атмосфере",
  SubOrbital: "Суборбитальный",
  Orbiting: "На орбите",
  Escaping: "Уход от тела",
  Docked: "Состыкован",
};

export function fmtSituation(s: string | undefined): string {
  if (!s) return "—";
  return SITUATIONS[s] ?? s;
}
