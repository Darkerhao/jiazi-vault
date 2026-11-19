param([string]$Installer = $env:KEYSTILL_INSTALLER)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$output = Join-Path $root 'output'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (!$Installer) {
    $collected = Join-Path $root "release/keystill-$version-windows-x86_64.exe"
    if (Test-Path -LiteralPath $collected) { $Installer = $collected }
    else {
        $bundles = Join-Path $root 'src-tauri/target/release/bundle/nsis'
        $files = @(Get-ChildItem -LiteralPath $bundles -Filter "*_${version}_*.exe")
        if ($files.Count -ne 1) { throw 'Build exactly one current Windows NSIS installer first.' }
        $Installer = $files[0].FullName
    }
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path

# NSIS may close a running executable by name, including a portable personal copy.
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'keystill.exe'")) {
    if (!$process.ExecutablePath -or !$process.ExecutablePath.StartsWith($output + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A personal Keystill process is running. Use a clean machine for installer verification.'
    }
}

# A package acceptance run must never overwrite a personal installation.
foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (!(Test-Path -LiteralPath $registry)) { continue }
    Get-ChildItem -LiteralPath $registry | Get-ItemProperty | Where-Object { $_.DisplayName -match '^(Keystill|Jiazi Vault)( |$)' } | ForEach-Object {
        $uninstaller = ([string]$_.UninstallString).Trim('"')
        if (!$uninstaller.StartsWith($output + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Run installer verification on a clean machine; a personal installation is registered.'
        }
    }
}
$run = Join-Path $output ('package-check-' + [guid]::NewGuid().ToString('N'))
$install = [IO.Path]::GetFullPath((Join-Path $run 'app'))
if (!$install.StartsWith([IO.Path]::GetFullPath($run) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installation target' }
New-Item -ItemType Directory -Force -Path $run | Out-Null
$previousExe = $env:KEYSTILL_TEST_EXE
$previousData = $env:KEYSTILL_DATA_DIR
$env:KEYSTILL_DATA_DIR = Join-Path $run 'installer-startup-data'
$installedBytes = 0
$uninstallVerified = $false
Push-Location $root
try {
    $process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$install") -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $exe = Join-Path $install 'keystill.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installed native executable is missing' }
    $installedBytes = (Get-ChildItem -LiteralPath $install -Recurse -File | Measure-Object -Property Length -Sum).Sum
    if (Test-Path -LiteralPath (Join-Path $install 'resources/app.asar')) { throw 'The package still contains the Electron application' }
    if (Test-Path -LiteralPath (Join-Path $install 'windows-hello/WindowsHello.exe')) { throw 'The package still contains the .NET helper' }
    $env:KEYSTILL_TEST_EXE = $exe
    & node (Join-Path $root 'tests/desktop.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed native application acceptance failed' }
    Write-Output 'PASS NSIS installation, native desktop workflows and original Electron-vault compatibility'
} finally {
    $env:KEYSTILL_TEST_EXE = $previousExe
    $env:KEYSTILL_DATA_DIR = $previousData
    $uninstaller = Join-Path $install 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $resolved = [IO.Path]::GetFullPath($uninstaller)
        if (!$resolved.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe uninstaller path' }
        $process = Start-Process -FilePath $resolved -ArgumentList @('/S', "_?=$install") -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
        for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath (Join-Path $install 'keystill.exe')); $attempt++) { Start-Sleep -Milliseconds 100 }
        if (Test-Path -LiteralPath (Join-Path $install 'keystill.exe')) { throw 'Uninstaller did not remove the application' }
        $uninstallVerified = $true
    }
    Pop-Location
}
if (!$uninstallVerified) { throw 'Installer verification did not complete a verified uninstall' }
$report = [ordered]@{
    installer = $Installer
    installerBytes = (Get-Item -LiteralPath $Installer).Length
    installedApplicationBytes = $installedBytes
    installedApplicationMiB = [Math]::Round($installedBytes / 1MB, 2)
    installVerified = $true
    desktopVerified = $true
    uninstallVerified = $true
    isolatedDirectory = $run
}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'windows-package-report.json') -Encoding UTF8
