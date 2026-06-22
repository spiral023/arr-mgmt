using System.Diagnostics;
using System.Text;

var utf8NoBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
Console.OutputEncoding = utf8NoBom;
Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8NoBom) { AutoFlush = true });

var baseDirectory = AppContext.BaseDirectory;
var appExe = Path.Combine(baseDirectory, "ARR Ops.exe");

if (!File.Exists(appExe))
{
    WriteJsonError(
        "app_not_found",
        $"ARR Ops.exe wurde nicht neben arr-cli.exe gefunden: {appExe}",
        "arr-cli.exe muss im selben Ordner wie ARR Ops.exe liegen, z. B. release\\win-unpacked.");
    return 1;
}

var childArgs = args.Length == 0 ? ["help"] : args;
var startInfo = new ProcessStartInfo(appExe)
{
    UseShellExecute = false,
};

startInfo.Environment.Remove("ELECTRON_RUN_AS_NODE");
startInfo.ArgumentList.Add("--cli");
foreach (var arg in childArgs)
{
    startInfo.ArgumentList.Add(arg);
}

try
{
    using var child = Process.Start(startInfo);
    if (child is null)
    {
        WriteJsonError("spawn_failed", "ARR Ops.exe konnte nicht gestartet werden.", "Pruefe, ob die App vollstaendig entpackt wurde.");
        return 1;
    }

    child.WaitForExit();
    return child.ExitCode;
}
catch (Exception ex)
{
    WriteJsonError("spawn_failed", ex.Message, "Pruefe, ob ARR Ops.exe im selben Ordner vorhanden und ausfuehrbar ist.");
    return 1;
}

static void WriteJsonError(string code, string message, string hint)
{
    Console.WriteLine(
        "{\"ok\":false,\"hint\":\"" + JsonEscape(hint) +
        "\",\"error\":{\"message\":\"" + JsonEscape(message) +
        "\",\"code\":\"" + JsonEscape(code) + "\"}}");
}

static string JsonEscape(string value)
{
    var builder = new StringBuilder(value.Length + 8);
    foreach (var ch in value)
    {
        switch (ch)
        {
            case '\\':
                builder.Append(@"\\");
                break;
            case '"':
                builder.Append("\\\"");
                break;
            case '\b':
                builder.Append(@"\b");
                break;
            case '\f':
                builder.Append(@"\f");
                break;
            case '\n':
                builder.Append(@"\n");
                break;
            case '\r':
                builder.Append(@"\r");
                break;
            case '\t':
                builder.Append(@"\t");
                break;
            default:
                if (ch < 0x20)
                {
                    builder.Append("\\u");
                    builder.Append(((int)ch).ToString("x4"));
                }
                else
                {
                    builder.Append(ch);
                }
                break;
        }
    }

    return builder.ToString();
}
