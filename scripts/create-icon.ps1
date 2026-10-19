Add-Type -AssemblyName System.Drawing
$assetRoot = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0053fd'))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),14
$graphics.DrawRectangle($pen,64,96,96,96)
$graphics.DrawRectangle($pen,96,64,96,96)
$bitmap.Save((Join-Path $assetRoot 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
$bytes=$stream.ToArray()
$file=[System.IO.File]::Create((Join-Path $assetRoot 'icon.ico'))
$writer=New-Object System.IO.BinaryWriter $file
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]22)
$writer.Write($bytes);$writer.Dispose();$stream.Dispose();$pen.Dispose();$graphics.Dispose();$bitmap.Dispose()
