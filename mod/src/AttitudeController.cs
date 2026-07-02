using System;
using BepInEx.Logging;
using HarmonyLib;
using KSP.Sim;
using KSP.Sim.impl;

namespace MccLink
{
    /// <summary>
    /// Actively points the vessel at a target attitude expressed as elevation
    /// above the local horizon (pitch, 0..90 deg) and compass heading
    /// (0 = north, 90 = east). SAS Prograde is engaged so the flight-controller
    /// steers toward the SAS TargetOrientation; a Harmony postfix then overwrites
    /// that target with ours every autopilot frame, which is what lets us hold an
    /// arbitrary attitude (StabilityAssist ignores TargetOrientation, and the
    /// directional modes overwrite it with their own vector each frame).
    /// Main thread only.
    /// </summary>
    public class AttitudeController
    {
        private const double Deg2Rad = Math.PI / 180.0;

        // The patch runs in the game's autopilot update; it reaches the live
        // command through this single instance.
        internal static AttitudeController Active;

        private readonly ManualLogSource _log;
        private double? _pitch;   // elevation above horizon, degrees
        private double _heading;  // compass degrees, 0 = north

        public AttitudeController(ManualLogSource log)
        {
            _log = log;
            Active = this;
        }

        public bool Holding => _pitch.HasValue;
        public double? Pitch => _pitch;
        public double Heading => _heading;

        public void SetAttitude(double pitchDeg, double headingDeg)
        {
            _pitch = Math.Max(0.0, Math.Min(90.0, pitchDeg));
            _heading = ((headingDeg % 360.0) + 360.0) % 360.0;

            var vessel = KspApi.ActiveVessel;
            if (vessel?.Autopilot != null)
            {
                try
                {
                    vessel.Autopilot.Enabled = true;
                    // A directional mode makes the SAS steer toward TargetOrientation,
                    // which the Harmony postfix then redirects to our aim.
                    vessel.Autopilot.SetMode(AutopilotMode.Prograde);
                }
                catch (Exception e)
                {
                    _log.LogWarning($"[MccLink] attitude enable failed: {e.Message}");
                }
            }
        }

        public void Clear()
        {
            _pitch = null;
            var vessel = KspApi.ActiveVessel;
            if (vessel?.Autopilot != null)
            {
                // Fall back to holding the current attitude.
                try { vessel.Autopilot.SetMode(AutopilotMode.StabilityAssist); }
                catch { /* ignore */ }
            }
        }

        /// <summary>Computes the world-space aim direction for a vessel, if holding.</summary>
        public bool TryGetTarget(VesselComponent vessel, out Vector target)
        {
            target = default;
            if (!_pitch.HasValue || vessel == null) return false;

            var tele = vessel.SimulationObject?.FindComponent<TelemetryComponent>();
            if (tele == null) return false;

            double elev = _pitch.Value * Deg2Rad;
            double hdg = _heading * Deg2Rad;
            Vector horizontal =
                tele.HorizonNorth * Math.Cos(hdg) + tele.HorizonEast * Math.Sin(hdg);
            target = Vector.normalize(tele.HorizonUp * Math.Sin(elev) + horizontal * Math.Cos(elev));
            return true;
        }
    }

    /// <summary>
    /// Redirects the active vessel's SAS target to our commanded attitude after
    /// the game's autopilot has set its own target for the frame, so a plain
    /// directional SAS mode ends up steering wherever we ask.
    /// </summary>
    [HarmonyPatch(typeof(VesselAutopilot), "AutoPilotPreSASUpdate")]
    internal static class AutopilotAttitudePatch
    {
        private static void Postfix(VesselAutopilot __instance)
        {
            var ctrl = AttitudeController.Active;
            if (ctrl == null || !ctrl.Holding) return;

            var vessel = KspApi.ActiveVessel;
            if (vessel?.Autopilot != __instance || __instance.SAS == null) return;

            try
            {
                if (ctrl.TryGetTarget(vessel, out var target))
                    __instance.SAS.SetTargetOrientation(target, false);
            }
            catch { /* frame not ready */ }
        }
    }
}
