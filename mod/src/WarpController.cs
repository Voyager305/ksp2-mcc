using System;
using BepInEx.Logging;

namespace MccLink
{
    /// <summary>
    /// Warp-to-UT implemented as a simple main-thread controller: pick a rate
    /// index from the remaining time and step it down as the target nears.
    /// Avoids depending on any built-in WarpTo API.
    /// </summary>
    public class WarpController
    {
        private readonly ManualLogSource _log;
        private double? _targetUt;

        public WarpController(ManualLogSource log)
        {
            _log = log;
        }

        public bool IsWarping => _targetUt.HasValue;
        public double? TargetUt => _targetUt;

        public void WarpTo(double ut)
        {
            _targetUt = ut;
        }

        public void Cancel()
        {
            _targetUt = null;
            StopWarp();
        }

        public void Tick()
        {
            if (!_targetUt.HasValue) return;

            var warp = KspApi.TimeWarp;
            if (warp == null) { _targetUt = null; return; }

            var remaining = _targetUt.Value - KspApi.UniverseTime;
            if (remaining <= 0.5)
            {
                _targetUt = null;
                StopWarp();
                _log.LogInfo("[MccLink] warp target reached");
                return;
            }

            int desired = DesiredRateIndex(remaining);
            try
            {
                if (warp.CurrentRateIndex != desired)
                    warp.SetRateIndex(desired, false);
            }
            catch (Exception e)
            {
                _log.LogWarning($"[MccLink] warp control failed: {e.Message}");
                _targetUt = null;
            }
        }

        private static int DesiredRateIndex(double remainingSeconds)
        {
            // Conservative ramp: back off well before the target so the final
            // approach happens at low rates.
            if (remainingSeconds > 500000) return 8;
            if (remainingSeconds > 100000) return 7;
            if (remainingSeconds > 20000) return 6;
            if (remainingSeconds > 5000) return 5;
            if (remainingSeconds > 1000) return 4;
            if (remainingSeconds > 200) return 3;
            if (remainingSeconds > 50) return 2;
            if (remainingSeconds > 10) return 1;
            return 0;
        }

        private void StopWarp()
        {
            var warp = KspApi.TimeWarp;
            if (warp == null) return;
            try { warp.SetRateIndex(0, true); }
            catch { /* ignore */ }
        }
    }
}
