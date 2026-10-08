param([string]$BaselineInstaller)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'output'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $root "release/keystill-$version-win-x64.exe"
if (!(Test-Path -LiteralPath $installer)) { throw "Build the NSIS installer first: $installer" }

# Refuse to replace a personal installation while exercising the real app identity.
foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (!(Test-Path $registry)) { continue }
    Get-ChildItem $registry | Get-ItemProperty | Where-Object { $_.DisplayName -match '^(Keystill|Jiazi Vault)( |$)' } | ForEach-Object {
        $uninstaller = ([string]$_.UninstallString).Trim('"')
        if (!$uninstaller.StartsWith($output + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Run package verification on a clean machine; a personal installation is registered.'
        }
    }
}

$run = Join-Path $output ('package-check-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $run 'app'
New-Item -ItemType Directory -Force -Path $run | Out-Null
$oldExe = $env:JIAZI_INSTALLED_EXE
$oldData = $env:JIAZI_UPGRADE_DATA
$env:JIAZI_UPGRADE_DATA = Join-Path $output ('playwright/upgrade-' + [guid]::NewGuid().ToString('N'))
function Install-Package([string]$path) {
    $process = Start-Process -FilePath (Resolve-Path -LiteralPath $path).Path -ArgumentList @('/S', "/D=$install") -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $executables = @('Keystill.exe', 'Jiazi Vault.exe') | ForEach-Object { Join-Path $install $_ } | Where-Object { Test-Path -LiteralPath $_ }
    if ($executables.Count -ne 1) { throw 'Expected exactly one installed application' }
    $env:JIAZI_INSTALLED_EXE = [string]@($executables)[0]
}
function Run-Test([string]$name, [string]$phase = '') {
    & node (Join-Path $root "tests/$name.mjs") $phase
    if ($LASTEXITCODE -ne 0) { throw "$name $phase failed" }
}

Push-Location $root
try {
    if ($BaselineInstaller) {
        Install-Package $BaselineInstaller
        Run-Test 'package-upgrade' 'seed'
    }
    Install-Package $installer
    if ($BaselineInstaller) { Run-Test 'package-upgrade' 'verify' }
    else { Write-Output 'No previous release supplied; upgrade test skipped (fresh installation only).' }
    Run-Test 'installed-smoke'
    Run-Test 'access-smoke'
    Run-Test 'data-recovery'
    Run-Test 'app-update'
} finally {
    try {
        if (Test-Path -LiteralPath $install) {
            $resolved = [IO.Path]::GetFullPath($install)
            if (!$resolved.StartsWith([IO.Path]::GetFullPath($run) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe uninstall path' }
            $uninstall = Get-ChildItem -LiteralPath $resolved -Filter 'Uninstall *.exe' | Select-Object -First 1
            if ($uninstall) {
                $process = Start-Process -FilePath $uninstall.FullName -ArgumentList @('/S', "_?=$resolved") -WindowStyle Hidden -Wait -PassThru
                if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
            }
        }
    } finally {
        $env:JIAZI_INSTALLED_EXE = $oldExe
        $env:JIAZI_UPGRADE_DATA = $oldData
        Pop-Location
    }
}
