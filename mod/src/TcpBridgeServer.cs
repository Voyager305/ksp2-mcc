using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using BepInEx.Logging;
using Newtonsoft.Json.Linq;

namespace MccLink
{
    public class IncomingCommand
    {
        public int ClientId;
        public string Id;
        public string Cmd;
        public JObject Args;
    }

    /// <summary>
    /// Newline-delimited JSON over TCP. Socket IO runs on background threads;
    /// parsed commands are queued for the main thread.
    /// </summary>
    public class TcpBridgeServer
    {
        private readonly int _port;
        private readonly ManualLogSource _log;
        private TcpListener _listener;
        private Thread _acceptThread;
        private volatile bool _running;
        private int _nextClientId;

        private class ClientState
        {
            public TcpClient Tcp;
            public StreamWriter Writer;
            public readonly object WriteLock = new object();
        }

        private readonly ConcurrentDictionary<int, ClientState> _clients =
            new ConcurrentDictionary<int, ClientState>();

        public readonly ConcurrentQueue<IncomingCommand> PendingCommands =
            new ConcurrentQueue<IncomingCommand>();

        public bool HasClients => !_clients.IsEmpty;

        public TcpBridgeServer(int port, ManualLogSource log)
        {
            _port = port;
            _log = log;
        }

        public void Start()
        {
            _running = true;
            _listener = new TcpListener(IPAddress.Any, _port);
            _listener.Start();
            _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "MccLink-Accept" };
            _acceptThread.Start();
        }

        public void Stop()
        {
            _running = false;
            try { _listener?.Stop(); } catch { /* ignore */ }
            foreach (var kv in _clients)
            {
                try { kv.Value.Tcp.Close(); } catch { /* ignore */ }
            }
            _clients.Clear();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                TcpClient tcp;
                try { tcp = _listener.AcceptTcpClient(); }
                catch { break; }

                tcp.NoDelay = true;
                var id = Interlocked.Increment(ref _nextClientId);
                var state = new ClientState
                {
                    Tcp = tcp,
                    Writer = new StreamWriter(tcp.GetStream(), new UTF8Encoding(false)) { AutoFlush = true },
                };
                _clients[id] = state;
                _log.LogInfo($"[MccLink] client #{id} connected from {tcp.Client.RemoteEndPoint}");

                var reader = new Thread(() => ReadLoop(id, state)) { IsBackground = true, Name = $"MccLink-Read-{id}" };
                reader.Start();
            }
        }

        private void ReadLoop(int clientId, ClientState state)
        {
            try
            {
                using (var reader = new StreamReader(state.Tcp.GetStream(), Encoding.UTF8))
                {
                    string line;
                    while (_running && (line = reader.ReadLine()) != null)
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        try
                        {
                            var obj = JObject.Parse(line);
                            PendingCommands.Enqueue(new IncomingCommand
                            {
                                ClientId = clientId,
                                Id = (string)obj["id"] ?? "",
                                Cmd = (string)obj["cmd"] ?? "",
                                Args = obj["args"] as JObject ?? new JObject(),
                            });
                        }
                        catch (Exception e)
                        {
                            _log.LogWarning($"[MccLink] bad json from client #{clientId}: {e.Message}");
                        }
                    }
                }
            }
            catch { /* connection dropped */ }
            finally
            {
                _clients.TryRemove(clientId, out _);
                try { state.Tcp.Close(); } catch { /* ignore */ }
                _log.LogInfo($"[MccLink] client #{clientId} disconnected");
            }
        }

        public void Send(int clientId, string json)
        {
            if (json == null) return;
            if (!_clients.TryGetValue(clientId, out var state)) return;
            try
            {
                lock (state.WriteLock) { state.Writer.WriteLine(json); }
            }
            catch
            {
                _clients.TryRemove(clientId, out _);
            }
        }

        public void Broadcast(string json)
        {
            if (json == null) return;
            List<int> dead = null;
            foreach (var kv in _clients)
            {
                try
                {
                    lock (kv.Value.WriteLock) { kv.Value.Writer.WriteLine(json); }
                }
                catch
                {
                    (dead = dead ?? new List<int>()).Add(kv.Key);
                }
            }
            if (dead != null)
            {
                foreach (var id in dead) _clients.TryRemove(id, out _);
            }
        }
    }
}
