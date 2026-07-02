using System;
using KSP.Sim;
using KSP.Sim.DeltaV;
using KSP.Sim.impl;
using KSP.Sim.Maneuver;
using KSP.Sim.ResourceSystem;
using Newtonsoft.Json.Linq;

namespace MccLink
{
    /// <summary>Builds the telemetry snapshot broadcast to MCC clients. Main thread only.</summary>
    public class TelemetryCollector
    {
        public string CollectJson()
        {
            var data = Collect();
            if (data == null) return null;
            var envelope = new JObject
            {
                ["type"] = "telemetry",
                ["data"] = data,
            };
            return envelope.ToString(Newtonsoft.Json.Formatting.None);
        }

        public JObject Collect()
        {
            var data = new JObject
            {
                ["ut"] = KspApi.UniverseTime,
            };

            var vessel = KspApi.ActiveVessel;
            if (vessel == null)
            {
                data["has_vessel"] = false;
                return data;
            }

            data["has_vessel"] = true;

            try
            {
                data["vessel"] = BuildVessel(vessel);
            }
            catch (Exception e)
            {
                data["vessel_error"] = e.Message;
            }

            return data;
        }

        private static JObject BuildVessel(VesselComponent vessel)
        {
            var v = new JObject
            {
                ["name"] = vessel.Name,
                ["situation"] = vessel.Situation.ToString(),
                ["body"] = vessel.mainBody != null ? vessel.mainBody.Name : null,
                ["alt_sealevel_m"] = Round(vessel.AltitudeFromSeaLevel),
                ["alt_terrain_m"] = Round(vessel.AltitudeFromTerrain),
                ["surface_speed_ms"] = Round(vessel.SrfSpeedMagnitude),
                ["vertical_speed_ms"] = Round(vessel.VerticalSrfSpeed),
                ["horizontal_speed_ms"] = Round(vessel.HorizontalSrfSpeed),
                ["mass_t"] = Round(vessel.totalMass),
                ["throttle"] = Round(vessel.flightCtrlState.mainThrottle),
            };

            // Flight-path angle: the angle of the velocity vector above the local
            // horizon. 90 = straight up, 0 = horizontal. During ascent this must
            // fall toward 0 as you build the horizontal speed needed for orbit;
            // if it stays near 90 the rocket is going straight up and periapsis
            // will never rise. Heading: compass direction of travel (90 = east).
            try
            {
                double vs = vessel.VerticalSrfSpeed;
                double hs = vessel.HorizontalSrfSpeed;
                if (Math.Abs(vs) + Math.Abs(hs) > 0.1)
                    v["flight_path_angle_deg"] = Round(Math.Atan2(vs, hs) * 180.0 / Math.PI, 1);
            }
            catch { /* speed frame not ready */ }

            try
            {
                var vehicle = KspApi.ActiveVehicle;
                if (vehicle != null)
                {
                    v["heading_deg"] = Round(vehicle.Heading, 1);
                    // Sub-vessel point on the body — drives the ground-track map.
                    v["latitude_deg"] = Round(vehicle.Latitude, 4);
                    v["longitude_deg"] = Round(vehicle.Longitude, 4);

                    // Flight-dynamics / aero (FIDO): g-load, aero pressure, mach, thermal.
                    v["dynamics"] = new JObject
                    {
                        ["g_force"] = Round(vehicle.GeeForce, 2),
                        ["dynamic_pressure_kpa"] = Round(vehicle.DynamicPressurekPa, 3),
                        ["mach"] = Round(vehicle.MachNumber, 2),
                        ["in_atmosphere"] = vehicle.IsInAtmosphere,
                        ["static_pressure_kpa"] = Round(vehicle.StaticPressurekPa, 3),
                        ["atm_density"] = Round(vehicle.AtmosphericDensity, 4),
                        ["external_temp_k"] = Round(vehicle.ExternalTemperature, 1),
                    };
                }
            }
            catch { /* heading / lat-lon / dynamics not available */ }

            try
            {
                // Where the NOSE actually points above the horizon (vs
                // flight_path_angle, which is where the vessel MOVES). If a
                // set_attitude command is not turning the nose, these diverge.
                v["nose_pitch_deg"] = Round(vessel.Pitch_HorizonRelative, 1);
                v["roll_deg"] = Round(vessel.Roll_HorizonRelative, 1);
            }
            catch { /* attitude not available */ }

            try
            {
                v["resources"] = BuildResources(vessel);
            }
            catch { /* resource system not available */ }

            var orbit = vessel.Orbit;
            if (orbit != null)
            {
                v["orbit"] = new JObject
                {
                    ["apoapsis_m"] = Round(orbit.ApoapsisArl),
                    ["periapsis_m"] = Round(orbit.PeriapsisArl),
                    ["eccentricity"] = Round(orbit.eccentricity, 5),
                    ["inclination_deg"] = Round(orbit.inclination, 3),
                    ["period_s"] = Round(orbit.period),
                    ["time_to_ap_s"] = Round(orbit.TimeToAp),
                    ["time_to_pe_s"] = Round(orbit.TimeToPe),
                    ["semi_major_axis_m"] = Round(orbit.semiMajorAxis),
                    ["lan_deg"] = Round(orbit.longitudeOfAscendingNode, 2),
                    ["arg_pe_deg"] = Round(orbit.argumentOfPeriapsis, 2),
                    // Anomalies are radians in the sim; expose degrees for the UI.
                    ["true_anomaly_deg"] = Round(orbit.TrueAnomaly * 180.0 / Math.PI, 2),
                    ["mean_anomaly_deg"] = Round(orbit.MeanAnomaly * 180.0 / Math.PI, 2),
                };
            }

            var autopilot = vessel.Autopilot;
            if (autopilot != null)
            {
                v["sas"] = new JObject
                {
                    ["enabled"] = autopilot.Enabled,
                    ["mode"] = autopilot.AutopilotMode.ToString(),
                };
            }

            // Fuel & thrust state — the signals needed to decide when to stage.
            try
            {
                v["fuel"] = new JObject
                {
                    // Percent remaining (0 = empty). stage_pct is for the CURRENT stage:
                    // when it hits ~0 the current-stage engines are spent → stage.
                    ["total_pct"] = Round(vessel.FuelPercentage, 1),
                    ["stage_pct"] = Round(vessel.StageFuelPercentage, 1),
                    // True only while engines are actually producing thrust. If throttle > 0
                    // but under_thrust is false, the active stage has flamed out → stage.
                    ["under_thrust"] = vessel.IsUnderEngineThrust(),
                };
            }
            catch { /* fuel telemetry not available */ }

            try
            {
                v["staging"] = BuildStaging(vessel);
            }
            catch { /* delta-v / staging not available */ }

            try
            {
                v["stage_stack"] = BuildStageStack(vessel);
            }
            catch { /* staging component not available */ }

            try
            {
                if (vessel.HasTargetObject && vessel.TargetObject != null)
                    v["target"] = BuildTarget(vessel);
            }
            catch { /* no target / relative nav not available */ }

            try
            {
                v["maneuver_nodes"] = BuildNodes(vessel);
            }
            catch { /* maneuver plan not available */ }

            return v;
        }

        private static JObject BuildStaging(VesselComponent vessel)
        {
            var dv = vessel.VesselDeltaV;
            if (dv == null) return null;

            var result = new JObject
            {
                ["total_dv_vac_ms"] = Round(dv.TotalDeltaVVac),
                // Engines currently producing thrust across the whole vessel.
                ["active_engines"] = dv.GetActivatedEngines(),
            };

            // Per remaining stage. The stage currently burning is the one whose
            // active_engines > 0; when that drops to 0 the stage is spent → stage.
            var stages = new JArray();
            int burningStage = -1;
            var stageInfo = dv.StageInfo;
            if (stageInfo != null)
            {
                foreach (DeltaVStageInfo stage in stageInfo)
                {
                    int active = stage.EnginesActiveInStage != null
                        ? stage.EnginesActiveInStage.Count
                        : 0;
                    if (active > 0 && stage.Stage > burningStage) burningStage = stage.Stage;
                    stages.Add(new JObject
                    {
                        ["stage"] = stage.Stage,
                        ["dv_vac_ms"] = Round(stage.DeltaVinVac),
                        ["thrust_vac"] = Round(stage.ThrustVac),
                        ["twr_vac"] = Round(stage.TWRVac, 2),
                        ["burn_time_s"] = Round(stage.StageBurnTime),
                        ["active_engines"] = active,
                        ["engines_in_stage"] = stage.EnginesInStage != null
                            ? stage.EnginesInStage.Count
                            : 0,
                    });
                }
            }
            result["burning_stage"] = burningStage;
            result["stages"] = stages;
            return result;
        }

        // The full staging stack: how many stages remain and WHAT each one does
        // (fire an engine, decouple, deploy a parachute...). This lets the director
        // reason that "next stage press = separate spent boosters, the one after =
        // ignite the upper engine".
        private static JObject BuildStageStack(VesselComponent vessel)
        {
            var staging = vessel.SimulationObject?.FindComponent<StagingComponent>();
            if (staging == null) return null;

            var result = new JObject
            {
                ["stage_count"] = staging.StageCount,
                ["current_stage"] = staging.StageCount - 1,
            };

            var stagesArr = new JArray();
            var available = staging.AvailableStages;
            if (available != null)
            {
                foreach (StagePartsInternal sp in available)
                {
                    if (!staging.IsValidStageIndex(sp.ID)) continue;

                    // Count parts by role and note engines that are lit right now.
                    var roles = new JObject();
                    int ignited = 0;
                    var parts = staging.GetPartsInStage(sp.ID);
                    if (parts != null)
                    {
                        foreach (PartComponent part in parts)
                        {
                            string role = ClassifyPart(part, ref ignited);
                            roles[role] = (roles[role]?.Value<int>() ?? 0) + 1;
                        }
                    }

                    stagesArr.Add(new JObject
                    {
                        ["stage"] = sp.ID,
                        ["active"] = sp.IsActive,
                        ["parts"] = roles,
                        ["engines_ignited"] = ignited,
                    });
                }
            }

            result["stages"] = stagesArr;
            return result;
        }

        // Relative navigation to the current target, in the vessel's own control
        // frame — the data needed to rendezvous and dock. offset_* is where the
        // target is (meters: +forward ahead, +right, +up); rel_vel_* is the
        // target's velocity relative to us (m/s). Null everything to hold station;
        // approach by reducing forward offset slowly with near-zero lateral drift.
        private static JObject BuildTarget(VesselComponent vessel)
        {
            var target = vessel.TargetObject;
            var obj = new JObject { ["name"] = target.Name };

            try
            {
                var relPos = new Vector(target.Position, vessel.CenterOfMass); // vessel -> target
                obj["distance_m"] = Round(relPos.magnitude, 1);
                obj["rel_speed_ms"] = Round(vessel.TargetSpeed, 2);

                var ct = vessel.ControlTransform;
                if (ct != null)
                {
                    Vector fwd = ct.forward, right = ct.right, up = ct.up;
                    obj["offset_fwd_m"] = Round(Vector.dot(relPos, fwd), 1);
                    obj["offset_right_m"] = Round(Vector.dot(relPos, right), 1);
                    obj["offset_up_m"] = Round(Vector.dot(relPos, up), 1);

                    var relVel = vessel.TargetVelocity;
                    obj["rel_vel_fwd_ms"] = Round(Vector.dot(relVel, fwd), 2);
                    obj["rel_vel_right_ms"] = Round(Vector.dot(relVel, right), 2);
                    obj["rel_vel_up_ms"] = Round(Vector.dot(relVel, up), 2);
                }
            }
            catch { /* frames not ready */ }

            return obj;
        }

        // Vessel-wide resource totals by type (EECOM view). Only resources the
        // vessel actually carries (capacity > 0) are included.
        private static readonly string[] ResourceNames =
        {
            "ElectricCharge", "Methalox", "MonoPropellant", "XenonGas", "Hydrogen",
            "LiquidFuel", "Oxidizer", "SolidFuel", "IntakeAir", "Ablator", "Uranium",
        };

        private static JObject BuildResources(VesselComponent vessel)
        {
            var partOwner = vessel.SimulationObject?.FindComponent<PartOwnerComponent>();
            var group = partOwner != null ? partOwner.ContainerGroup : null;
            var db = KspApi.Game != null ? KspApi.Game.ResourceDefinitionDatabase : null;
            if (group == null || db == null) return null;

            var result = new JObject();
            foreach (var name in ResourceNames)
            {
                ResourceDefinitionID id;
                try { id = db.GetResourceIDFromName(name); }
                catch { continue; }

                double capacity;
                try { capacity = group.GetResourceCapacityUnits(id); }
                catch { continue; }
                if (capacity <= 0.0001) continue;

                double stored = group.GetResourceStoredUnits(id);
                result[name] = new JObject
                {
                    ["stored"] = Round(stored, 1),
                    ["capacity"] = Round(capacity, 1),
                };
            }
            return result;
        }

        private static string ClassifyPart(PartComponent part, ref int ignited)
        {
            // Priority order: the staging-relevant modules first.
            if (part.TryGetModule<PartComponentModule_Engine>(out var engine))
            {
                if (engine != null && engine.EngineIgnited) ignited++;
                return "engine";
            }
            if (part.TryGetModule<PartComponentModule_Decouple>(out _)) return "decoupler";
            if (part.TryGetModule<PartComponentModule_Parachute>(out _)) return "parachute";
            if (part.TryGetModule<PartComponentModule_Fairing>(out _)) return "fairing";
            if (part.TryGetModule<PartComponentModule_GroundLaunchClamp>(out _)) return "launch_clamp";
            if (part.TryGetModule<PartComponentModule_DockingNode>(out _)) return "docking_port";
            if (part.TryGetModule<PartComponentModule_RCS>(out _)) return "rcs";
            if (part.TryGetModule<PartComponentModule_SolarPanel>(out _)) return "solar_panel";
            if (part.TryGetModule<PartComponentModule_Generator>(out _)) return "generator";
            return "other";
        }

        private static JArray BuildNodes(VesselComponent vessel)
        {
            var arr = new JArray();
            var plan = vessel.SimulationObject?.FindComponent<ManeuverPlanComponent>();
            if (plan == null) return arr;

            var now = KspApi.UniverseTime;
            foreach (ManeuverNodeData node in plan.GetNodes())
            {
                arr.Add(new JObject
                {
                    ["ut"] = Round(node.Time),
                    ["time_until_s"] = Round(node.Time - now),
                    ["dv_ms"] = Round(node.BurnRequiredDV),
                    ["burn_duration_s"] = Round(node.BurnDuration),
                });
            }
            return arr;
        }

        private static double Round(double value, int digits = 2)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return 0;
            return Math.Round(value, digits);
        }
    }
}
