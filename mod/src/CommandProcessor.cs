using System;
using System.Collections.Generic;
using BepInEx.Logging;
using KSP.Sim;
using KSP.Sim.impl;
using KSP.Sim.Maneuver;
using KSP.Sim.State;
using Newtonsoft.Json.Linq;

namespace MccLink
{
    /// <summary>Executes bridge commands against the game. Main thread only.</summary>
    public class CommandProcessor
    {
        private readonly ManualLogSource _log;
        private readonly TelemetryCollector _telemetry;
        private readonly WarpController _warp;
        private readonly AttitudeController _attitude;
        private readonly TranslationController _translation;

        public CommandProcessor(
            ManualLogSource log,
            TelemetryCollector telemetry,
            WarpController warp,
            AttitudeController attitude,
            TranslationController translation)
        {
            _log = log;
            _telemetry = telemetry;
            _warp = warp;
            _attitude = attitude;
            _translation = translation;
        }

        public string Execute(IncomingCommand cmd)
        {
            JObject response;
            try
            {
                var result = Dispatch(cmd.Cmd, cmd.Args);
                response = new JObject
                {
                    ["type"] = "response",
                    ["id"] = cmd.Id,
                    ["ok"] = true,
                    ["result"] = result,
                };
            }
            catch (Exception e)
            {
                _log.LogWarning($"[MccLink] command '{cmd.Cmd}' failed: {e}");
                response = new JObject
                {
                    ["type"] = "response",
                    ["id"] = cmd.Id,
                    ["ok"] = false,
                    ["error"] = e.Message,
                };
            }
            return response.ToString(Newtonsoft.Json.Formatting.None);
        }

        private JToken Dispatch(string cmd, JObject args)
        {
            switch (cmd)
            {
                case "ping":
                    return new JObject { ["pong"] = true, ["ut"] = KspApi.UniverseTime };

                case "get_telemetry":
                    return _telemetry.Collect();

                case "set_throttle":
                    return SetThrottle(GetDouble(args, "value"));

                case "stage":
                    return Stage();

                case "set_sas":
                    // A SAS hold mode and a custom attitude target conflict; the
                    // last command wins, so drop the attitude hold here.
                    _attitude.Clear();
                    return SetSas(args);

                case "set_attitude":
                    _attitude.SetAttitude(
                        GetDouble(args, "pitch"),
                        GetDouble(args, "heading"));
                    return new JObject
                    {
                        ["holding"] = true,
                        ["pitch"] = _attitude.Pitch,
                        ["heading"] = _attitude.Heading,
                    };

                case "hold_attitude":
                    _attitude.Clear();
                    return new JObject { ["holding"] = false };

                case "set_action_group":
                    return SetActionGroup(GetString(args, "group"), GetBool(args, "state"));

                case "create_node":
                    return CreateNode(
                        GetDouble(args, "ut"),
                        GetDouble(args, "prograde", 0),
                        GetDouble(args, "normal", 0),
                        GetDouble(args, "radial", 0));

                case "clear_nodes":
                    return ClearNodes();

                case "warp_to":
                    _warp.WarpTo(GetDouble(args, "ut"));
                    return new JObject { ["warping_to"] = _warp.TargetUt };

                case "cancel_warp":
                    _warp.Cancel();
                    return new JObject { ["warping"] = false };

                case "warp_index":
                    return WarpIndex((int)GetDouble(args, "index"));

                case "list_targets":
                    return ListTargets();

                case "set_target":
                    return SetTarget(GetString(args, "name"));

                case "clear_target":
                    RequireVessel().ClearTarget();
                    return new JObject { ["cleared"] = true };

                case "set_translation":
                    _translation.Set(
                        GetDouble(args, "right", 0),
                        GetDouble(args, "up", 0),
                        GetDouble(args, "forward", 0));
                    return new JObject
                    {
                        ["right"] = _translation.Right,
                        ["up"] = _translation.Up,
                        ["forward"] = _translation.Forward,
                    };

                default:
                    throw new ArgumentException($"unknown command: {cmd}");
            }
        }

        private static JToken SetThrottle(double value)
        {
            var vehicle = RequireVehicle();
            var clamped = (float)Math.Max(0.0, Math.Min(1.0, value));
            vehicle.AtomicSet(new FlightCtrlStateIncremental { mainThrottle = clamped });
            return new JObject { ["throttle"] = clamped };
        }

        private static JToken Stage()
        {
            var vessel = RequireVessel();
            vessel.ActivateNextStage();
            return new JObject { ["staged"] = true };
        }

        private static JToken SetSas(JObject args)
        {
            var vessel = RequireVessel();
            var autopilot = vessel.Autopilot;
            if (autopilot == null) throw new InvalidOperationException("autopilot not available");

            var result = new JObject();
            if (args.TryGetValue("enabled", out var enabledTok))
            {
                autopilot.Enabled = (bool)enabledTok;
                result["enabled"] = autopilot.Enabled;
            }
            if (args.TryGetValue("mode", out var modeTok))
            {
                var modeName = (string)modeTok;
                if (!Enum.TryParse<AutopilotMode>(modeName, true, out var mode))
                    throw new ArgumentException($"unknown SAS mode: {modeName}");
                autopilot.SetMode(mode);
                result["mode"] = mode.ToString();
            }
            return result;
        }

        private static JToken SetActionGroup(string groupName, bool state)
        {
            var vessel = RequireVessel();
            if (!Enum.TryParse<KSPActionGroup>(groupName, true, out var group))
                throw new ArgumentException($"unknown action group: {groupName}");
            vessel.SetActionGroup(group, state);
            return new JObject { ["group"] = group.ToString(), ["state"] = state };
        }

        private JToken CreateNode(double ut, double prograde, double normal, double radial)
        {
            var game = KspApi.Game;
            var vessel = RequireVessel();
            var simObject = vessel.SimulationObject;
            var plan = simObject?.FindComponent<ManeuverPlanComponent>();
            if (game == null || simObject == null || plan == null)
                throw new InvalidOperationException("maneuver system not available");

            if (ut <= KspApi.UniverseTime)
                throw new ArgumentException("node UT must be in the future");

            var burn = new Vector3d(radial, normal, prograde);

            // Canonical KSP2 sequence (as used by NodeManager / FlightPlan):
            // register the node with the maneuver provider, THEN set the burn
            // vector and recompute — AddNode alone is unreliable and can throw.
            var node = new ManeuverNodeData(simObject.GlobalId, false, ut)
            {
                BurnVector = burn,
            };
            game.SpaceSimulation.Maneuvers.AddNodeToVessel(node);
            node.BurnVector = burn;
            plan.UpdateNodeDetails(node);

            return new JObject
            {
                ["ut"] = node.Time,
                ["dv_ms"] = node.BurnRequiredDV,
                ["burn_duration_s"] = node.BurnDuration,
            };
        }

        private JToken ClearNodes()
        {
            var vessel = RequireVessel();
            var plan = vessel.SimulationObject?.FindComponent<ManeuverPlanComponent>();
            if (plan == null) throw new InvalidOperationException("maneuver plan not available");

            var nodes = new List<ManeuverNodeData>(plan.GetNodes());
            foreach (var node in nodes) plan.RemoveNode(node, false);
            return new JObject { ["removed"] = nodes.Count };
        }

        private JToken WarpIndex(int index)
        {
            var warp = KspApi.TimeWarp;
            if (warp == null) throw new InvalidOperationException("time warp not available");
            warp.SetRateIndex(Math.Max(0, index), false);
            return new JObject { ["rate_index"] = index };
        }

        private JToken ListTargets()
        {
            var game = KspApi.Game;
            var active = RequireVessel();
            if (game == null) throw new InvalidOperationException("game not available");

            var activePos = active.CenterOfMass;

            var list = new List<KeyValuePair<double, JObject>>();
            foreach (var vessel in game.UniverseModel.GetAllVessels())
            {
                var so = vessel.SimulationObject;
                if (so == null || !so.IsVessel || so.IsActiveVessel) continue;
                double dist;
                try { dist = new Vector(so.Position, activePos).magnitude; }
                catch { continue; }
                list.Add(new KeyValuePair<double, JObject>(dist, new JObject
                {
                    ["name"] = vessel.Name,
                    ["distance_m"] = Math.Round(dist, 1),
                }));
            }
            list.Sort((a, b) => a.Key.CompareTo(b.Key));

            var arr = new JArray();
            for (int i = 0; i < list.Count && i < 20; i++) arr.Add(list[i].Value);
            return new JObject { ["targets"] = arr };
        }

        private JToken SetTarget(string query)
        {
            var game = KspApi.Game;
            var active = RequireVessel();
            if (game == null) throw new InvalidOperationException("game not available");

            var activePos = active.CenterOfMass;

            VesselComponent match = null;
            double best = double.MaxValue;
            foreach (var vessel in game.UniverseModel.GetAllVessels())
            {
                var so = vessel.SimulationObject;
                if (so == null || !so.IsVessel || so.IsActiveVessel) continue;
                if (vessel.Name == null ||
                    vessel.Name.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) continue;
                double dist;
                try { dist = new Vector(so.Position, activePos).magnitude; }
                catch { dist = double.MaxValue; }
                if (dist < best) { best = dist; match = vessel; }
            }
            if (match == null) throw new ArgumentException($"цель не найдена: {query}");

            active.SetTargetByID(match.SimulationObject.GlobalId);
            return new JObject { ["target"] = match.Name, ["distance_m"] = Math.Round(best, 1) };
        }

        private static VesselComponent RequireVessel()
        {
            var vessel = KspApi.ActiveVessel;
            if (vessel == null) throw new InvalidOperationException("no active vessel");
            return vessel;
        }

        private static VesselVehicle RequireVehicle()
        {
            var vehicle = KspApi.ActiveVehicle;
            if (vehicle == null) throw new InvalidOperationException("no active vehicle (not in flight?)");
            return vehicle;
        }

        private static double GetDouble(JObject args, string key, double? fallback = null)
        {
            if (args.TryGetValue(key, out var tok)) return (double)tok;
            if (fallback.HasValue) return fallback.Value;
            throw new ArgumentException($"missing argument: {key}");
        }

        private static string GetString(JObject args, string key)
        {
            if (args.TryGetValue(key, out var tok)) return (string)tok;
            throw new ArgumentException($"missing argument: {key}");
        }

        private static bool GetBool(JObject args, string key)
        {
            if (args.TryGetValue(key, out var tok)) return (bool)tok;
            throw new ArgumentException($"missing argument: {key}");
        }
    }
}
