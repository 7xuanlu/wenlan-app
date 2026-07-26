param(
  [Parameter(Mandatory = $true)]
  [string]$AppExecutable,

  [Parameter(Mandatory = $true)]
  [string]$BackendExecutable,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Normalize-ExecutablePath {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }
  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
}

function Get-LoadedModulePaths {
  param([int]$ProcessId)
  try {
    return @(
      (Get-Process -Id $ProcessId -ErrorAction Stop).Modules |
        ForEach-Object { $_.FileName }
    )
  }
  catch {
    return @()
  }
}

function Convert-Process {
  param(
    [object]$Process,
    [bool]$IncludeModules
  )

  $modules = @()
  if ($IncludeModules) {
    $modules = @(Get-LoadedModulePaths -ProcessId ([int]$Process.ProcessId))
  }

  return [ordered]@{
    pid = [int]$Process.ProcessId
    parent_pid = [int]$Process.ParentProcessId
    executable_path = [string]$Process.ExecutablePath
    command_line = [string]$Process.CommandLine
    loaded_modules = $modules
  }
}

$appPath = Normalize-ExecutablePath -Path $AppExecutable
$backendPath = Normalize-ExecutablePath -Path $BackendExecutable
$all = @(Get-CimInstance Win32_Process)

$apps = @(
  $all |
    Where-Object {
      (Normalize-ExecutablePath -Path ([string]$_.ExecutablePath)) -eq $appPath
    } |
    ForEach-Object { Convert-Process -Process $_ -IncludeModules $false }
)

$backends = @(
  $all |
    Where-Object {
      (Normalize-ExecutablePath -Path ([string]$_.ExecutablePath)) -eq $backendPath
    } |
    ForEach-Object { Convert-Process -Process $_ -IncludeModules $true }
)

$result = [ordered]@{
  captured_at = [DateTimeOffset]::UtcNow.ToString("o")
  app_executable = $AppExecutable
  backend_executable = $BackendExecutable
  app = $apps
  backend = $backends
}

$parent = Split-Path -Parent $OutputPath
if ($parent) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}
$result | ConvertTo-Json -Depth 6 | Set-Content -Path $OutputPath -Encoding UTF8
