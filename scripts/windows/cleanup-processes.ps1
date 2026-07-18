param(
  [Parameter(Mandatory = $true)]
  [string]$AppExecutable,

  [Parameter(Mandatory = $true)]
  [string]$BackendExecutable
)

$ErrorActionPreference = "Stop"

function Normalize-ExecutablePath {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }
  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
}

$appPath = Normalize-ExecutablePath -Path $AppExecutable
$backendPath = Normalize-ExecutablePath -Path $BackendExecutable

Get-CimInstance Win32_Process |
  Where-Object {
    $path = Normalize-ExecutablePath -Path ([string]$_.ExecutablePath)
    $path -eq $appPath -or $path -eq $backendPath
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
