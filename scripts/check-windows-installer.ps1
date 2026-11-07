# Exercise the Forge all-users setup and its machine-wide Windows registration on the CI runner.
# The setup requests administrator rights; the runner account is an administrator.
$ErrorActionPreference = 'Stop'
$version = (Get-Content VERSION -Raw).Trim()
$installer = Join-Path (Resolve-Path 'build/release').Path "NodeForge-v$version.exe"
if (-not (Test-Path $installer)) { throw "Setup not found: $installer" }
$family = Join-Path $env:ProgramFiles 'Forge'
$app = Join-Path $family 'NodeForge'
$registry = Join-Path $family 'installed.json'
$uninstallKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Forge.nodeforge'
$associationKey = 'HKLM:\Software\Classes\.nfg'
$iconKey = 'HKLM:\Software\Classes\Forge.nodeforge.nfg\DefaultIcon'
$shortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\NodeForge.lnk'

function RunSetup($arguments, $expected) {
  $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne $expected) {
    throw "Setup $arguments exited $($process.ExitCode), expected $expected."
  }
}

RunSetup @('/S') 0
if (-not (Test-Path (Join-Path $app 'NodeForge.exe'))) { throw 'NodeForge was not installed in Program Files.' }
if ((Get-ItemProperty $uninstallKey).DisplayVersion -ne $version) { throw 'The Settings entry has the wrong version.' }
if ((Get-Item $associationKey).GetValue('') -ne 'Forge.nodeforge.nfg') { throw 'The .nfg association is missing.' }
$documentIcon = (Get-Item $iconKey).GetValue('')
if (-not $documentIcon -or -not $documentIcon.EndsWith('nodeforge-document.ico') -or -not (Test-Path $documentIcon)) { throw 'The .nfg document icon is missing.' }
if (-not (Test-Path $shortcut)) { throw 'The common Start menu shortcut is missing.' }

$data = Join-Path $env:APPDATA 'NodeForge'
New-Item $data -ItemType Directory -Force | Out-Null
$marker = Join-Path $data 'installer-check.txt'
Set-Content $marker 'Keep user data during a repair and uninstall.'
RunSetup @('/S') 0
if (-not (Test-Path $marker)) { throw 'Repair removed user data.' }

$saved = Get-Content $registry -Raw | ConvertFrom-Json -AsHashtable
$newer = Get-Content $registry -Raw | ConvertFrom-Json -AsHashtable
$newer.apps.nodeforge.version = '999.0.0'
$newer | ConvertTo-Json -Depth 10 | Set-Content $registry -Encoding utf8NoBOM
try { RunSetup @('/S') 2 }
finally { $saved | ConvertTo-Json -Depth 10 | Set-Content $registry -Encoding utf8NoBOM }

RunSetup @('/uninstall', '/S') 0
if (Test-Path $app) { throw 'Uninstall left the app folder behind.' }
if (Test-Path $uninstallKey) { throw 'Uninstall left the Settings entry behind.' }
if (Test-Path $associationKey) { throw 'Uninstall left the .nfg association behind.' }
if (Test-Path $shortcut) { throw 'Uninstall left the Start menu shortcut behind.' }
if (-not (Test-Path $marker)) { throw 'Uninstall removed user data.' }
Write-Host 'Forge setup: all-users install, repair, downgrade protection, document icon and uninstall passed.'
