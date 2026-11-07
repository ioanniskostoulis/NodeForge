# Launch the packaged Windows app on the Actions runner and check its startup screenshot.
$ErrorActionPreference = 'Stop'
$app = (Resolve-Path 'build/release/win-unpacked/NodeForge.exe').Path
$capture = Join-Path (Resolve-Path 'build/release').Path 'windows-launch.png'
# A rerun must prove this process produced the screenshot.
if (Test-Path $capture) { Remove-Item $capture -Force }
$env:NODEFORGE_CAPTURE = $capture
$env:NODEFORGE_CAPTURE_DELAY = '3000'

$process = Start-Process -FilePath $app -WorkingDirectory (Split-Path $app) -PassThru `
  -RedirectStandardOutput "$capture.stdout.log" -RedirectStandardError "$capture.stderr.log"
try {
  $deadline = (Get-Date).AddSeconds(45)
  while (-not (Test-Path $capture) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { throw "NodeForge exited before saving a screenshot (code $($process.ExitCode))." }
  }
  if (-not (Test-Path $capture)) { throw 'NodeForge did not save a screenshot within 45 seconds.' }

  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Bitmap]::new($capture)
  try {
    if ($image.Width -lt 1000 -or $image.Height -lt 600) {
      throw "Screenshot is too small: $($image.Width) x $($image.Height)."
    }
    $colors = [System.Collections.Generic.HashSet[int]]::new()
    # Scan actual pixels until enough distinct colors are found. The old coarse grid missed
    # text and icons in a valid welcome screen and sampled only five background colors.
    for ($y = 0; $y -lt $image.Height -and $colors.Count -lt 10; $y++) {
      for ($x = 0; $x -lt $image.Width -and $colors.Count -lt 10; $x++) {
        $pixel = $image.GetPixel($x, $y)
        [void]$colors.Add($pixel.ToArgb())
      }
    }
    if ($colors.Count -lt 10) { throw "Screenshot looks blank ($($colors.Count) colors in the entire image)." }
    Write-Host "Windows app launched: $($image.Width) x $($image.Height) screenshot, at least $($colors.Count) colors."
  } finally {
    $image.Dispose()
  }
} finally {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
