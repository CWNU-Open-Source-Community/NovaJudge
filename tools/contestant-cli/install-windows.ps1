#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Url,
  [string]$SourceDir,
  [switch]$Uninstall,
  [switch]$NoPathUpdate
)

$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Marker = 'NovaJudge Windows submit installation v1'
$Files = @('submit.ps1', 'submit.cmd', 'submit.bat')
$OwnedFiles = $Files + @('novajudge-submit.ps1', 'submit-defaults.json', '.install-marker')
$Stage = $null
$Backup = $null

function Assert-SafePath([string]$Path) {
  $Full = [IO.Path]::GetFullPath($Path)
  if (!$Full.StartsWith($InstallParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Installation path is outside the NovaJudge directory: $Full"
  }
  $Cursor = $Full
  while ($Cursor) {
    if (Test-Path -LiteralPath $Cursor) {
      if ((Get-Item -LiteralPath $Cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing a linked installation path: $Cursor"
      }
    }
    $Cursor = [IO.Path]::GetDirectoryName($Cursor)
  }
}

function Read-Installation {
  if (!(Test-Path -LiteralPath $InstallDir)) { return $null }
  Assert-SafePath $InstallDir
  $MarkerFile = Join-Path $InstallDir '.install-marker'
  if (!(Test-Path -LiteralPath $MarkerFile -PathType Leaf)) {
    throw "Refusing to change an unrecognized directory: $InstallDir"
  }
  $Info = [IO.File]::ReadAllText($MarkerFile, $Utf8) | ConvertFrom-Json
  if ($Info.marker -ne $Marker) { throw "Unrecognized installation marker: $InstallDir" }
  foreach ($Entry in Get-ChildItem -LiteralPath $InstallDir -Force) {
    if ($Entry.PSIsContainer -or ($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $Entry.Name -notin $OwnedFiles) {
      throw "Unexpected file in installation; preserve it before updating or removing: $($Entry.FullName)"
    }
  }
  return $Info
}

function Remove-InstallationDirectory([string]$Path) {
  Assert-SafePath $Path
  # Only known files are ever deleted, and only inside the validated installation parent.
  foreach ($Entry in Get-ChildItem -LiteralPath $Path -Force) {
    if ($Entry.PSIsContainer -or ($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $Entry.Name -notin $OwnedFiles) {
      throw "Refusing to delete an unexpected installation entry: $($Entry.FullName)"
    }
  }
  foreach ($Entry in Get-ChildItem -LiteralPath $Path -Force) { Remove-Item -LiteralPath $Entry.FullName -Force }
  Remove-Item -LiteralPath $Path -Force
}

function Is-InstallPath([string]$Value) {
  $Expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"')).TrimEnd('\', '/')
  return $Expanded -eq $InstallDir.TrimEnd('\', '/')
}

function Broadcast-Environment {
  try {
    if (!('NovaJudge.EnvironmentNotification' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NovaJudge {
  public static class EnvironmentNotification {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam,
      string lParam, uint flags, uint timeout, out UIntPtr result);
  }
}
'@
    }
    $Result = [UIntPtr]::Zero
    [void][NovaJudge.EnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$Result)
  } catch { Write-Warning 'PATH was saved. Reopen your terminal application to load it.' }
}

try {
  if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows only.' }
  if (!$env:LOCALAPPDATA -or ![IO.Path]::IsPathRooted($env:LOCALAPPDATA)) { throw 'A local application data directory is required.' }
  $InstallParent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NovaJudge')).TrimEnd('\')
  $InstallDir = Join-Path $InstallParent 'submit'
  Assert-SafePath $InstallDir
  $Previous = Read-Installation
  $UserPath = ''
  $Registry = $null
  if (!$NoPathUpdate) {
    $Registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    $UserPath = [string]$Registry.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  }

  if ($Uninstall) {
    if ($Url -or $SourceDir) { throw 'Use -Url and -SourceDir for installation, not removal.' }
    if ($Previous) {
      if (!$NoPathUpdate -and $Previous.pathAdded) {
        $NewPath = (@($UserPath -split ';' | Where-Object { !(Is-InstallPath $_) }) -join ';')
        $Registry.SetValue('Path', $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        $env:Path = (@($env:Path -split ';' | Where-Object { !(Is-InstallPath $_) }) -join ';')
        Broadcast-Environment
      }
      Remove-InstallationDirectory $InstallDir
    }
    Write-Host 'NovaJudge submit uninstalled. Device authorization was kept; run submit logout before uninstalling to revoke it.'
    exit 0
  }

  $Url = $Url.Trim().TrimEnd('/')
  $ParsedUrl = $null
  if (!$Url -or ![Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$ParsedUrl) -or
      $ParsedUrl.Scheme -notin @('http', 'https') -or !$ParsedUrl.Host -or
      $ParsedUrl.UserInfo -or $ParsedUrl.Query -or $ParsedUrl.Fragment -or $Url -match '[\s\\]') {
    throw 'Pass -Url with an http(s) server URL without credentials, query or fragment.'
  }
  if ($SourceDir -and !(Test-Path -LiteralPath $SourceDir -PathType Container)) { throw 'SourceDir must contain the bundled Windows submit files.' }
  [void][IO.Directory]::CreateDirectory($InstallParent)
  $Stage = Join-Path $InstallParent ('.submit-stage-' + [Guid]::NewGuid().ToString('N'))
  Assert-SafePath $Stage
  [void][IO.Directory]::CreateDirectory($Stage)
  foreach ($Name in $Files) {
    $Destination = Join-Path $Stage $Name
    if ($SourceDir) {
      $Source = Join-Path $SourceDir $Name
      if (!(Test-Path -LiteralPath $Source -PathType Leaf) -or ((Get-Item -LiteralPath $Source).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Bundled source must be a regular file: $Source"
      }
      Copy-Item -LiteralPath $Source -Destination $Destination
    } else {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/cli/download?platform=windows&file=$Name" -MaximumRedirection 0 -TimeoutSec 60 -OutFile $Destination
    }
  }
  $Client = Join-Path $Stage 'submit.ps1'
  $Contents = [IO.File]::ReadAllText($Client, $Utf8)
  if ($Contents -notmatch '(?m)^# NovaJudge native Windows submit\r?$') { throw 'The source is not the Windows submit client.' }
  $ParseTokens = $null; $ParseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($Client, [ref]$ParseTokens, [ref]$ParseErrors)
  if ($ParseErrors.Count -gt 0) { throw 'The Windows submit client has invalid PowerShell syntax.' }
  foreach ($Name in @('submit.cmd', 'submit.bat')) {
    $Launcher = [IO.File]::ReadAllText((Join-Path $Stage $Name), $Utf8)
    if ($Launcher -notmatch '(?i)powershell\.exe\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+"%~dp0submit\.ps1"\s+%\*') {
      throw "Invalid Windows submit launcher: $Name"
    }
    [IO.File]::WriteAllText((Join-Path $Stage $Name), $Launcher.Replace('%~dp0submit.ps1', '%~dp0novajudge-submit.ps1'), $Utf8)
  }
  # PowerShell resolves a same-named .ps1 before .cmd. Keep only the wrapper named
  # submit so normal execution policies do not block the command before it starts.
  Assert-SafePath $Client
  $InstalledClient = Join-Path $Stage 'novajudge-submit.ps1'
  Assert-SafePath $InstalledClient
  Move-Item -LiteralPath $Client -Destination $InstalledClient
  $PathExists = @($UserPath -split ';' | Where-Object { Is-InstallPath $_ }).Count -gt 0
  $PathAdded = (!$NoPathUpdate -and !$PathExists) -or ($Previous -and $Previous.pathAdded)
  [IO.File]::WriteAllText((Join-Path $Stage 'submit-defaults.json'), (@{ baseUrl = $Url } | ConvertTo-Json), $Utf8)
  [IO.File]::WriteAllText((Join-Path $Stage '.install-marker'), (@{ marker = $Marker; pathAdded = [bool]$PathAdded } | ConvertTo-Json), $Utf8)
  if ($Previous) {
    $Backup = Join-Path $InstallParent ('.submit-previous-' + [Guid]::NewGuid().ToString('N'))
    Assert-SafePath $InstallDir; Assert-SafePath $Backup
    Move-Item -LiteralPath $InstallDir -Destination $Backup
  }
  Assert-SafePath $Stage; Assert-SafePath $InstallDir
  Move-Item -LiteralPath $Stage -Destination $InstallDir
  $Stage = $null
  try {
    if (!$NoPathUpdate -and !$PathExists) {
      # Prefer this native client over an older npm/global submit in the user PATH.
      $NewPath = if ($UserPath) { $InstallDir + ';' + $UserPath } else { $InstallDir }
      $Registry.SetValue('Path', $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    }
  } catch {
    Remove-InstallationDirectory $InstallDir
    if ($Backup) { Assert-SafePath $Backup; Assert-SafePath $InstallDir; Move-Item -LiteralPath $Backup -Destination $InstallDir; $Backup = $null }
    throw
  }
  if ($Backup) { Remove-InstallationDirectory $Backup; $Backup = $null }
  if (!$NoPathUpdate) {
    if (!(@($env:Path -split ';' | Where-Object { Is-InstallPath $_ }).Count)) { $env:Path = "$InstallDir;$env:Path" }
    Broadcast-Environment
  }
  Write-Host "Installed: $InstallDir\submit.cmd"
  Write-Host "Server: $Url"
  Write-Host 'Reopen your terminal application, then run: submit A.cpp'
  Write-Host 'Existing terminals: add the installation directory to PATH, or run submit.cmd by its full path.'
  Write-Host 'The first submission opens browser pairing. Monitoring clients can bind the device automatically.'
} catch {
  [Console]::Error.WriteLine('Error: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($Stage -and (Test-Path -LiteralPath $Stage)) { Remove-InstallationDirectory $Stage }
  if ($Backup -and (Test-Path -LiteralPath $Backup) -and !(Test-Path -LiteralPath $InstallDir)) {
    Assert-SafePath $Backup; Assert-SafePath $InstallDir
    Move-Item -LiteralPath $Backup -Destination $InstallDir
  }
  if ($Registry) { $Registry.Dispose() }
}
