import { fmtMeters } from "../format";
import type { Vessel } from "../types";

const VB = 200;
const CENTER = 100;
const DRAW = 150; // max drawing extent across the orbit

const ACCENT = "#35c4e6";
const BODY = "#173a26";

export function OrbitalView({ vessel }: { vessel: Vessel | null | undefined }) {
  const o = vessel?.orbit;
  const a = o?.semi_major_axis_m;
  const e = o?.eccentricity;

  const ready = a != null && e != null && a > 0 && e >= 0 && e < 1;

  let content: JSX.Element;
  if (!ready) {
    content = <div className="orb-empty">нет орбиты (аппарат на поверхности?)</div>;
  } else {
    const rPe = a! * (1 - e!);
    const rAp = a! * (1 + e!);
    // World: focus (body center) at origin, periapsis toward +x.
    const worldCenterX = (rPe - rAp) / 2; // = -a*e
    const halfWidth = a!; // (rAp + rPe)/2
    const scale = DRAW / (2 * halfWidth);

    const toScreen = (wx: number, wy: number): [number, number] => [
      CENTER + (wx - worldCenterX) * scale,
      CENTER - wy * scale, // flip y
    ];

    // Orbit ellipse polyline.
    const pts: string[] = [];
    for (let deg = 0; deg <= 360; deg += 4) {
      const nu = (deg * Math.PI) / 180;
      const r = (a! * (1 - e! * e!)) / (1 + e! * Math.cos(nu));
      const [sx, sy] = toScreen(r * Math.cos(nu), r * Math.sin(nu));
      pts.push(`${sx.toFixed(1)},${sy.toFixed(1)}`);
    }

    const bodyRadiusWorld = Math.max(0, rPe - (o?.periapsis_m ?? 0));
    const bodyR = Math.max(3, bodyRadiusWorld * scale);
    const [fx, fy] = toScreen(0, 0);

    const [apx, apy] = toScreen(-rAp, 0);
    const [pex, pey] = toScreen(rPe, 0);

    // Vessel at current true anomaly.
    let vesselDot: JSX.Element | null = null;
    if (o?.true_anomaly_deg != null) {
      const nu = (o.true_anomaly_deg * Math.PI) / 180;
      const r = (a! * (1 - e! * e!)) / (1 + e! * Math.cos(nu));
      const [vx, vy] = toScreen(r * Math.cos(nu), r * Math.sin(nu));
      vesselDot = <circle cx={vx} cy={vy} r={3} fill={ACCENT} stroke="#fff" strokeWidth={1} />;
    }

    content = (
      <svg viewBox={`0 0 ${VB} ${VB}`} className="orb-svg">
        <polyline points={pts.join(" ")} fill="none" stroke="#4a4a46" strokeWidth={1} />
        <circle cx={fx} cy={fy} r={bodyR} fill={BODY} stroke="#3c4a3c" strokeWidth={1} />
        {/* Ap / Pe */}
        <circle cx={apx} cy={apy} r={2.5} fill="#eda100" />
        <text x={apx + 4} y={apy + 3} fill="#898781" fontSize={8}>
          Ап
        </text>
        <circle cx={pex} cy={pey} r={2.5} fill="#199e70" />
        <text x={pex + 4} y={pey + 3} fill="#898781" fontSize={8}>
          Пе
        </text>
        {vesselDot}
      </svg>
    );
  }

  return (
    <section className="card orbitalview">
      <div className="card-title">
        <h2>Орбита</h2>
        <span className="card-note">
          {o?.apoapsis_m != null
            ? `${fmtMeters(o.apoapsis_m)} × ${fmtMeters(o.periapsis_m)}`
            : "—"}
        </span>
      </div>
      <div className="orb-body">{content}</div>
    </section>
  );
}
