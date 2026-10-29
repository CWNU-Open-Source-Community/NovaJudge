# NovaJudge native Windows submit
# Windows PowerShell 5.1+. Credentials and source never enter process arguments.
$ErrorActionPreference = "Stop"
$ClientVersion = "2026.10.29.1"
$ConfigPath = Join-Path $env:USERPROFILE ".novajudge-submit.json"
$DefaultsPath = Join-Path $PSScriptRoot "submit-defaults.json"
$Utf8 = New-Object System.Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$script:HttpClient = $null

function Read-Text($Path) {
  try { $Text = $Utf8.GetString([IO.File]::ReadAllBytes($Path)) }
  catch { throw "Cannot read UTF-8 text from: $Path" }
  return $Text.TrimStart([char]0xfeff)
}

function Read-JsonFile($Path) {
  if (!(Test-Path -LiteralPath $Path)) { return [pscustomobject]@{} }
  try {
    $Json = Read-Text $Path
    if (!$Json.TrimStart().StartsWith("{")) { throw "Not a JSON object" }
    $Value = ConvertFrom-Json -InputObject $Json
  }
  catch { throw "Invalid JSON file: $Path" }
  if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw "Expected a JSON object in: $Path" }
  return $Value
}

function Protect-ConfigFile($Path) {
  $Item = Get-Item -LiteralPath $Path -Force
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to write device authorization through a link: $Path"
  }
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $Acl = New-Object Security.AccessControl.FileSecurity
  $Acl.SetOwner($Identity)
  $Acl.SetAccessRuleProtection($true, $false)
  $Rule = New-Object Security.AccessControl.FileSystemAccessRule($Identity, "FullControl", "Allow")
  $Acl.AddAccessRule($Rule)
  # Avoid module auto-loading: launching Windows PowerShell from PowerShell 7 can
  # inherit a PSModulePath containing incompatible Security module versions.
  if ($PSVersionTable.PSVersion.Major -le 5) { [IO.File]::SetAccessControl($Path, $Acl) }
  else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$Path, $Acl) }
}

function Write-Config($Config) {
  # Protect an empty file before writing the grant, then replace the old grant atomically.
  $Temporary = Join-Path (Split-Path -Parent $ConfigPath) (".novajudge-submit-" + [Guid]::NewGuid().ToString("N") + ".tmp")
  try {
    $Stream = [IO.File]::Open($Temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $Stream.Dispose()
    Protect-ConfigFile $Temporary
    [IO.File]::WriteAllText($Temporary, (($Config | ConvertTo-Json -Depth 16) + "`n"), $Utf8)
    if (Test-Path -LiteralPath $ConfigPath) {
      Protect-ConfigFile $ConfigPath
      [IO.File]::Replace($Temporary, $ConfigPath, [NullString]::Value)
    } else { [IO.File]::Move($Temporary, $ConfigPath) }
  } finally {
    if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force }
  }
}

function Normalize-Url($Value) {
  $Result = ([string]$Value).Trim().TrimEnd('/')
  $Uri = $null
  if ($Result -match '[\s\\?#]' -or ![Uri]::TryCreate($Result, [UriKind]::Absolute, [ref]$Uri) -or
      $Uri.Scheme -notin @("http", "https") -or !$Uri.Host -or $Uri.UserInfo) {
    throw "Server URL must be an http:// or https:// URL without credentials, query or fragment."
  }
  return $Result
}

function Get-DefaultUrl($Flags, $Config) {
  if ($Flags.url) { return Normalize-Url $Flags.url }
  if ($env:NOVAJUDGE_URL) { return Normalize-Url $env:NOVAJUDGE_URL }
  if ($Config.baseUrl) { return Normalize-Url $Config.baseUrl }
  $Defaults = Read-JsonFile $DefaultsPath
  if ($Defaults.baseUrl) { return Normalize-Url $Defaults.baseUrl }
  if ($Defaults.url) { return Normalize-Url $Defaults.url }
  throw "No server URL configured. Install submit from your intranet contest site's /cli page, or run submit login --url <server>."
}

function Parse-Options($Arguments, $Allowed) {
  $Flags = @{}
  $Rest = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $Argument = [string]$Arguments[$i]
    if ($Argument -eq "--") {
      for ($j = $i + 1; $j -lt $Arguments.Count; $j++) { $Rest.Add([string]$Arguments[$j]) }
      break
    }
    if (!$Argument.StartsWith("-")) { $Rest.Add($Argument); continue }
    if ($Argument -cnotmatch '^--([^=]+)(?:=(.*))?$' -or $Matches[1] -cnotin $Allowed) {
      throw "Unknown option: $Argument. Run submit --help."
    }
    $Key = $Matches[1]
    $InlineValue = $Matches.ContainsKey(2)
    $Value = $Matches[2]
    if ($Flags.ContainsKey($Key)) { throw "Repeated option: --$Key" }
    if (!$InlineValue) { $i++; $Value = $Arguments[$i] }
    if (!$Value -or ([string]$Value).StartsWith("--")) { throw "Missing value for --$Key." }
    $Flags[$Key] = [string]$Value
  }
  return @{ flags = $Flags; rest = $Rest.ToArray() }
}

function Invoke-Api($BaseUrl, $Method, $Endpoint, $Payload, $Config) {
  if ($null -eq $script:HttpClient) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $Handler = New-Object Net.Http.HttpClientHandler
    $Handler.AllowAutoRedirect = $false
    $Handler.UseCookies = $false
    $script:HttpClient = New-Object Net.Http.HttpClient($Handler)
    $script:HttpClient.Timeout = [TimeSpan]::FromSeconds(30)
    $script:HttpClient.MaxResponseContentBufferSize = 10485760
  }
  $Address = (Normalize-Url $BaseUrl) + $Endpoint
  $Request = New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod($Method)), $Address)
  $Response = $null
  try {
    if ($Config) {
      $Token = [string]$Config.deviceToken
      if ($Token -cnotmatch '^njcli_[A-Za-z0-9_-]+$') { throw "Invalid saved device authorization. Reconnect through the original login method." }
      $Request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue("Bearer", $Token)
    }
    if ($null -ne $Payload) {
      $Json = ConvertTo-Json -InputObject $Payload -Compress -Depth 16
      $Request.Content = New-Object Net.Http.StringContent($Json, $Utf8, "application/json")
    }
    try { $Response = $script:HttpClient.SendAsync($Request).GetAwaiter().GetResult() }
    catch { throw "Cannot reach $BaseUrl. Check the network and server address (request timeout: 30 seconds)." }
    $Status = [int]$Response.StatusCode
    $Text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    try {
      if ($Text -and !$Text.TrimStart().StartsWith("{")) { throw "Not a JSON object" }
      $Data = if ($Text) { ConvertFrom-Json -InputObject $Text } else { [pscustomobject]@{} }
    }
    catch { throw "Server returned HTTP $Status with a non-JSON response. Check the server URL." }
    if ($null -eq $Data -or $Data -isnot [pscustomobject]) { throw "Invalid server response (HTTP $Status)." }
    return @{ status = $Status; ok = $Response.IsSuccessStatusCode; data = $Data }
  } finally {
    if ($Response) { $Response.Dispose() }
    $Request.Dispose()
  }
}

function Get-ResponseError($Result, $Prefix) {
  $Message = if ($Result.data.error) { [string]$Result.data.error } else { "HTTP $($Result.status)" }
  return "$Prefix`: $Message"
}

function Test-Proctoring($Config, $State) {
  return ($Config.loginSource -eq "PROCTORING" -or $State.loginSource -eq "PROCTORING")
}

function Get-StateMessage($State, $Config) {
  if ($State.code -eq "CLI_DISABLED") { return "The administrator has not enabled a current contest for submit. Contact the administrator." }
  if (Test-Proctoring $Config $State) { return "This submit authorization is managed by the monitoring client. Reconnect through the monitoring client to restore submission access." }
  if ($State.status -eq "expired") { return "Browser authorization expired. Run submit again to reconnect." }
  if ($State.status -eq "contest_changed") { return "The current contest changed. Run submit again to reconnect in the browser." }
  if ($State.code -eq "REAUTH_REQUIRED") { return "This team needs new browser authorization. Run submit again to reconnect." }
  if ($State.error) { return [string]$State.error }
  return "Command-line submission is disabled. Contact the administrator."
}

function Get-VerificationUrl($Config) {
  $Code = [string]$Config.userCode
  if ($Code -cnotmatch '^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$' -or
      $Config.verificationPath -cne ("/cli/connect?code=" + [Uri]::EscapeDataString($Code))) {
    throw "Server returned an invalid browser verification path."
  }
  return (Normalize-Url $Config.baseUrl) + $Config.verificationPath
}

function Get-DeviceState($Config) {
  $Result = Invoke-Api $Config.baseUrl "GET" "/api/cli/device" $null $Config
  if ($Result.status -eq 401) { return [pscustomobject]@{ status = "expired" } }
  if (!$Result.ok -and (Test-Proctoring $Config $Result.data)) { throw (Get-StateMessage $Result.data $Config) }
  if (!$Result.ok) { throw (Get-ResponseError $Result "Cannot check authorization") }
  if ($Result.data.status -cnotin @("pending", "ready", "expired", "contest_changed", "disabled")) {
    throw "Server returned an invalid authorization status."
  }
  return $Result.data
}

function Test-PositiveInteger($Value) {
  return (($Value -is [int] -or $Value -is [long]) -and $Value -gt 0 -and $Value -le 9007199254740991)
}

function Save-Ready($Config, $State) {
  if (!$State.contest -or !(Test-PositiveInteger $State.contest.id) -or
      !$State.user -or $State.user.username -isnot [string] -or !$State.user.username) {
    throw "Server authorization is missing the contest or team."
  }
  $Config | Add-Member -NotePropertyName contest -NotePropertyValue $State.contest -Force
  $Config | Add-Member -NotePropertyName user -NotePropertyValue $State.user -Force
  if ($State.loginSource -cin @("PROCTORING", "BROWSER")) {
    $Config | Add-Member -NotePropertyName loginSource -NotePropertyValue $State.loginSource -Force
  }
  if ($State.expiresAt) { $Config | Add-Member -NotePropertyName expiresAt -NotePropertyValue $State.expiresAt -Force }
  Write-Config $Config
  return $Config
}

function Show-Binding($Config) {
  Write-Host "Contest: #$($Config.contest.id) $($Config.contest.title)"
  $TeamName = if ($Config.user.displayName) { $Config.user.displayName } else { $Config.user.username }
  Write-Host "Team: $TeamName ($($Config.user.username))"
}

function Get-Expiration($Value) {
  $Expiration = [DateTimeOffset]::MinValue
  if (![DateTimeOffset]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None, [ref]$Expiration)) {
    throw "Server returned an invalid pairing expiration time."
  }
  return $Expiration
}

function Wait-Authorization($Config) {
  $Url = Get-VerificationUrl $Config
  $Deadline = Get-Expiration $Config.expiresAt
  $Maximum = [DateTimeOffset]::UtcNow.AddMinutes(10)
  if ($Deadline -gt $Maximum) { $Deadline = $Maximum }
  $Interval = 2.0
  $ParsedInterval = 0.0
  if ([double]::TryParse([string]$Config.pollInterval, [ref]$ParsedInterval) -and ![double]::IsNaN($ParsedInterval)) {
    $Interval = [Math]::Max(2, [Math]::Min(10, $ParsedInterval))
  }
  Write-Host "Sign in to your team in the browser to connect this computer."
  Write-Host "Pairing code: $($Config.userCode)"
  Write-Host "Open: $Url"
  if ($env:NOVAJUDGE_NO_BROWSER -ne "1") {
    try { Start-Process -FilePath $Url -WindowStyle Hidden }
    catch { [Console]::Error.WriteLine("Could not open the browser. Open the URL above manually.") }
  }
  Write-Host "Waiting for browser authorization... (Ctrl+C to cancel)"
  while ($true) {
    $State = Get-DeviceState $Config
    if ($State.status -eq "ready") {
      $Config = Save-Ready $Config $State
      Write-Host "Browser authorization complete."
      return $Config
    }
    if ($State.status -ne "pending") { throw (Get-StateMessage $State $Config) }
    $Remaining = ($Deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds
    if ($Remaining -le 0) { throw "Pairing code expired. Run submit again to get a new code." }
    Start-Sleep -Milliseconds ([int][Math]::Min($Interval * 1000, $Remaining))
  }
}

function Connect-Device($BaseUrl) {
  $Result = Invoke-Api $BaseUrl "POST" "/api/cli/device" @{} $null
  if (!$Result.ok) { throw (Get-ResponseError $Result "Cannot start browser authorization") }
  $Value = $Result.data
  if ($Value.deviceToken -isnot [string] -or $Value.deviceToken -cnotmatch '^njcli_[A-Za-z0-9_-]+$') {
    throw "Server returned an invalid device authorization."
  }
  $Config = [pscustomobject]@{
    baseUrl = $BaseUrl; deviceToken = $Value.deviceToken; userCode = $Value.userCode
    verificationPath = $Value.verificationPath; expiresAt = $Value.expiresAt
    pollInterval = $Value.pollInterval; contest = $Value.contest
  }
  $null = Get-VerificationUrl $Config
  $null = Get-Expiration $Config.expiresAt
  Write-Config $Config
  return Wait-Authorization $Config
}

function Get-BoundDevice {
  $Config = Read-JsonFile $ConfigPath
  if (!$Config.deviceToken -or !$Config.baseUrl) {
    if (Test-Proctoring $Config $null) { throw (Get-StateMessage $null $Config) }
    return Connect-Device (Get-DefaultUrl @{} $Config)
  }
  $State = Get-DeviceState $Config
  if ($State.status -eq "ready") { return Save-Ready $Config $State }
  if (Test-Proctoring $Config $State) { throw (Get-StateMessage $State $Config) }
  if ($State.status -eq "pending" -and (Get-Expiration $Config.expiresAt) -gt [DateTimeOffset]::UtcNow) {
    return Wait-Authorization $Config
  }
  if ($State.status -in @("expired", "contest_changed", "pending") -or $State.code -eq "REAUTH_REQUIRED") {
    Write-Host (Get-StateMessage $State $Config)
    return Connect-Device (Normalize-Url $Config.baseUrl)
  }
  throw (Get-StateMessage $State $Config)
}

function Confirm-Submission($Config, $FileName, $Problem, $Language) {
  Write-Host "`nSubmission information:"
  Write-Host "Server: $($Config.baseUrl)"
  Show-Binding $Config
  Write-Host "File: $FileName"
  Write-Host "Problem: $Problem"
  Write-Host "Language: $Language"
  while ($true) {
    [Console]::Write("Submit this file? [y/N] ")
    # ReadLine accepts a trailing "y" at EOF. Require Enter before accepting any
    # answer, matching the macOS client and preventing a truncated pipe from submitting.
    $Line = New-Object Text.StringBuilder
    while ($true) {
      $Character = [Console]::Read()
      if ($Character -eq -1) {
        Write-Host "Cancelled. Nothing was submitted."
        return $false
      }
      if ($Character -eq 10) { break }
      [void]$Line.Append([char]$Character)
    }
    $Answer = $Line.ToString().Trim()
    if ($Answer -eq "" -or $Answer -ieq "n") {
      Write-Host "Cancelled. Nothing was submitted."
      return $false
    }
    if ($Answer -ieq "y") { return $true }
    Write-Host "Please enter y or n."
  }
}

function Send-Submission($Arguments) {
  $Parsed = Parse-Options $Arguments @("problem", "language")
  if ($Parsed.rest.Count -ne 1) { throw "Provide exactly one source file, for example: submit A.cpp" }
  $FileName = $Parsed.rest[0]
  if (!(Test-Path -LiteralPath $FileName -PathType Leaf)) { throw "Source file not found: $FileName" }
  $Extension = [IO.Path]::GetExtension($FileName).ToLowerInvariant()
  $Inferred = ""
  if ([IO.Path]::GetFileNameWithoutExtension($FileName) -match '^([A-Za-z][A-Za-z0-9_-]*)') { $Inferred = $Matches[1] }
  $Problem = if ($Parsed.flags.problem) { $Parsed.flags.problem } else { $Inferred }
  $Problem = ([string]$Problem).Trim().ToUpperInvariant()
  $Languages = @{ ".c" = "c"; ".cc" = "cpp"; ".cpp" = "cpp"; ".cxx" = "cpp"; ".java" = "java"; ".py" = "pypy3"; ".py3" = "pypy3" }
  $Language = if ($Parsed.flags.language) { $Parsed.flags.language } else { $Languages[$Extension] }
  $Language = ([string]$Language).Trim()
  if (!$Problem) { throw "Cannot infer problem. Use: submit --problem A main.cpp" }
  if (!$Language) { throw "Cannot infer language. Use: submit --language cpp A.txt" }
  $Code = Read-Text $FileName
  if (!$Code.Trim()) { throw "Source file is empty: $FileName" }
  $Config = Get-BoundDevice
  if (!(Confirm-Submission $Config $FileName $Problem $Language)) { return }
  $Payload = @{ problem = $Problem; language = $Language; code = $Code }
  $Result = Invoke-Api $Config.baseUrl "POST" "/api/cli/device/submit" $Payload $Config
  if (!$Result.ok -and (Test-Proctoring $Config $null) -and ($Result.status -eq 401 -or
      $Result.data.code -in @("CONTEST_CHANGED", "REAUTH_REQUIRED", "DEVICE_EXPIRED", "INVALID_DEVICE_TOKEN", "PAIRING_REQUIRED", "CLI_DISABLED"))) {
    throw (Get-StateMessage $Result.data $Config)
  }
  if ($Result.status -eq 401 -or $Result.data.code -in @("CONTEST_CHANGED", "REAUTH_REQUIRED")) {
    Write-Host "Browser authorization must be renewed before submitting."
    $Config = Connect-Device (Normalize-Url $Config.baseUrl)
    if (!(Confirm-Submission $Config $FileName $Problem $Language)) { return }
    $Result = Invoke-Api $Config.baseUrl "POST" "/api/cli/device/submit" $Payload $Config
  }
  if (!$Result.ok) { throw (Get-ResponseError $Result "Submit failed") }
  if (!$Result.data.submission -or !(Test-PositiveInteger $Result.data.submission.displayId)) {
    throw "Server accepted the request but returned no contest submission number. Check the contest page before submitting again."
  }
  $DisplayId = $Result.data.submission.displayId
  Write-Host "Submitted #$DisplayId $Problem $Language"
  Write-Host ((Normalize-Url $Config.baseUrl) + "/contest/$($Config.contest.id)/status/$DisplayId")
}

function Show-Status {
  $Config = Read-JsonFile $ConfigPath
  if (!$Config.deviceToken -or !$Config.baseUrl) {
    if (Test-Proctoring $Config $null) { Write-Host (Get-StateMessage $null $Config) }
    else { Write-Host "Not connected. Run submit A.cpp to connect in the browser." }
    return
  }
  $State = Get-DeviceState $Config
  Write-Host "Server: $($Config.baseUrl)"
  Write-Host "Authorization: $($State.status)"
  if ($State.status -eq "ready") { $Config = Save-Ready $Config $State }
  $Source = if (Test-Proctoring $Config $State) { "monitoring client" } else { "browser" }
  Write-Host "Authorization source: $Source"
  if ($State.status -eq "ready") { Show-Binding $Config }
  elseif (Test-Proctoring $Config $State) { Write-Host (Get-StateMessage $State $Config) }
  elseif ($State.status -eq "pending") { Write-Host ("Complete browser authorization: " + (Get-VerificationUrl $Config)) }
  else { Write-Host (Get-StateMessage $State $Config) }
}

function Disconnect-Device {
  try {
    $Config = Read-JsonFile $ConfigPath
    if ($Config.deviceToken -and $Config.baseUrl) {
      $Result = Invoke-Api $Config.baseUrl "DELETE" "/api/cli/device" $null $Config
      if (!$Result.ok -and $Result.status -ne 401) { throw (Get-ResponseError $Result "Cannot revoke device authorization") }
    }
  } catch {
    [Console]::Error.WriteLine("Warning: " + $_.Exception.Message + " The saved authorization will still be removed locally.")
  }
  if (Test-Path -LiteralPath $ConfigPath) { Remove-Item -LiteralPath $ConfigPath -Force }
  Write-Host "Logged out. Saved device authorization removed."
}

function Show-Usage {
  Write-Host @"
NovaJudge submit - native Windows client

Usage:
  submit A.cpp
  submit --problem A main.cpp
  submit --language cpp A.txt
  submit login [--url <server>]
  submit status
  submit logout
  submit version

Your first submission opens a browser to sign in to your team and connect this computer.
The administrator selects the current contest. Later submissions reuse your browser authorization.
When the monitoring client connects submit automatically, manage its authorization in that client.
Review the submission information and enter y to submit; n or Enter cancels.
No contest ID, username or password is entered in the terminal.
NOVAJUDGE_URL overrides the installed default server for login; --url has priority.
NOVAJUDGE_NO_BROWSER=1 prints the verification URL without opening the browser automatically.
Saved device authorization: $ConfigPath
"@
}

try {
  $Arguments = @($args)
  if ($Arguments.Count -eq 0 -or $Arguments -contains "--help" -or $Arguments -contains "-h" -or $Arguments[0] -eq "help") {
    Show-Usage
  } elseif ($Arguments[0] -eq "login") {
    $Parsed = Parse-Options @($Arguments | Select-Object -Skip 1) @("url")
    if ($Parsed.rest.Count) { throw "Unexpected login argument: $($Parsed.rest[0])" }
    $Current = Read-JsonFile $ConfigPath
    if (Test-Proctoring $Current $null) { throw (Get-StateMessage $null $Current) }
    $Config = Connect-Device (Get-DefaultUrl $Parsed.flags $Current)
    Show-Binding $Config
  } elseif ($Arguments[0] -in @("status", "logout", "version")) {
    if ($Arguments.Count -ne 1) { throw "Unexpected argument: $($Arguments[1])" }
    switch ($Arguments[0]) {
      "status" { Show-Status }
      "logout" { Disconnect-Device }
      "version" { Write-Host "NovaJudge submit client $ClientVersion (native Windows)" }
    }
  } else { Send-Submission $Arguments }
} catch {
  [Console]::Error.WriteLine("submit: " + $_.Exception.Message)
  exit 1
} finally {
  if ($script:HttpClient) { $script:HttpClient.Dispose() }
}
