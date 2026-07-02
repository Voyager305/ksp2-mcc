using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using SpaceWarp;
using SpaceWarp.API.Mods;
using UnityEngine;

namespace MccLink
{
    [BepInPlugin(ModGuid, ModName, ModVer)]
    [BepInDependency(SpaceWarpPlugin.ModGuid, SpaceWarpPlugin.ModVer)]
    public class MccLinkPlugin : BaseSpaceWarpPlugin
    {
        public const string ModGuid = "com.mcc.mcclink";
        public const string ModName = "MCC Link";
        public const string ModVer = "0.1.0";

        private TcpBridgeServer _server;
        private CommandProcessor _commands;
        private TelemetryCollector _telemetry;
        private WarpController _warp;
        private AttitudeController _attitude;
        private TranslationController _translation;
        private float _lastTelemetryTime;

        private ConfigEntry<int> _port;
        private ConfigEntry<float> _telemetryHz;

        public override void OnInitialized()
        {
            base.OnInitialized();

            _port = Config.Bind("Server", "Port", 8766, "TCP port the MCC bridge listens on");
            _telemetryHz = Config.Bind("Server", "TelemetryHz", 5f, "Telemetry broadcast frequency (samples per second)");

            _telemetry = new TelemetryCollector();
            _warp = new WarpController(Logger);
            _attitude = new AttitudeController(Logger);
            _translation = new TranslationController(Logger);
            _commands = new CommandProcessor(Logger, _telemetry, _warp, _attitude, _translation);

            // Harmony patch that redirects the SAS target to our commanded attitude.
            Harmony.CreateAndPatchAll(typeof(AutopilotAttitudePatch), ModGuid);
            _server = new TcpBridgeServer(_port.Value, Logger);
            _server.Start();

            Logger.LogInfo($"[MccLink] bridge listening on 0.0.0.0:{_port.Value}");
        }

        private void Update()
        {
            if (_server == null) return;

            // Commands arrive on socket threads; the game API must only be
            // touched from the main thread, so they are drained here.
            while (_server.PendingCommands.TryDequeue(out var cmd))
            {
                var response = _commands.Execute(cmd);
                _server.Send(cmd.ClientId, response);
            }

            _warp.Tick();
            _translation.Tick();

            var hz = _telemetryHz != null ? _telemetryHz.Value : 5f;
            var interval = 1f / Mathf.Max(0.2f, hz);
            if (_server.HasClients && Time.unscaledTime - _lastTelemetryTime >= interval)
            {
                _lastTelemetryTime = Time.unscaledTime;
                var json = _telemetry.CollectJson();
                if (json != null) _server.Broadcast(json);
            }
        }

        private void OnDestroy()
        {
            _server?.Stop();
        }
    }
}
