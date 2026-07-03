import type { TrackPoint, Vessel } from "../types";

// Equirectangular board: lon [-180,180] -> x [0,360], lat [90,-90] -> y [0,180].
const W = 360;
const H = 180;

const ACCENT = "#03ace4";
const LAND = "#3a3a3a";
const LAND_EDGE = "#4a4a4a";
const GRID = "#3f3f3f";
const INK_MUTED = "#808080";

// Kerbin launch site (approx), only shown when orbiting Kerbin.
const KSC = { lat: -0.1, lon: -74.6, label: "КЦ" };

// Stylized Kerbin landmasses (approximate silhouettes, just for recognizability).
const KERBIN_LAND = [
  "M150,78 q18,-10 40,-4 q22,6 30,20 q6,14 -10,22 q-24,10 -46,2 q-20,-8 -22,-24 q-1,-10 8,-16 Z",
  "M60,70 q16,-8 30,-2 q14,8 8,20 q-8,14 -28,12 q-18,-2 -20,-16 q-1,-9 10,-14 Z",
  "M250,60 q20,-6 34,4 q12,10 2,22 q-14,14 -34,8 q-14,-6 -14,-20 q0,-10 12,-14 Z",
  "M110,120 q14,-6 26,0 q12,8 4,18 q-10,10 -26,6 q-12,-4 -12,-16 q0,-5 8,-8 Z",
  "M300,110 q16,-4 26,6 q8,10 -4,18 q-16,8 -28,-2 q-8,-8 -2,-16 Z",
];

function lonToX(lon: number): number {
  const l = (((lon + 180) % 360) + 360) % 360; // 0..360
  return l;
}
function latToY(lat: number): number {
  return 90 - Math.max(-90, Math.min(90, lat));
}

// Split a track into polyline segments, breaking where longitude wraps around.
function trackSegments(track: TrackPoint[]): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  let prevLon: number | null = null;
  for (const p of track) {
    if (prevLon != null && Math.abs(p.lon - prevLon) > 180) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    }
    cur.push(`${lonToX(p.lon).toFixed(2)},${latToY(p.lat).toFixed(2)}`);
    prevLon = p.lon;
  }
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

export function GroundTrack(props: {
  vessel: Vessel | null | undefined;
  track: TrackPoint[];
  body: string | null;
}) {
  const { vessel, track, body } = props;
  const lat = vessel?.latitude_deg;
  const lon = vessel?.longitude_deg;
  const hasPos = lat != null && lon != null;
  const isKerbin = (body ?? "").toLowerCase() === "kerbin";

  const meridians = [];
  for (let l = 0; l <= 360; l += 30) meridians.push(l);
  const parallels = [];
  for (let a = 0; a <= 180; a += 30) parallels.push(a);

  const segs = trackSegments(track);
  const vx = hasPos ? lonToX(lon!) : 0;
  const vy = hasPos ? latToY(lat!) : 0;

  // Heading arrow direction (screen space: +x east, +y south).
  const hdg = vessel?.heading_deg;
  let arrow: { x2: number; y2: number } | null = null;
  if (hasPos && hdg != null) {
    const r = 10;
    const a = (hdg * Math.PI) / 180;
    arrow = { x2: vx + r * Math.sin(a), y2: vy - r * Math.cos(a) };
  }

  return (
    <section className="card groundtrack">
      <div className="card-title">
        <h2>Трасса полёта</h2>
        <span className="card-note">
          {body ?? "—"}
          {hasPos ? ` · φ ${lat!.toFixed(2)}° λ ${lon!.toFixed(2)}°` : " · нет координат"}
        </span>
      </div>
      <div className="gt-body">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="gt-svg">
          {/* ocean / base */}
          <rect x={0} y={0} width={W} height={H} fill="#242424" />

          {/* land */}
          {isKerbin &&
            KERBIN_LAND.map((d, i) => (
              <path key={i} d={d} fill={LAND} stroke={LAND_EDGE} strokeWidth={0.5} />
            ))}

          {/* graticule */}
          {meridians.map((l) => (
            <line key={`m${l}`} x1={l} y1={0} x2={l} y2={H} stroke={GRID} strokeWidth={0.5} />
          ))}
          {parallels.map((a) => (
            <line
              key={`p${a}`}
              x1={0}
              y1={a}
              x2={W}
              y2={a}
              stroke={a === 90 ? "#3a3a37" : GRID}
              strokeWidth={a === 90 ? 0.8 : 0.5}
            />
          ))}

          {/* KSC */}
          {isKerbin && (
            <g>
              <rect x={lonToX(KSC.lon) - 1.5} y={latToY(KSC.lat) - 1.5} width={3} height={3} fill="#eda100" />
            </g>
          )}

          {/* track */}
          {segs.map((pts, i) => (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={ACCENT}
              strokeWidth={0.9}
              strokeOpacity={0.85}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* vessel */}
          {hasPos && (
            <g>
              {arrow && (
                <line x1={vx} y1={vy} x2={arrow.x2} y2={arrow.y2} stroke="#fff" strokeWidth={0.9} />
              )}
              <line x1={vx - 6} y1={vy} x2={vx + 6} y2={vy} stroke="#fff" strokeWidth={0.5} strokeOpacity={0.5} />
              <line x1={vx} y1={vy - 6} x2={vx} y2={vy + 6} stroke="#fff" strokeWidth={0.5} strokeOpacity={0.5} />
              <circle className="gt-vessel" cx={vx} cy={vy} r={2.4} fill={ACCENT} stroke="#fff" strokeWidth={0.8} />
            </g>
          )}
        </svg>

        {/* labels overlaid */}
        <div className="gt-labels">
          {isKerbin ? <span className="gt-ksc">◆ {KSC.label}</span> : null}
        </div>
      </div>
    </section>
  );
}
