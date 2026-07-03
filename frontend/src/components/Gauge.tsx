// Radial gauge in the Open MCT style: gray track, red limit zones at the ends,
// value fill, big centered value + unit, min/max labels, "!" when in limit.
const CX = 70;
const CY = 66;
const R = 50;
const SW = 11;
const START = 135; // bottom-left
const SWEEP = 270; // gap at the bottom

const TRACK = "#4a4a4a";
const FILL = "#03ace4";
const LIMIT = "#8a1c14"; // dim red limit zone
const ALERT = "#ff3c00";

function polar(deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
}

function arc(a0: number, a1: number): string {
  const p0 = polar(a0);
  const p1 = polar(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export interface GaugeProps {
  label: string;
  value: number | null | undefined;
  display: string; // formatted value
  unit?: string;
  min: number;
  max: number;
  lowLimit?: number; // fraction 0..1 — red zone below
  highLimit?: number; // fraction 0..1 — red zone above
  inLimit?: boolean;
}

export function Gauge(props: GaugeProps) {
  const { label, value, display, unit, min, max, lowLimit, highLimit, inLimit } = props;
  const has = value != null && !Number.isNaN(value);
  const frac = has ? Math.max(0, Math.min(1, (value! - min) / (max - min))) : 0;
  const valAngle = START + frac * SWEEP;

  const angleAt = (f: number) => START + Math.max(0, Math.min(1, f)) * SWEEP;

  return (
    <div className="gauge">
      <svg viewBox="0 0 140 132" className="gauge-svg">
        {/* track */}
        <path d={arc(START, START + SWEEP)} fill="none" stroke={TRACK} strokeWidth={SW} strokeLinecap="round" />
        {/* limit zones */}
        {lowLimit != null && lowLimit > 0 && (
          <path d={arc(START, angleAt(lowLimit))} fill="none" stroke={LIMIT} strokeWidth={SW} />
        )}
        {highLimit != null && highLimit < 1 && (
          <path d={arc(angleAt(highLimit), START + SWEEP)} fill="none" stroke={LIMIT} strokeWidth={SW} />
        )}
        {/* value fill */}
        {has && (
          <path
            d={arc(START, valAngle)}
            fill="none"
            stroke={inLimit ? ALERT : FILL}
            strokeWidth={SW}
            strokeLinecap="round"
          />
        )}
        {/* min / max labels */}
        <text x={22} y={122} fill="#808080" fontSize={9} textAnchor="middle">
          {min}
        </text>
        <text x={118} y={122} fill="#808080" fontSize={9} textAnchor="middle">
          {max}
        </text>
        {/* value */}
        <text x={CX} y={CY + 2} fill="#fff" fontSize={22} fontWeight={600} textAnchor="middle">
          {has ? display : "—"}
        </text>
        {unit && (
          <text x={CX} y={CY + 20} fill="#acacac" fontSize={11} textAnchor="middle">
            {unit}
          </text>
        )}
        {inLimit && (
          <text x={CX} y={CY + 38} fill={ALERT} fontSize={13} textAnchor="middle" fontWeight={700}>
            !
          </text>
        )}
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
