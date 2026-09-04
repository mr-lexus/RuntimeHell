$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot 'logo.svg'
$outputDir = Join-Path $repoRoot 'build'
$pngPath = Join-Path $outputDir 'icon.png'
$icoPath = Join-Path $outputDir 'icon.ico'
$masterSize = 1024
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)

[xml]$svg = Get-Content -LiteralPath $sourcePath -Raw
$viewBox = $svg.svg.viewBox -split '\s+' | ForEach-Object { [double]$_ }
$sourceX, $sourceY, $sourceWidth, $sourceHeight = $viewBox

function Convert-SvgToPngBytes {
  param([int]$Size)

  $scale = [Math]::Min($Size / $sourceWidth, $Size / $sourceHeight)
  $offsetX = ($Size - ($sourceWidth * $scale)) / 2
  $offsetY = ($Size - ($sourceHeight * $scale)) / 2
  $visual = [System.Windows.Media.DrawingVisual]::new()
  $context = $visual.RenderOpen()

  $transform = [System.Windows.Media.TransformGroup]::new()
  $transform.Children.Add([System.Windows.Media.TranslateTransform]::new(-$sourceX, -$sourceY))
  $transform.Children.Add([System.Windows.Media.ScaleTransform]::new($scale, $scale))
  $transform.Children.Add([System.Windows.Media.TranslateTransform]::new($offsetX, $offsetY))
  $context.PushTransform($transform)

  $brushConverter = [System.Windows.Media.BrushConverter]::new()
  foreach ($path in $svg.svg.path) {
    $geometry = [System.Windows.Media.Geometry]::Parse($path.d)
    $brush = [System.Windows.Media.Brush]$brushConverter.ConvertFromString($path.fill)
    $context.DrawGeometry($brush, $null, $geometry)
  }

  $context.Pop()
  $context.Close()
  $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
    $Size,
    $Size,
    96,
    96,
    [System.Windows.Media.PixelFormats]::Pbgra32
  )
  $bitmap.Render($visual)

  $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = [System.IO.MemoryStream]::new()
  $encoder.Save($stream)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  return $bytes
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$masterPng = Convert-SvgToPngBytes -Size $masterSize
[System.IO.File]::WriteAllBytes($pngPath, $masterPng)

$icoImages = foreach ($size in $icoSizes) {
  [pscustomobject]@{ Size = $size; Bytes = (Convert-SvgToPngBytes -Size $size) }
}

$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$icoImages.Count)
$offset = 6 + (16 * $icoImages.Count)

foreach ($image in $icoImages) {
  $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $writer.Write([byte]$dimension)
  $writer.Write([byte]$dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}

foreach ($image in $icoImages) {
  $writer.Write([byte[]]$image.Bytes)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())
$writer.Dispose()
$icoStream.Dispose()

Write-Host "[brand-assets] $sourcePath -> $pngPath, $icoPath"
