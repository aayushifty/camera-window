# Draws the HENSHIN app icon (256 px) and writes launcher/henshin.ico + public/icon.png
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$S = 256
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

# rounded dark tile
$r = 56
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($S - $r, 0, $r, $r, 270, 90)
$path.AddArc($S - $r, $S - $r, $r, $r, 0, 90); $path.AddArc(0, $S - $r, $r, $r, 90, 90); $path.CloseFigure()
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $S, $S), ([System.Drawing.Color]::FromArgb(255, 18, 8, 34)), ([System.Drawing.Color]::FromArgb(255, 6, 4, 12))
$g.FillPath($bg, $path)

# neon frame (perspective quad) — glow passes then core line
$quad = [System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF 44, 70), (New-Object System.Drawing.PointF 212, 58),
  (New-Object System.Drawing.PointF 212, 198), (New-Object System.Drawing.PointF 44, 186))
foreach ($w in 22, 14, 8) {
  $p = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 120, 220, 255)), $w
  $p.LineJoin = 'Round'; $g.DrawPolygon($p, $quad)
}
$core = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 150, 235, 255)), 4
$core.LineJoin = 'Round'; $g.DrawPolygon($core, $quad)

# two glowing eyes: red (web) left, blue (awaken) right
function Eye($cx, $cy, $c) {
  foreach ($k in 34, 24, 16) {
    $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, $c.R, $c.G, $c.B))
    $g.FillEllipse($b, $cx - $k, $cy - $k * 0.55, 2 * $k, 2 * $k * 0.55)
  }
  $w = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $g.FillEllipse($w, $cx - 11, $cy - 6, 22, 12)
}
Eye 96 128 ([System.Drawing.Color]::FromArgb(255, 255, 40, 70))
Eye 160 128 ([System.Drawing.Color]::FromArgb(255, 70, 160, 255))
$g.Dispose()

New-Item -ItemType Directory -Force (Join-Path $root 'public') | Out-Null
$png = Join-Path $root 'public\icon.png'
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ICO container holding the 256 px PNG (supported since Windows Vista)
$bytes = [System.IO.File]::ReadAllBytes($png)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$bytes.Length); $bw.Write([UInt32]22)
$bw.Write($bytes); $bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'henshin.ico'), $ms.ToArray())
'icon written'
