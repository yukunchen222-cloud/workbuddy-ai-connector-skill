param(
    [Parameter(Mandatory = $true)][string]$WorkBuddyExe,
    [Parameter(Mandatory = $true)][string]$WorkBuddyAIExe,
    [ValidateSet('check', 'install', 'remove')][string]$Action = 'check'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This version supports Windows only.' }
$taskCn = (Resolve-Path -LiteralPath $WorkBuddyExe).Path
$taskAi = (Resolve-Path -LiteralPath $WorkBuddyAIExe).Path
if ([IO.Path]::GetFileName($taskCn) -ine 'WorkBuddy.exe' -or [IO.Path]::GetFileName($taskAi) -ine 'WorkBuddyAI.exe') {
    throw 'Select the domestic WorkBuddy.exe and international WorkBuddyAI.exe.'
}
if ($taskCn -ieq $taskAi) { throw 'Two different installations are required.' }
$taskManager = Join-Path $PSScriptRoot 'manage.cjs'
$taskOriginalNode = $env:ELECTRON_RUN_AS_NODE
$taskOriginalCn = $env:WB_CONNECTOR_CN_EXE
$taskOriginalAi = $env:WB_CONNECTOR_AI_EXE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:WB_CONNECTOR_CN_EXE = $taskCn
    $env:WB_CONNECTOR_AI_EXE = $taskAi
    # Pipe GUI-subsystem output so PowerShell waits for the runtime to finish.
    & $taskAi $taskManager $Action | Out-String | Write-Output
    if ($LASTEXITCODE -ne 0) { throw ('Connector ' + $Action + ' failed; see the sanitized error above.') }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $taskOriginalNode
    $env:WB_CONNECTOR_CN_EXE = $taskOriginalCn
    $env:WB_CONNECTOR_AI_EXE = $taskOriginalAi
}
