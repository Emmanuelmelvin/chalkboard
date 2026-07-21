param(
  [string]$FrameDirectory = (Join-Path $PSScriptRoot 'frames'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'chalkboard-demo.gif')
)

Add-Type -AssemblyName System.Drawing

$frameFiles = Get-ChildItem -LiteralPath $FrameDirectory -Filter 'frame-*.png' -File | Sort-Object Name
if ($frameFiles.Count -eq 0) {
  throw "No captured frames found in $FrameDirectory"
}

$targetWidth = 960
$targetHeight = 540
$images = @()

foreach ($file in $frameFiles) {
  $source = [System.Drawing.Image]::FromFile($file.FullName)
  $canvas = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $targetWidth, $targetHeight)
  $graphics.Dispose()
  $source.Dispose()
  $images += $canvas
}

$gifCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/gif'
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$saveFlag = [System.Drawing.Imaging.Encoder]::SaveFlag

# Hold each scene for roughly 0.85 seconds. GIF delays are expressed in 1/100s.
$delayBytes = New-Object byte[] ($images.Count * 4)
for ($index = 0; $index -lt $images.Count; $index++) {
  $delay = [BitConverter]::GetBytes([int64]85)
  [Array]::Copy($delay, 0, $delayBytes, $index * 4, 4)
}

$propertyItem = [System.Runtime.Serialization.FormatterServices]::GetUninitializedObject([System.Drawing.Imaging.PropertyItem])
$propertyItem.Id = 0x5100
$propertyItem.Type = 4
$propertyItem.Len = $delayBytes.Length
$propertyItem.Value = $delayBytes

foreach ($image in $images) {
  $image.SetPropertyItem($propertyItem)
}

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($saveFlag, [int64]18)
$images[0].Save($OutputPath, $gifCodec, $encoderParameters)

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($saveFlag, [int64]21)
for ($index = 1; $index -lt $images.Count; $index++) {
  $images[0].SaveAdd($images[$index], $encoderParameters)
}

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($saveFlag, [int64]20)
$images[0].SaveAdd($encoderParameters)

foreach ($image in $images) {
  $image.Dispose()
}

Write-Output "Created $OutputPath from $($frameFiles.Count) scenes."
