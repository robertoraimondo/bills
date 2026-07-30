using System.Diagnostics;
using System.Net.Sockets;

const int Port = 5173;
const string Host = "127.0.0.1";

var root = AppDomain.CurrentDomain.BaseDirectory;
var packageJson = Path.Combine(root, "package.json");

if (!File.Exists(packageJson))
{
    Console.Error.WriteLine("package.json not found next to the launcher.");
    return 1;
}

var startInfo = new ProcessStartInfo
{
    FileName = "cmd.exe",
    Arguments = $"/c cd /d \"{root}\" && npm run dev -- --host 0.0.0.0 --port {Port} --strictPort",
    WorkingDirectory = root,
    UseShellExecute = false,
    CreateNoWindow = true,
    WindowStyle = ProcessWindowStyle.Hidden,
};

Process.Start(startInfo);

if (!WaitForPort(Host, Port, TimeSpan.FromSeconds(15)))
{
    Console.Error.WriteLine($"Dev server did not start on port {Port}.");
    return 1;
}

Process.Start(new ProcessStartInfo
{
    FileName = $"http://localhost:{Port}",
    UseShellExecute = true,
});

return 0;

static bool WaitForPort(string host, int port, TimeSpan timeout)
{
    var deadline = DateTime.UtcNow + timeout;

    while (DateTime.UtcNow < deadline)
    {
        try
        {
            using var client = new TcpClient();
            var result = client.BeginConnect(host, port, null, null);

            if (result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(400)) && client.Connected)
            {
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
        }

        Thread.Sleep(200);
    }

    return false;
}
