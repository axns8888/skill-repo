#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet('Check','Prepare','Build','Install','Verify','Rollback','Platform','SyncStatus','SyncConfigure','SyncEnable','SyncDisable','SyncReconcile','SyncRollback')]
    [string]$Action = 'Check',
    [string]$Workspace,
    [string]$DshHome,
    [string]$DshCommand = 'dsh',
    [string]$MulticaCliPath,
    [string]$BackupId,
    [string]$SyncPolicyFile,
    [string]$SyncRevision
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$SkillRoot = Split-Path $PSScriptRoot -Parent
$Manifest = Get-Content -LiteralPath (Join-Path $SkillRoot 'manifest.json') -Raw | ConvertFrom-Json
$DefaultWorkspace = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'axns-config-dsh-multica-runtime'
if ([string]::IsNullOrWhiteSpace($Workspace)) { $Workspace = $DefaultWorkspace }
$Workspace = [IO.Path]::GetFullPath($Workspace)
$Source = Join-Path $Workspace 'source'
$Tools = Join-Path $Workspace 'tools'
$Artifacts = Join-Path $Workspace 'artifacts'
$Repo = [string]$Manifest.repository
$Commit = [string]$Manifest.commit
$TreeOid = [string]$Manifest.sourceTreeOid
$RuntimeVersion = [string]$Manifest.version

function Fail([string]$Message) { throw $Message }
function Assert-PathNotReparse([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    $cursor = $root
    foreach ($part in $full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)) {
        $cursor = Join-Path $cursor $part
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "拒绝 junction/symlink 路径：$cursor" }
        }
    }
}
function Invoke-Git([string[]]$GitArgs, [string]$Cwd = $Workspace) {
    $exe = (Get-Command git -ErrorAction Stop).Source
    $output = & $exe -C $Cwd @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Git $($GitArgs -join ' ') 失败：$output" }
    return (($output | Out-String).Trim())
}
function Assert-PinnedSource {
    if (-not (Test-Path -LiteralPath (Join-Path $Source '.git'))) { Fail "固定源码不存在；运行 Prepare：$Source" }
    Assert-PathNotReparse $Source
    $origin = Invoke-Git -GitArgs @('remote','get-url','origin') -Cwd $Source
    if ($origin -cne $Repo) { Fail '源码 origin 不匹配固定仓库；保留现状，不自动修复' }
    $head = Invoke-Git -GitArgs @('rev-parse','HEAD') -Cwd $Source
    if ($head -cne $Commit) { Fail "源码 HEAD 不匹配固定 SHA：$head" }
    $tree = Invoke-Git -GitArgs @('rev-parse','HEAD^{tree}') -Cwd $Source
    if ($tree -cne $TreeOid) { Fail "固定提交 tree OID 不匹配：$tree" }
    $status = Invoke-Git -GitArgs @('status','--porcelain','--untracked-files=all') -Cwd $Source
    if ($status) { Fail '固定源码目录存在修改或未跟踪文件；为保护内容停止，不清理/覆盖' }
    return $head
}
function Get-DshHomePath {
    $value = $DshHome
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $env:DSH_HOME }
    if ([string]::IsNullOrWhiteSpace($value)) { $value = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
    return [IO.Path]::GetFullPath($value)
}
function Assert-DshCommand {
    $cmd = Get-Command $DshCommand -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($cmd.Source)) { Fail 'DSH 必须解析到具体可执行路径；请显式传入 -DshCommand' }
    return $cmd.Source
}
function Invoke-JsonCommand([string]$Exe, [string[]]$CommandArgs) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    if ([IO.Path]::GetExtension($Exe) -eq '.ps1') {
        $start.FileName = (Get-Command pwsh -ErrorAction Stop).Source
        foreach ($arg in @('-NoProfile','-File',$Exe)) { $start.ArgumentList.Add($arg) }
    } else { $start.FileName = $Exe }
    foreach ($arg in $CommandArgs) { $start.ArgumentList.Add($arg) }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment['DSH_HOME'] = Get-DshHomePath
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) {
            $process.Kill($true); $process.WaitForExit()
            $null = $stdout.GetAwaiter().GetResult(); $null = $stderr.GetAwaiter().GetResult()
            Fail 'DSH 命令超时；敏感输出已省略。'
        }
        $raw = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { Fail 'DSH 命令失败；敏感输出已省略。' }
        return ,@($raw -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    } finally { $process.Dispose() }
}
function Test-Models([string]$Exe) {
    $frames = Invoke-JsonCommand $Exe @('--profile','multica','--list-models')
    $models = @()
    foreach ($line in $frames) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $frame = $line | ConvertFrom-Json -AsHashtable -ErrorAction Stop } catch { Fail 'DSH 模型目录不是有效 JSONL；不回显内容' }
        if ($frame.type -eq 'models' -and $frame.v -eq 1 -and $frame.models -is [array]) { $models = @($frame.models) }
    }
    if ($models.Count -eq 0) { Fail 'DSH multica 模型目录为空。请在本机为启动 daemon 的同一用户配置模型/凭据，再重试；不会读取或输出秘密值。' }
    return $models.Count
}
function Assert-Cli {
    if ([string]::IsNullOrWhiteSpace($MulticaCliPath)) {
        $envPath = $env:MULTICA_CLI_PATH
        if ([string]::IsNullOrWhiteSpace($envPath)) { Fail '需提供 Multica CLI 的真实绝对路径 -MulticaCliPath；普通终端 MULTICA_CLI_PATH 可能为空。不会从 PATH 选择旧版。' }
        $MulticaCliPath = $envPath
    }
    if (-not [IO.Path]::IsPathFullyQualified($MulticaCliPath) -or -not (Test-Path -LiteralPath $MulticaCliPath -PathType Leaf)) { Fail 'MulticaCliPath 必须是存在的 CLI 绝对文件路径。' }
    return [IO.Path]::GetFullPath($MulticaCliPath)
}
function Invoke-Cli([string]$Exe, [string[]]$CommandArgs) {
    $output = & $Exe @CommandArgs 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "精确 Multica CLI 命令失败（退出码 $LASTEXITCODE）；输出已省略以防泄漏敏感信息。" }
    $output | Out-String
}
function Get-BuildFiles {
    Assert-PathNotReparse $Artifacts
    $items = @(Get-ChildItem -LiteralPath $Artifacts -Filter '*.tgz' -File -ErrorAction SilentlyContinue)
    $sums = Join-Path $Artifacts 'SHA256SUMS.txt'
    $info = Join-Path $Artifacts 'build-info.json'
    if ($items.Count -ne 1 -or -not (Test-Path -LiteralPath $sums) -or -not (Test-Path -LiteralPath $info)) { Fail '需先成功执行 Build；未找到唯一 tgz、checksum 与 build-info。' }
    $buildInfo = Get-Content -LiteralPath $info -Raw | ConvertFrom-Json
    if ($buildInfo.sourceSha -cne $Commit -or $buildInfo.version -cne $RuntimeVersion -or $buildInfo.package -cne $Manifest.package) { Fail 'build-info 与固定源码/包版本不符。' }
    $line = @(Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^([0-9a-fA-F]{64}) [ *]' + [regex]::Escape($items[0].Name) + '$') })
    if ($line.Count -ne 1) { Fail 'SHA256SUMS 中没有唯一匹配项。' }
    $expected = [regex]::Match($line[0], '^([0-9a-fA-F]{64})').Groups[1].Value.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $items[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $expected) { Fail 'Runtime tgz SHA256 不匹配；profile 未变更。' }
    return @{Package=$items[0].FullName; Checksums=$sums; BuildInfo=$buildInfo; Hash=$actual}
}
function Assert-ProfileBoundary([string]$HomePath) {
    $home = [IO.Path]::GetFullPath($HomePath).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $profile = [IO.Path]::GetFullPath((Join-Path $home 'profiles/multica'))
    if (-not $profile.StartsWith($home + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { Fail 'DSH profile 超出明确 DSH_HOME 边界。' }
    Assert-PathNotReparse $home
    return $profile
}

if ($Workspace.StartsWith((Join-Path (Get-Location).Path '.planning') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $Workspace -match '[\\/]\.planning(?:[\\/]|$)') { Fail 'Workspace 不得放入项目规划资料目录。' }
if ($Action -in @('Prepare','Build','Install','Rollback')) { Assert-PathNotReparse $Workspace; New-Item -ItemType Directory -Path $Workspace -Force | Out-Null }

if ($Action.StartsWith('Sync')) {
    $arguments = @{ Action = $Action.Substring(4); DshHome = (Get-DshHomePath); DshCommand = (Assert-DshCommand) }
    if ($SyncPolicyFile) { $arguments.PolicyFile = $SyncPolicyFile }
    if ($SyncRevision) { $arguments.Revision = $SyncRevision }
    & (Join-Path $PSScriptRoot 'model-sync.ps1') @arguments
    return
}

switch ($Action) {
    'Check' {
        $pwsh = $PSVersionTable.PSVersion.ToString()
        if ($PSVersionTable.PSVersion -lt [version]'7.4') { Fail '需要 PowerShell 7.4+' }
        $nodeCmd = Get-Command node -ErrorAction Stop
        $node = (& $nodeCmd.Source --version).Trim()
        if ($LASTEXITCODE -ne 0 -or $node -cne "v$($Manifest.node)") { Fail "Node 版本必须为 v$($Manifest.node)；实际 $node" }
        $gitCmd = Get-Command git -ErrorAction Stop
        $npmCmd = Get-Command npm -ErrorAction Stop
        $dshExe = Assert-DshCommand
        $dshVersionOutput = Invoke-JsonCommand $dshExe @('--version')
        $dshVersion = ($dshVersionOutput -join ' ').Trim()
        if ($dshVersion -cne [string]$Manifest.dshTest) { Fail "DSH version must be $($Manifest.dshTest); actual $dshVersion" }
        $models = Test-Models $dshExe
        $result = [ordered]@{action=$Action;powerShell=$pwsh;node=$node;git=$gitCmd.Source;npm=$npmCmd.Source;dsh=$dshExe;modelCount=$models;runtimeSource=if(Test-Path $Source){'present (strict validation required before use)'}else{'not prepared'};multicaCli=if($MulticaCliPath -or $env:MULTICA_CLI_PATH){'explicitly available'}else{'not supplied; platform checks unavailable'};credentials='not inspected';writesProfile=$false;daemonChanged=$false}
        [pscustomobject]$result
    }
    'Prepare' {
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '未找到 Git。' }
        if (Test-Path -LiteralPath $Source) { $null = Assert-PinnedSource; Write-Output "Pinned source already verified: $Commit"; break }
        New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
        $null = Invoke-Git -GitArgs @('init',$Source) -Cwd $Workspace
        $null = Invoke-Git -GitArgs @('remote','add','origin',$Repo) -Cwd $Source
        $null = Invoke-Git -GitArgs @('fetch','--no-tags','origin',$Commit) -Cwd $Source
        $fetchedTree = Invoke-Git -GitArgs @('rev-parse',"$Commit^{tree}") -Cwd $Source
        if ($fetchedTree -cne $TreeOid) { Fail "获取提交 tree OID 与 manifest 不符：$fetchedTree" }
        $null = Invoke-Git -GitArgs @('checkout','--detach',$Commit) -Cwd $Source
        $null = Assert-PinnedSource
        Write-Output "Prepared verified source $Commit (tree $TreeOid)."
    }
    'Build' {
        if (-not (Test-Path -LiteralPath $Source)) { & $PSCommandPath -Action Prepare -Workspace $Workspace; if (-not $?) { Fail 'Prepare failed' } }
        $null = Assert-PinnedSource
        $dshExe = Assert-DshCommand
        $dshVersionOutput = Invoke-JsonCommand $dshExe @('--version')
        $dshVersion = ($dshVersionOutput -join ' ').Trim()
        if ($dshVersion -cne [string]$Manifest.dshTest) { Fail "DSH version must be $($Manifest.dshTest); actual $dshVersion" }
        & (Join-Path $Source 'scripts/prepare-pnpm.ps1') -ToolDirectory $Tools
        if ($LASTEXITCODE -ne 0) { Fail '固定 pnpm 准备失败。' }
        $pnpm = Join-Path $Tools 'node_modules/pnpm/bin/pnpm.mjs'
        & (Join-Path $Source 'scripts/build-release.ps1') -OutputDirectory $Artifacts -PnpmEntry $pnpm
        if ($LASTEXITCODE -ne 0) { Fail '固定 runtime 构建/包审计失败。' }
        $build = Get-BuildFiles
        [pscustomobject]@{action=$Action;sourceSha=$Commit;version=$RuntimeVersion;sha256=$build.Hash;artifactName=[IO.Path]::GetFileName($build.Package);inference='not_verified';writesProfile=$false;daemonChanged=$false}
    }
    'Install' {
        $dshExe = Assert-DshCommand
        $homePath = Get-DshHomePath
        $null = Assert-ProfileBoundary $homePath
        $null = Test-Models $dshExe
        if (-not (Test-Path -LiteralPath $Source)) { & $PSCommandPath -Action Prepare -Workspace $Workspace; if (-not $?) { Fail 'Prepare failed' } }
        $null = Assert-PinnedSource
        if (-not (Test-Path -LiteralPath (Join-Path $Artifacts 'build-info.json'))) { & $PSCommandPath -Action Build -Workspace $Workspace -DshCommand $DshCommand; if (-not $?) { Fail 'Build failed' } }
        $build = Get-BuildFiles
        $installer = Join-Path $Source 'scripts/install-runtime.ps1'
        $installResult = & $installer -Package $build.Package -Checksums $build.Checksums -DshHome $homePath -DshCommand $dshExe
        if ($LASTEXITCODE -ne 0) { Fail 'Runtime helper install/verify failed; inspect its backup receipt and recovery state.' }
        $installResult
    }
    'Verify' {
        $dshExe = Assert-DshCommand
        $null = Assert-PinnedSource
        $verify = & (Join-Path $Source 'scripts/verify-runtime.ps1') -DshHome (Get-DshHomePath) -DshCommand $dshExe -ExpectedVersion $RuntimeVersion
        if ($LASTEXITCODE -ne 0) { Fail 'Runtime verification failed.' }
        $cli = Assert-Cli
        $cliVersion = (Invoke-Cli $cli @('version')).Trim()
        if ($cliVersion -notmatch [regex]::Escape([string]$Manifest.multica)) { Fail "Multica CLI must be $($Manifest.multica); version output did not match." }
        $runtimes = Invoke-Cli $cli @('runtime','list','--output','json')
        [pscustomobject]@{action=$Action;runtimeVerification=$verify;platformRuntimeList=$runtimes;inference='not_verified';agentBinding='not_verified';daemonChanged=$false}
    }
    'Rollback' {
        if ($BackupId -notmatch '^[a-f0-9]{32}$') { Fail 'Rollback 必须提供 32 位 helper backup ID：-BackupId' }
        $null = Assert-PinnedSource
        $rollback = & (Join-Path $Source 'scripts/install-runtime.ps1') -Rollback $BackupId -DshHome (Get-DshHomePath) -DshCommand (Assert-DshCommand)
        if ($LASTEXITCODE -ne 0) { Fail 'Runtime helper rollback failed; preserve receipt and profile for recovery.' }
        $rollback
    }
    'Platform' {
        $cli = Assert-Cli
        $cliVersion = (Invoke-Cli $cli @('version')).Trim()
        if ($cliVersion -notmatch [regex]::Escape([string]$Manifest.multica)) { Fail "Multica CLI must be $($Manifest.multica); version output did not match." }
        $daemon = Invoke-Cli $cli @('daemon','status','--output','json')
        $runtimes = Invoke-Cli $cli @('runtime','list','--output','json')
        [pscustomobject]@{action=$Action;daemonStatus=$daemon;runtimes=$runtimes;daemonChanged=$false;agentBindingChanged=$false}
    }
}
