using KSP.Game;
using KSP.Sim.impl;

namespace MccLink
{
    /// <summary>
    /// Every direct call into the game's API is funneled through this class so
    /// that version-specific breakage stays localized to one file.
    /// Main thread only.
    /// </summary>
    internal static class KspApi
    {
        public static GameInstance Game =>
            GameManager.Instance != null ? GameManager.Instance.Game : null;

        public static VesselComponent ActiveVessel
        {
            get
            {
                var game = Game;
                if (game == null || game.ViewController == null) return null;
                try { return game.ViewController.GetActiveSimVessel(true); }
                catch { return null; }
            }
        }

        public static VesselVehicle ActiveVehicle
        {
            get
            {
                var game = Game;
                if (game == null || game.ViewController == null) return null;
                try { return game.ViewController.GetActiveVehicle(true) as VesselVehicle; }
                catch { return null; }
            }
        }

        public static double UniverseTime
        {
            get
            {
                var game = Game;
                if (game == null || game.UniverseModel == null) return 0;
                return game.UniverseModel.UniverseTime;
            }
        }

        public static TimeWarp TimeWarp
        {
            get
            {
                var game = Game;
                if (game == null || game.ViewController == null) return null;
                return game.ViewController.TimeWarp;
            }
        }
    }
}
