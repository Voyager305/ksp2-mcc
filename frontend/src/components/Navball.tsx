import type { Vessel } from "../types";

const R = 82;
const CX = 100;
const CY = 100;
const K = 1.9; // pixels per degree of pitch

function ladder(pitch: number, roll: number) {
  const lines = [];
  for (let p = -60; p <= 60; p += 30) {
    if (p === 0) continue;
    const y = CY + (pitch - p) * K;
    lines.push({ p, y });
  }
  return lines;
}

export function Navball({ vessel }: { vessel: Vessel | null | undefined }) {
  const pitch = vessel?.nose_pitch_deg ?? 0;
  const roll = vessel?.roll_deg ?? 0;
  const heading = vessel?.heading_deg;

  // Horizon offset: nose up (positive pitch) pushes the horizon below center.
  const horizonY = CY + pitch * K;

  return (
    <section className="card navball">
      <div className="card-title">
        <h2>Ориентация</h2>
        <span className="card-note">
          {heading != null ? `курс ${Math.round(heading)}°` : "—"}
        </span>
      </div>
      <div className="nav-body">
        <svg viewBox="0 0 200 200" className="nav-svg">
          <defs>
            <clipPath id="navclip">
              <circle cx={CX} cy={CY} r={R} />
            </clipPath>
          </defs>

          <g clipPath="url(#navclip)">
            {/* sky/ground rotate with roll, translate with pitch */}
            <g transform={`rotate(${-roll} ${CX} ${CY})`}>
              <rect x={CX - 200} y={horizonY - 400} width={400} height={400} fill="#245e8c" />
              <rect x={CX - 200} y={horizonY} width={400} height={400} fill="#5a4326" />
              {/* horizon line */}
              <line
                x1={CX - 200}
                y1={horizonY}
                x2={CX + 200}
                y2={horizonY}
                stroke="#e8e6dd"
                strokeWidth={1.5}
              />
              {/* pitch ladder */}
              {ladder(pitch, roll).map(({ p, y }) => (
                <g key={p}>
                  <line x1={CX - 22} y1={y} x2={CX + 22} y2={y} stroke="#d6d4c9" strokeWidth={0.8} />
                  <text x={CX + 27} y={y + 3} fill="#d6d4c9" fontSize={9}>
                    {p > 0 ? p : -p}
                  </text>
                </g>
              ))}
            </g>
          </g>

          {/* bezel */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#383835" strokeWidth={2} />

          {/* fixed aircraft waterline symbol */}
          <g stroke="#f5c542" strokeWidth={2.5} fill="none">
            <line x1={CX - 30} y1={CY} x2={CX - 12} y2={CY} />
            <line x1={CX + 12} y1={CY} x2={CX + 30} y2={CY} />
            <circle cx={CX} cy={CY} r={2.5} fill="#f5c542" stroke="none" />
          </g>

          {/* roll pointer */}
          <g transform={`rotate(${-roll} ${CX} ${CY})`}>
            <path d={`M${CX},${CY - R + 2} l-5,9 l10,0 z`} fill="#f5c542" />
          </g>
        </svg>

        <div className="nav-readout">
          <div>
            <span className="nav-k">тангаж</span>
            <span className="nav-v">{Math.round(pitch)}°</span>
          </div>
          <div>
            <span className="nav-k">крен</span>
            <span className="nav-v">{Math.round(roll)}°</span>
          </div>
          <div>
            <span className="nav-k">курс</span>
            <span className="nav-v">{heading != null ? Math.round(heading) + "°" : "—"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
