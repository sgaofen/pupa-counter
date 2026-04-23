#Requires -Version 5.1
# Execute one WIA scan, save as PNG. Emits one JSON line on stdout.
# Success: {"ok":true,"path":"...","width":N,"height":N,"dpi":N,"mode":"..."}
# Failure: {"ok":false,"error":"..."}
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DeviceId,
    [Parameter(Mandatory=$true)][string]$OutPath,
    [int]$Dpi = 300,
    [ValidateSet("color","grayscale")][string]$Mode = "color"
)
$ErrorActionPreference = "Stop"

# WIA ImageProcessFilter / FormatID GUIDs
$WIA_FMT_PNG = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"

try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $targetInfo = $null
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        if ($dm.DeviceInfos.Item($i).DeviceID -eq $DeviceId) {
            $targetInfo = $dm.DeviceInfos.Item($i); break
        }
    }
    if (-not $targetInfo) { throw "device not found: $DeviceId" }

    $device = $targetInfo.Connect()
    $item = $device.Items.Item(1)

    # Set resolution + color mode. Standard WIA property names.
    # Intent codes: 1 = Color Picture, 2 = Grayscale Picture.
    try { $item.Properties.Item("Horizontal Resolution").Value = $Dpi } catch { }
    try { $item.Properties.Item("Vertical Resolution").Value = $Dpi } catch { }
    $intent = if ($Mode -eq "grayscale") { 2 } else { 1 }
    try { $item.Properties.Item("Current Intent").Value = $intent } catch { }

    # Resize scan area to match the new DPI — some drivers keep extents in pixels
    # tied to the previous DPI so changing DPI can leave a tiny crop window.
    # A4 @ Dpi: width = 8.27" × Dpi, height = 11.69" × Dpi.
    try {
        $item.Properties.Item("Horizontal Extent").Value = [int]([math]::Round(8.27 * $Dpi))
        $item.Properties.Item("Vertical Extent").Value   = [int]([math]::Round(11.69 * $Dpi))
        $item.Properties.Item("Horizontal Start Position").Value = 0
        $item.Properties.Item("Vertical Start Position").Value   = 0
    } catch { }

    # Transfer as PNG. eSCL + many TWAIN drivers support PNG directly; if not,
    # fall back to default transfer + SaveFile extension-inferred conversion.
    $image = $null
    try {
        $image = $item.Transfer($WIA_FMT_PNG)
    } catch {
        $image = $item.Transfer()
    }

    $outDir = Split-Path -Parent $OutPath
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    if (Test-Path $OutPath) { Remove-Item $OutPath -Force }
    $image.SaveFile($OutPath)

    ([ordered]@{
        ok     = $true
        path   = $OutPath
        width  = [int]$image.Width
        height = [int]$image.Height
        dpi    = $Dpi
        mode   = $Mode
    } | ConvertTo-Json -Compress)
} catch {
    ([ordered]@{
        ok    = $false
        error = ("{0}: {1}" -f $_.Exception.GetType().Name, $_.Exception.Message)
    } | ConvertTo-Json -Compress)
    exit 1
}
