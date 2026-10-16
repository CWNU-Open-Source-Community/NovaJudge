$ErrorActionPreference = "Stop"

$ConfigPath = Join-Path $env:USERPROFILE ".novajudge-submit.json"
$DesktopCredentialPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "novajudge-submit.json"
$RequestTimeoutSec = 15
$ClientVersion = "2026.10.16.1"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Show-Usage {
  Write-Host "Usage:"
  Write-Host "  submit A.cpp"
  Write-Host "  submit --problem A main.cpp"
  Write-Host "  submit A.cpp -y"
  Write-Host "  submit status"
  Write-Host "  submit version"
  Write-Host ""
  Write-Host "Desktop credential file:"
  Write-Host "  $DesktopCredentialPath"
}

function Read-JsonFile($Path) {
  if (!(Test-Path -LiteralPath $Path)) {
    return $null
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-Config($Config) {
  [IO.File]::WriteAllText(
    $ConfigPath,
    ($Config | ConvertTo-Json -Depth 8),
    $Utf8NoBom
  )
}

function ConvertTo-SubmitJson($Value) {
  if ($null -eq $Value) {
    return "null"
  }

  if ($Value -is [bool]) {
    if ($Value) {
      return "true"
    }
    return "false"
  }

  if ($Value -is [byte] -or
      $Value -is [int16] -or
      $Value -is [int32] -or
      $Value -is [int64] -or
      $Value -is [single] -or
      $Value -is [double] -or
      $Value -is [decimal]) {
    return [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0}", $Value)
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $Pairs = New-Object System.Collections.Generic.List[string]
    foreach ($Key in $Value.Keys) {
      $JsonKey = ConvertTo-SubmitJson ([string]$Key)
      $JsonValue = ConvertTo-SubmitJson $Value[$Key]
      $Pairs.Add("$JsonKey`:$JsonValue")
    }
    return "{" + ($Pairs -join ",") + "}"
  }

  $StringValue = [string]$Value
  $StringValue = $StringValue.Replace("\", "\\")
  $StringValue = $StringValue.Replace('"', '\"')
  $StringValue = $StringValue.Replace("`r", "\r")
  $StringValue = $StringValue.Replace("`n", "\n")
  $StringValue = $StringValue.Replace("`t", "\t")
  return '"' + $StringValue + '"'
}

function Get-DesktopCredentials {
  $Credentials = Read-JsonFile $DesktopCredentialPath
  if ($null -eq $Credentials) {
    return $null
  }

  $BaseUrl = $Credentials.url
  if (!$BaseUrl) {
    $BaseUrl = $Credentials.baseUrl
  }
  if (!$BaseUrl) {
    $BaseUrl = "http://localhost:3001"
  }
  $BaseUrl = [string]$BaseUrl
  $BaseUrl = $BaseUrl.TrimEnd("/")

  $Username = [string]$Credentials.username
  if (!$Username) {
    $Username = [string]$Credentials.user
  }
  $Password = [string]$Credentials.password

  if (!$Username -or !$Password) {
    throw "Desktop credential file must contain username and password: $DesktopCredentialPath"
  }

  $ContestId = $null
  if ($null -ne $Credentials.contestId) {
    $ContestId = [int]$Credentials.contestId
  }

  return @{
    baseUrl = $BaseUrl
    contestId = $ContestId
    username = $Username
    password = $Password
    contestPassword = [string]$Credentials.contestPassword
  }
}

function Invoke-JsonPost($Url, $Body, $Headers) {
  Write-Host "Preparing request to $Url..."
  $JsonBody = ConvertTo-SubmitJson $Body
  Write-Host "Request body prepared."
  $Curl = Get-Command "curl.exe" -ErrorAction SilentlyContinue

  if ($Curl) {
    $RequestFile = [IO.Path]::GetTempFileName()
    $ResponseFile = [IO.Path]::GetTempFileName()
    $HeaderFile = [IO.Path]::GetTempFileName()
    $ErrorFile = [IO.Path]::GetTempFileName()
    try {
      [IO.File]::WriteAllText($RequestFile, $JsonBody, $Utf8NoBom)

      $CurlArgs = @(
        "-sS",
        "-X", "POST",
        "-H", "Content-Type: application/json"
      )

      foreach ($HeaderName in $Headers.Keys) {
        $CurlArgs += @("-H", "$HeaderName`: $($Headers[$HeaderName])")
      }

      $CurlArgs += @(
        "--data-binary", "@$RequestFile",
        "-o", $ResponseFile,
        "-w", "%{http_code}",
        "--stderr", $ErrorFile,
        $Url
      )

      $Process = New-Object System.Diagnostics.Process
      $Process.StartInfo.FileName = $Curl.Source
      $Process.StartInfo.Arguments = ($CurlArgs | ForEach-Object {
        $Arg = [string]$_
        if ($Arg -match '^[A-Za-z0-9_./:@%{}+=,-]+$') {
          $Arg
        } else {
          '"' + $Arg.Replace('\', '\\').Replace('"', '\"') + '"'
        }
      }) -join " "
      $Process.StartInfo.UseShellExecute = $false
      $Process.StartInfo.RedirectStandardOutput = $true
      $Process.StartInfo.CreateNoWindow = $true
      Write-Host "Sending request, timeout ${RequestTimeoutSec}s..."
      [void]$Process.Start()

      if (!$Process.WaitForExit($RequestTimeoutSec * 1000)) {
        try {
          $Process.Kill()
        } catch {}
        throw "Request timed out after $RequestTimeoutSec seconds: $Url"
      }

      Write-Host "Server responded."
      $HttpCodeText = $Process.StandardOutput.ReadToEnd()
      $ExitCode = $Process.ExitCode
      $ResponseText = ""
      if (Test-Path -LiteralPath $ResponseFile) {
        $ResponseText = [IO.File]::ReadAllText($ResponseFile, [Text.Encoding]::UTF8)
      }
      $ErrorText = ""
      if (Test-Path -LiteralPath $ErrorFile) {
        $ErrorText = [IO.File]::ReadAllText($ErrorFile, [Text.Encoding]::UTF8)
      }

      if ($ExitCode -ne 0) {
        throw "Network request failed with curl exit code $ExitCode`: $ErrorText"
      }

      $HttpCode = [int]$HttpCodeText
      $Data = $null
      if ($ResponseText) {
        try {
          $Data = $ResponseText | ConvertFrom-Json
        } catch {
          throw "Server returned non-JSON response: $ResponseText"
        }
      }

      if ($HttpCode -lt 200 -or $HttpCode -ge 300) {
        if ($Data -and $Data.error) {
          throw $Data.error
        }
        throw "Server returned HTTP $HttpCode`: $ResponseText"
      }

      return $Data
    } finally {
      Remove-Item -LiteralPath $RequestFile -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $ResponseFile -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $HeaderFile -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $ErrorFile -Force -ErrorAction SilentlyContinue
    }
  }

  throw "curl.exe not found. This submit client requires Windows curl.exe."
}

function Login-FromDesktop {
  $Credentials = Get-DesktopCredentials
  if ($null -eq $Credentials) {
    return $null
  }

  $BaseUrl = $Credentials.baseUrl
  $Data = Invoke-JsonPost `
    -Url "$BaseUrl/api/cli/login" `
    -Headers @{} `
    -Body @{
      username = $Credentials.username
      password = $Credentials.password
      contestPassword = $Credentials.contestPassword
      contestId = $Credentials.contestId
    }

  $Config = [ordered]@{
    baseUrl = $BaseUrl
    token = $Data.token
    contestAccessToken = $Data.contestAccessToken
    username = $Data.user.username
    teamName = $(if ($Data.user.displayName) { $Data.user.displayName } else { $Data.user.username })
    contestId = $Data.user.contestId
    contestTitle = $Data.contest.title
  }

  Write-Config $Config
  Write-Host "Auto logged in as $($Data.user.username) for contest #$($Data.user.contestId)"
  return [pscustomobject]$Config
}

function Get-ConfigOrLogin {
  $Config = Read-JsonFile $ConfigPath
  if ($null -ne $Config -and $Config.token -and $Config.baseUrl -and $Config.contestId) {
    return $Config
  }

  $Config = Login-FromDesktop
  if ($null -eq $Config) {
    throw "Not logged in. Put novajudge-submit.json on Desktop first."
  }
  return $Config
}

function Infer-Language($FilePath) {
  $Ext = [IO.Path]::GetExtension($FilePath).ToLowerInvariant()
  switch ($Ext) {
    ".c" { return "c" }
    ".cc" { return "cpp" }
    ".cpp" { return "cpp" }
    ".cxx" { return "cpp" }
    ".java" { return "java" }
    ".py" { return "pypy3" }
    ".py3" { return "pypy3" }
    default { return "" }
  }
}

function Infer-Problem($FilePath) {
  $Name = [IO.Path]::GetFileNameWithoutExtension($FilePath)
  if ($Name -match "^([A-Za-z][A-Za-z0-9_-]*)") {
    return $Matches[1].ToUpperInvariant()
  }
  return ""
}

function Post-Submission($Config, $Problem, $Language, $Code) {
  return Invoke-JsonPost `
    -Url "$($Config.baseUrl)/api/cli/submit" `
    -Headers @{ Authorization = "Bearer $($Config.token)"; "x-contest-access-token" = [string]$Config.contestAccessToken } `
    -Body @{
      contestId = [int]$Config.contestId
      problem = $Problem
      language = $Language
      code = $Code
    }
}

function Get-SubmissionContext($Config, $Problem) {
  return Invoke-JsonPost `
    -Url "$($Config.baseUrl)/api/cli/context" `
    -Headers @{ Authorization = "Bearer $($Config.token)"; "x-contest-access-token" = [string]$Config.contestAccessToken } `
    -Body @{
      contestId = [int]$Config.contestId
      problem = $Problem
    }
}

function Confirm-Submission($Context, $Language) {
  Write-Host ""
  Write-Host "Please confirm submission:"
  Write-Host "Contest Name: $($Context.contestName)"
  Write-Host "Team Name: $($Context.teamName)"
  Write-Host "Problem Name: $($Context.problemName)"
  Write-Host "Language: $Language"
  Write-Host ""

  $Answer = Read-Host "Type y to submit"
  return $Answer -eq "y"
}

try {
  $ArgsList = @($args)
  if ($ArgsList.Count -eq 0 -or $ArgsList[0] -eq "-h" -or $ArgsList[0] -eq "--help") {
    Show-Usage
    exit 0
  }

  if ($ArgsList[0] -eq "version") {
    Write-Host "NovaJudge submit client $ClientVersion"
    Write-Host "Script: $PSCommandPath"
    Write-Host "curl.exe: $((Get-Command 'curl.exe' -ErrorAction SilentlyContinue).Source)"
    exit 0
  }

  if ($ArgsList[0] -eq "status") {
    $Config = Get-ConfigOrLogin
    if ($null -eq $Config -or !$Config.token) {
      Write-Host "Not logged in."
      exit 0
    }
    Write-Host "User: $($Config.username)"
    Write-Host "Contest: #$($Config.contestId) $($Config.contestTitle)"
    Write-Host "Server: $($Config.baseUrl)"
    exit 0
  }

  $Problem = ""
  $Language = ""
  $FilePath = ""
  $AssumeYes = $false

  for ($i = 0; $i -lt $ArgsList.Count; $i++) {
    if ($ArgsList[$i] -eq "--problem") {
      $i++
      $Problem = [string]$ArgsList[$i]
    } elseif ($ArgsList[$i] -eq "--language") {
      $i++
      $Language = [string]$ArgsList[$i]
    } elseif ($ArgsList[$i] -eq "-y" -or $ArgsList[$i] -eq "--yes") {
      $AssumeYes = $true
    } elseif (!$FilePath) {
      $FilePath = [string]$ArgsList[$i]
    }
  }

  if (!$FilePath) {
    Show-Usage
    exit 1
  }

  if (!(Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "File not found: $FilePath"
  }

  if (!$Problem) {
    $Problem = Infer-Problem $FilePath
  }
  $Problem = $Problem.ToUpperInvariant()

  if (!$Language) {
    $Language = Infer-Language $FilePath
  }

  if (!$Problem) {
    throw "Cannot infer problem id. Use: submit --problem A main.cpp"
  }
  if (!$Language) {
    throw "Cannot infer language. Use: submit --language cpp A.txt"
  }

  $Config = Get-ConfigOrLogin
  try {
    $SubmitContext = Get-SubmissionContext $Config $Problem
  } catch {
    $Message = [string]$_
    if ($Message -match "expired|invalid|Invalid token|Missing Bearer token") {
      $Config = Login-FromDesktop
      if ($null -eq $Config) {
        throw $Message
      }
      $SubmitContext = Get-SubmissionContext $Config $Problem
    } else {
      throw
    }
  }

  if (!$AssumeYes) {
    if (!(Confirm-Submission $SubmitContext $Language)) {
      Write-Host "Cancelled."
      exit 1
    }
  }

  Write-Host "Submitting $FilePath as problem $Problem, language $Language..."
  Write-Host "Reading source file..."
  $Code = Get-Content -LiteralPath $FilePath -Raw
  Write-Host "Read $($Code.Length) characters."

  try {
    $Data = Post-Submission $Config $Problem $Language $Code
  } catch {
    $Message = [string]$_
    if ($Message -match "expired|invalid|Invalid token|Missing Bearer token") {
      $Config = Login-FromDesktop
      if ($null -eq $Config) {
        throw $Message
      }
      $Data = Post-Submission $Config $Problem $Language $Code
    } else {
      throw
    }
  }

  Write-Host "Submitted #$($Data.submission.displayId) $Problem $Language`: $($Data.submission.id)"
} catch {
  Write-Error $_.Exception.Message
  if ($_.InvocationInfo) {
    Write-Error ("At {0}:{1}" -f $_.InvocationInfo.ScriptName, $_.InvocationInfo.ScriptLineNumber)
    Write-Error $_.InvocationInfo.Line
  }
  exit 1
}
