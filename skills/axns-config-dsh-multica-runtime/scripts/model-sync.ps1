#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet('Status','Configure','Enable','Disable','Reconcile','Rollback')][string]$Action = 'Status',
    [Parameter(Mandatory)][string]$DshHome,
    [Parameter(Mandatory)][string]$DshCommand,
    [string]$PolicyFile,
    [string]$Revision
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-Unlinked([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw '拒绝 symlink/junction 配置路径。'
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}
if (-not [IO.Path]::IsPathFullyQualified($DshCommand) -or -not (Test-Path -LiteralPath $DshCommand -PathType Leaf)) {
    throw '必须提供本机已核实的 DSH 可执行文件绝对路径。'
}
$DshHome = [IO.Path]::GetFullPath($DshHome)
$profileDirectory = Join-Path $DshHome 'profiles/multica'
$stateDirectory = Join-Path $profileDirectory '.model-sync'
Assert-Unlinked $profileDirectory
if (-not (Test-Path -LiteralPath (Join-Path $profileDirectory 'package.json'))) { throw 'multica profile 不存在；不自动创建或安装。' }
function Invoke-Sync([string]$Mode) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    if ([IO.Path]::GetExtension($DshCommand) -eq '.ps1') {
        $start.FileName = (Get-Command pwsh -ErrorAction Stop).Source
        foreach ($arg in @('-NoProfile','-File',$DshCommand)) { $start.ArgumentList.Add($arg) }
    } else { $start.FileName = $DshCommand }
    foreach ($arg in @('--profile','multica',$Mode)) { $start.ArgumentList.Add($arg) }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment['DSH_HOME'] = $DshHome
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(90000)) {
        # This is the exact DSH child this script created; never a Multica daemon by executable name.
        $process.Kill($true); $process.WaitForExit()
        $null = $stdout.GetAwaiter().GetResult(); $null = $stderr.GetAwaiter().GetResult()
        throw 'DSH 同步命令超时；原始错误已抑制。'
    }
    $raw = $stdout.GetAwaiter().GetResult()
    $null = $stderr.GetAwaiter().GetResult()
    try { $result = $raw.Trim() | ConvertFrom-Json -ErrorAction Stop } catch { throw 'DSH 未返回安全同步状态；请先安装经测试的维护补丁。' }
    if (-not ($result.PSObject.Properties.Name -contains 'enabled')) { throw '当前 runtime 不支持同步控制入口；不改写 profile。' }
    # Never echo arbitrary native stdout/stderr, including credential-reference errors.
    $safe = [ordered]@{}
    foreach ($key in @('enabled','revision','lastSuccess','nextCheck','changed','removed','conflicts','drift','stale','failures','deletionPreview','inactive','pinned','localCatalogGeneration','platformRefresh','code')) {
        if ($result.PSObject.Properties.Name -contains $key) { $safe[$key] = $result.$key }
    }
    $safe | ConvertTo-Json -Compress
    if ($process.ExitCode -ne 0) { throw '同步未通过；请依据安全 code 处理，不输出原始错误。' }
}
if ($Action -eq 'Configure') {
    # Fail closed on the pinned older runtime before making any persistent change.
    $null = Invoke-Sync '--sync-status'
    if (-not $PolicyFile) { throw 'Configure 必须提供本机明确选择的 -PolicyFile。' }
    $policy = Get-Content -LiteralPath $PolicyFile -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
    if ($policy.schema -ne 1 -or $policy.sources -isnot [array] -or $policy.sources.Count -lt 1 -or $policy.sources.Count -gt 16 -or @($policy.Keys | Where-Object { $_ -notin @('schema','sources') }).Count) { throw '只接受 schema=1 与 sources；不支持历史 namespace 映射。' }
    $names = [Collections.Generic.HashSet[string]]::new()
    foreach ($source in $policy.sources) {
        if ($source.profile -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$' -or $source.profile -eq 'multica' -or $source.enabled -isnot [bool] -or -not $names.Add($source.profile)) { throw '来源选择无效。' }
        if (@($source.Keys | Where-Object { $_ -notin @('profile','enabled','providers') }).Count) { throw '来源策略含非白名单字段。' }
        if ($source.ContainsKey('providers')) { if ($source.providers -isnot [array]) { throw 'providers 必须是数组。' }; foreach ($id in $source.providers) { if ($id -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$') { throw 'provider 选择无效。' } } }
    }
    Assert-Unlinked $stateDirectory
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $identitySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $aclOutput = & icacls.exe $stateDirectory '/inheritance:r' '/grant:r' "*$($identitySid):(OI)(CI)F"
    if ($LASTEXITCODE -ne 0) { throw '受限目录 ACL 设置失败。' }
    $lockPath = Join-Path $stateDirectory 'writer.lock'
    $lock = [IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        $policyPath = Join-Path $stateDirectory 'policy.json'
        Assert-Unlinked $policyPath
        $temporary = Join-Path $stateDirectory ([guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($temporary,($policy | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporary,$policyPath,$true)
    } finally { $lock.Dispose(); Remove-Item -LiteralPath $lockPath }
    Write-Output '{"configured":true,"enabledUnchanged":true}'
    return
}
$mode = switch ($Action) {
    Status { '--sync-status' }
    Enable { '--sync-enable' }
    Disable { '--sync-disable' }
    Reconcile { '--sync-reconcile' }
    Rollback {
        if ($Revision -notmatch '^[a-f0-9-]{36}$') { throw 'Rollback 需要安全状态返回的 -Revision。' }
        "--sync-rollback=$Revision"
    }
}
Invoke-Sync $mode
