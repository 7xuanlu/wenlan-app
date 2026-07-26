[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DestinationPath
)

$ErrorActionPreference = "Stop"
Expand-Archive `
  -LiteralPath $ArchivePath `
  -DestinationPath $DestinationPath `
  -Force
