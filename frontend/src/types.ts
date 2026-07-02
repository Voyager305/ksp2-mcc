export interface Orbit {
  apoapsis_m?: number;
  periapsis_m?: number;
  eccentricity?: number;
  inclination_deg?: number;
  period_s?: number;
  time_to_ap_s?: number;
  time_to_pe_s?: number;
  semi_major_axis_m?: number;
  lan_deg?: number;
  arg_pe_deg?: number;
  true_anomaly_deg?: number;
  mean_anomaly_deg?: number;
}

export interface Dynamics {
  g_force?: number;
  dynamic_pressure_kpa?: number;
  mach?: number;
  in_atmosphere?: boolean;
  static_pressure_kpa?: number;
  atm_density?: number;
  external_temp_k?: number;
}

export interface ResourceAmount {
  stored: number;
  capacity: number;
}

export type Resources = Record<string, ResourceAmount>;

export interface TargetInfo {
  name?: string;
  distance_m?: number;
  rel_speed_ms?: number;
  offset_fwd_m?: number;
  offset_right_m?: number;
  offset_up_m?: number;
  rel_vel_fwd_ms?: number;
  rel_vel_right_ms?: number;
  rel_vel_up_ms?: number;
}

export interface ManeuverNode {
  ut: number;
  time_until_s: number;
  dv_ms: number;
  burn_duration_s: number;
}

export interface Fuel {
  total_pct?: number;
  stage_pct?: number;
  under_thrust?: boolean;
}

export interface StageInfo {
  stage: number;
  dv_vac_ms?: number;
  thrust_vac?: number;
  twr_vac?: number;
  burn_time_s?: number;
  active_engines?: number;
  engines_in_stage?: number;
}

export interface Staging {
  total_dv_vac_ms?: number;
  active_engines?: number;
  burning_stage?: number;
  stages?: StageInfo[];
}

export interface StackStage {
  stage: number;
  active?: boolean;
  parts?: Record<string, number>;
  engines_ignited?: number;
}

export interface StageStack {
  stage_count?: number;
  current_stage?: number;
  stages?: StackStage[];
}

export interface Vessel {
  name?: string;
  situation?: string;
  body?: string;
  alt_sealevel_m?: number;
  alt_terrain_m?: number;
  surface_speed_ms?: number;
  vertical_speed_ms?: number;
  horizontal_speed_ms?: number;
  mass_t?: number;
  throttle?: number;
  flight_path_angle_deg?: number;
  nose_pitch_deg?: number;
  heading_deg?: number;
  latitude_deg?: number;
  longitude_deg?: number;
  roll_deg?: number;
  orbit?: Orbit;
  sas?: { enabled?: boolean; mode?: string };
  total_dv_vac_ms?: number;
  target?: TargetInfo;
  maneuver_nodes?: ManeuverNode[];
  fuel?: Fuel;
  staging?: Staging;
  stage_stack?: StageStack;
  dynamics?: Dynamics;
  resources?: Resources;
}

export interface Telemetry {
  ut: number;
  has_vessel: boolean;
  vessel?: Vessel;
}

export interface ChartPoint {
  ts: number;
  alt_m: number | null;
  apoapsis_m: number | null;
  periapsis_m: number | null;
  surface_speed_ms: number | null;
  vertical_speed_ms: number | null;
  throttle: number | null;
}

export type ConsoleItem =
  | { kind: "directive"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      name: string;
      args: unknown;
      status: "running" | "ok" | "error";
      output?: string;
    }
  | { kind: "status"; variant: "done" | "error" | "stopped" | "rejected"; text: string };

export interface LogEntry {
  ts: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface TrackPoint {
  lat: number;
  lon: number;
}

export interface MccState {
  wsConnected: boolean;
  bridgeConnected: boolean;
  agentState: "idle" | "running";
  telemetry: Telemetry | null;
  chart: ChartPoint[];
  track: TrackPoint[];
  trackBody: string | null;
  log: LogEntry[];
  console: ConsoleItem[];
  pendingTool: string | null;
}
