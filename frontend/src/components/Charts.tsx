import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtClock } from "../format";
import type { ChartPoint } from "../types";

// Open MCT palette (cyan key / amber / green)
const SERIES_1 = "#03ace4"; // Open MCT key cyan
const SERIES_2 = "#ffb66c"; // status alert amber
const SERIES_3 = "#60ba7b"; // status info green

const GRID = "#3f3f3f";
const AXIS_INK = "#808080";

interface SeriesDef {
  key: keyof ChartPoint;
  name: string;
  color: string;
}

function CustomTooltip(props: {
  active?: boolean;
  label?: number;
  payload?: { name?: string; value?: number | string; stroke?: string; color?: string }[];
  format: (v: number) => string;
}) {
  const { active, label, payload, format } = props;
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{label ? fmtClock(label) : ""}</div>
      {payload.map((p, i) => (
        <div className="chart-tooltip-row" key={i}>
          <span
            className="chart-tooltip-key"
            style={{ background: p.color ?? p.stroke }}
            aria-hidden="true"
          />
          <span className="chart-tooltip-value">
            {typeof p.value === "number" ? format(p.value) : "—"}
          </span>
          <span className="chart-tooltip-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function TelemetryChart(props: {
  title: string;
  data: ChartPoint[];
  series: SeriesDef[];
  format: (v: number) => string;
}) {
  const { title, data, series, format } = props;
  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <div className="chart-legend" role="list">
          {series.map((s) => (
            <span className="chart-legend-item" role="listitem" key={s.key}>
              <span className="chart-legend-key" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ts: number) => fmtClock(ts)}
              stroke="transparent"
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              tickLine={false}
              minTickGap={60}
            />
            <YAxis
              tickFormatter={format}
              stroke="transparent"
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              tickLine={false}
              width={58}
            />
            <Tooltip
              content={<CustomTooltip format={format} />}
              cursor={{ stroke: AXIS_INK, strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const fmtKm = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + " Мм";
  if (Math.abs(v) >= 1000) return Math.round(v / 1000) + " км";
  return Math.round(v) + " м";
};
const fmtMs = (v: number) => Math.round(v) + " м/с";

export function Charts({ data }: { data: ChartPoint[] }) {
  return (
    <section className="card charts">
      <TelemetryChart
        title="Высота и орбита"
        data={data}
        format={fmtKm}
        series={[
          { key: "alt_m", name: "Высота", color: SERIES_1 },
          { key: "apoapsis_m", name: "Апоцентр", color: SERIES_2 },
          { key: "periapsis_m", name: "Перицентр", color: SERIES_3 },
        ]}
      />
      <TelemetryChart
        title="Скорость"
        data={data}
        format={fmtMs}
        series={[
          { key: "surface_speed_ms", name: "Полная", color: SERIES_1 },
          { key: "vertical_speed_ms", name: "Вертикальная", color: SERIES_2 },
        ]}
      />
    </section>
  );
}
