$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$nodePath = Join-Path $packageRoot "node\node.exe"
$serverEntry = Join-Path $packageRoot "app\server-bootstrap.cjs"
$speechRoot = Join-Path $packageRoot "offline-speech"
$whisperCli = Join-Path $speechRoot "bin\whisper-cli.exe"
$whisperServer = Join-Path $speechRoot "bin\whisper-server.exe"
$smallModel = Join-Path $speechRoot "models\ggml-small-q5_1.bin"
$vadModel = Join-Path $speechRoot "models\ggml-silero-v6.2.0.bin"
$modelDirectory = Join-Path $speechRoot "models"
$origin = "http://127.0.0.1:3211"
$stateRoot = Join-Path $env:LOCALAPPDATA "Service Ears"
$logRoot = Join-Path $stateRoot "logs"
$pidPath = Join-Path $stateRoot "portable-server.pid"
$stdoutPath = Join-Path $logRoot "portable-server.stdout.log"
$stderrPath = Join-Path $logRoot "portable-server.stderr.log"

function Test-ServiceEarsHealth {
  try {
    $health = Invoke-RestMethod -Uri "$origin/api/health" -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Open-ServiceEars {
  if ($env:SERVICE_EARS_NO_BROWSER -eq "1") {
    return
  }
  $edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  if ($edgeCandidates.Count -gt 0) {
    Start-Process -FilePath $edgeCandidates[0] -ArgumentList $origin | Out-Null
  } else {
    Start-Process $origin | Out-Null
  }
}

try {
  $required = @($nodePath, $serverEntry, $whisperCli, $smallModel, $vadModel)
  $missing = $required | Where-Object { -not (Test-Path -LiteralPath $_) }
  if ($missing.Count -gt 0) {
    throw "Het Service Ears 3.5-pakket is onvolledig. Ontbrekend: $($missing -join ', ')"
  }

  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

  if (Test-ServiceEarsHealth) {
    Open-ServiceEars
    exit 0
  }

  if (Test-Path -LiteralPath $pidPath) {
    $previousPid = [int](Get-Content -LiteralPath $pidPath -Raw)
    $previous = Get-Process -Id $previousPid -ErrorAction SilentlyContinue
    if ($previous -and $previous.Path -eq $nodePath) {
      Stop-Process -Id $previousPid -Force
      $previous.WaitForExit(5000)
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  }

  $portOwner = Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portOwner) {
    throw "Poort 3211 wordt door een andere toepassing gebruikt. Sluit die toepassing en start Service Ears opnieuw."
  }

  $runtimeEnvironment = @{
    HOSTNAME = "127.0.0.1"
    PORT = "3211"
    NODE_PATH = (Join-Path $packageRoot "app\runtime_modules")
    POS_ADAPTER = "mock"
    ORDER_ENGINE_MODE = "deterministic"
    DEBUG_RETAIN_CONVERSATION = "false"
    OPENAI_API_KEY = ""
    LOCAL_WHISPER_CLI = $whisperCli
    LOCAL_WHISPER_SERVER = $(if (Test-Path -LiteralPath $whisperServer) { $whisperServer } else { "" })
    LOCAL_WHISPER_MODEL = $smallModel
    LOCAL_WHISPER_MODELS_DIRS = $modelDirectory
    LOCAL_WHISPER_VAD_MODEL = $vadModel
    LOCAL_WHISPER_MODEL_POLICY = "adaptive"
    LOCAL_WHISPER_MAX_THREADS = "6"
    LOCAL_WHISPER_TARGET_LATENCY_MS = "30000"
    LOCAL_WHISPER_IDLE_UNLOAD_MS = "180000"
    LOCAL_WHISPER_BACKEND = "CPU/BLAS"
  }
  foreach ($entry in $runtimeEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }

  # Start-Process joins ArgumentList values without adding quotes. Keep the
  # entry point intact when Service Ears is installed below a path with spaces.
  $serverArgument = '"' + $serverEntry + '"'
  $server = Start-Process -FilePath $nodePath `
    -ArgumentList $serverArgument `
    -WorkingDirectory (Join-Path $packageRoot "app") `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Set-Content -LiteralPath $pidPath -Value $server.Id -Encoding ascii

  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while ([DateTime]::UtcNow -lt $deadline) {
    $server.Refresh()
    if ($server.HasExited) {
      $details = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 20) -join " " } else { "geen foutlog" }
      throw "De lokale server stopte tijdens het starten met code $($server.ExitCode): $details"
    }
    if (Test-ServiceEarsHealth) {
      Open-ServiceEars
      exit 0
    }
    Start-Sleep -Milliseconds 300
  }
  throw "De lokale appserver werd niet binnen 120 seconden gezond. Controleer $stderrPath."
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
