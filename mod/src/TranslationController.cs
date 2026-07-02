using System;
using BepInEx.Logging;
using KSP.Sim.State;

namespace MccLink
{
    /// <summary>
    /// Holds an RCS translation command (right/up/forward, each -1..1) and applies
    /// it to the flight controls every frame until released (set all to 0). RCS
    /// must be enabled (action group) for the translation to produce thrust.
    /// Main thread only.
    /// </summary>
    public class TranslationController
    {
        private readonly ManualLogSource _log;
        private float _x, _y, _z; // right, up, forward
        private bool _active;

        public TranslationController(ManualLogSource log)
        {
            _log = log;
        }

        public bool Active => _active;
        public float Right => _x;
        public float Up => _y;
        public float Forward => _z;

        private static float Clamp(double v) => (float)Math.Max(-1.0, Math.Min(1.0, v));

        public void Set(double right, double up, double forward)
        {
            _x = Clamp(right);
            _y = Clamp(up);
            _z = Clamp(forward);
            // Even all-zero is applied once (to release cleanly), then deactivates.
            _active = true;
        }

        public void Tick()
        {
            if (!_active) return;

            var vehicle = KspApi.ActiveVehicle;
            if (vehicle == null)
            {
                _active = false;
                return;
            }

            try
            {
                vehicle.AtomicSet(new FlightCtrlStateIncremental { X = _x, Y = _y, Z = _z });
            }
            catch (Exception e)
            {
                _log.LogWarning($"[MccLink] translation failed: {e.Message}");
                _active = false;
                return;
            }

            // Once we've pushed zero, stop applying so the player/agent regains control.
            if (_x == 0f && _y == 0f && _z == 0f) _active = false;
        }
    }
}
