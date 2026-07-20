Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot '..\src\assets\hero.png'
$outputPath = Join-Path $PSScriptRoot '..\public\social-preview.png'

$canvas = [System.Drawing.Bitmap]::new(1200, 630, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$hero = $null
$resources = [System.Collections.Generic.List[object]]::new()

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::FromArgb(9, 9, 9))

  $glowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(32, 199, 162, 88))
  $resources.Add($glowBrush)
  $graphics.FillEllipse($glowBrush, 760, -150, 560, 560)

  $gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(20, 245, 242, 234), 1)
  $resources.Add($gridPen)
  for ($x = 0; $x -le 1200; $x += 84) { $graphics.DrawLine($gridPen, $x, 0, $x, 630) }
  for ($y = 0; $y -le 630; $y += 84) { $graphics.DrawLine($gridPen, 0, $y, 1200, $y) }

  $chalkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(205, 245, 242, 234), 3)
  $goldPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(220, 199, 162, 88), 3)
  $bluePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(180, 126, 191, 255), 2)
  $resources.Add($chalkPen)
  $resources.Add($goldPen)
  $resources.Add($bluePen)

  $graphics.DrawBezier($chalkPen, [System.Drawing.PointF]::new(92, 430), [System.Drawing.PointF]::new(210, 330), [System.Drawing.PointF]::new(280, 520), [System.Drawing.PointF]::new(410, 388))
  $graphics.DrawLine($goldPen, 410, 388, 462, 388)
  $graphics.DrawLine($goldPen, 446, 372, 462, 388)
  $graphics.DrawLine($goldPen, 446, 404, 462, 388)
  $graphics.DrawEllipse($bluePen, 160, 180, 112, 112)
  $graphics.DrawLine($bluePen, 216, 180, 216, 148)
  $graphics.DrawLine($bluePen, 272, 236, 310, 236)
  $graphics.DrawLine($bluePen, 216, 292, 216, 326)
  $graphics.DrawLine($bluePen, 160, 236, 124, 236)

  $eyebrowFont = [System.Drawing.Font]::new('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $titleFont = [System.Drawing.Font]::new('Georgia', 52, [System.Drawing.FontStyle]::Regular)
  $accentFont = [System.Drawing.Font]::new('Georgia', 52, [System.Drawing.FontStyle]::Italic)
  $copyFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Regular)
  $resources.Add($eyebrowFont)
  $resources.Add($titleFont)
  $resources.Add($accentFont)
  $resources.Add($copyFont)

  $mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(166, 162, 154))
  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 242, 234))
  $goldBrushText = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(227, 199, 126))
  $resources.Add($mutedBrush)
  $resources.Add($whiteBrush)
  $resources.Add($goldBrushText)

  $graphics.DrawString('CHALKBOARD / SHARED WORKSPACE', $eyebrowFont, $goldBrushText, 78, 72)
  $graphics.DrawString('Make ideas', $titleFont, $whiteBrush, 74, 142)
  $graphics.DrawString('visible.', $accentFont, $goldBrushText, 74, 208)
  $graphics.DrawString('A live canvas for thinking together.', $copyFont, $mutedBrush, 80, 316)
  $graphics.DrawString('DRAW  /  MAP  /  MOVE TOGETHER', $eyebrowFont, $mutedBrush, 80, 555)

  $hero = [System.Drawing.Image]::FromFile($sourcePath)
  $heroBounds = [System.Drawing.Rectangle]::new(760, 128, 360, 379)
  $graphics.DrawImage($hero, $heroBounds)
  $graphics.DrawString('LIVE / 01', $eyebrowFont, $whiteBrush, 900, 544)

  $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  if ($hero) { $hero.Dispose() }
  foreach ($resource in $resources) { $resource.Dispose() }
  $graphics.Dispose()
  $canvas.Dispose()
}
