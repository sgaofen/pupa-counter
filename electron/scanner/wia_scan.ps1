#Requires -Version 5.1
# Execute one WIA scan, save as PNG. Emits one JSON line on stdout.
# Success: {"ok":true,"path":"...","width":N,"height":N,"requestedDpi":N,
#           "actualDpi":N,"readbackDpi":N|null,"imageDpi":N|null,
#           "mode":"...","warnings":[...]}
# Failure: {"ok":false,"error":"..."}
#
# History: the v0.4 script wrapped every property write in try { } catch { }
# and set "Current Intent" AFTER the resolution. On the lab's LiDE 300 the
# intent write resets the resolution to the driver default (150 DPI), and
# any failure was swallowed, so every scan came back 1240x1753 (150 DPI)
# while the app believed it was 300. This version:
#   * sets properties by numeric WIA property ID (names differ by driver),
#   * sets intent FIRST, then resolution, then the scan window,
#   * reads every value back and reports failures as warnings,
#   * derives the DPI that was actually delivered from the image itself.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DeviceId,
    [Parameter(Mandatory=$true)][string]$OutPath,
    [int]$Dpi = 150,
    [ValidateSet("color","grayscale")][string]$Mode = "color"
)
$ErrorActionPreference = "Stop"

$WIA_FMT_PNG = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"

# WIA item property IDs (wiadef.h)
$WIA_IPS_CUR_INTENT   = 6146
$WIA_IPS_XRES         = 6147
$WIA_IPS_YRES         = 6148
$WIA_IPS_XPOS         = 6149
$WIA_IPS_YPOS         = 6150
$WIA_IPS_XEXTENT      = 6151
$WIA_IPS_YEXTENT      = 6152

# The scan window we request: A4 portrait.
$A4_W_IN = 8.27
$A4_H_IN = 11.69

$warnings = New-Object System.Collections.ArrayList

function Find-Prop($item, [int]$id) {
    foreach ($p in $item.Properties) {
        if ($p.PropertyID -eq $id) { return $p }
    }
    return $null
}

function Get-PropValue($item, [int]$id) {
    $p = Find-Prop $item $id
    if ($null -eq $p) { return $null }
    try { return $p.Value } catch { return $null }
}

function Set-Prop($item, [int]$id, $value, [string]$label) {
    $p = Find-Prop $item $id
    if ($null -eq $p) {
        [void]$warnings.Add("property $label ($id) not exposed by this driver")
        return $false
    }
    try {
        $p.Value = $value
    } catch {
        [void]$warnings.Add("could not set $label ($id) = ${value}: $($_.Exception.Message)")
        return $false
    }
    $back = $null
    try { $back = $p.Value } catch { }
    if ($null -ne $back -and "$back" -ne "$value") {
        [void]$warnings.Add("$label ($id) read back as $back after setting $value")
        return $false
    }
    return $true
}

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

    # 1) Intent first: on many drivers writing the intent resets resolution
    #    and scan window to the intent's defaults.
    $intent = if ($Mode -eq "grayscale") { 2 } else { 1 }
    [void](Set-Prop $item $WIA_IPS_CUR_INTENT $intent "intent")

    # 2) Resolution.
    [void](Set-Prop $item $WIA_IPS_XRES $Dpi "horizontal resolution")
    [void](Set-Prop $item $WIA_IPS_YRES $Dpi "vertical resolution")

    # 3) Scan window, in pixels at the new resolution.
    [void](Set-Prop $item $WIA_IPS_XPOS 0 "horizontal start")
    [void](Set-Prop $item $WIA_IPS_YPOS 0 "vertical start")
    $extW = [int][math]::Round($A4_W_IN * $Dpi)
    $extH = [int][math]::Round($A4_H_IN * $Dpi)
    [void](Set-Prop $item $WIA_IPS_XEXTENT $extW "horizontal extent")
    [void](Set-Prop $item $WIA_IPS_YEXTENT $extH "vertical extent")

    $readbackX = Get-PropValue $item $WIA_IPS_XRES
    $readbackY = Get-PropValue $item $WIA_IPS_YRES

    $image = $null
    try {
        $image = $item.Transfer($WIA_FMT_PNG)
    } catch {
        [void]$warnings.Add("PNG transfer unsupported, used driver default format")
        $image = $item.Transfer()
    }

    $outDir = Split-Path -Parent $OutPath
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    if (Test-Path $OutPath) { Remove-Item $OutPath -Force }
    $image.SaveFile($OutPath)

    $w = [int]$image.Width
    $h = [int]$image.Height
    $imageDpi = $null
    try { $imageDpi = [double]$image.HorizontalResolution } catch { }

    # DPI actually delivered, from the pixel width of the A4 window.
    $pixelDpi = [int][math]::Round($w / $A4_W_IN)

    ([ordered]@{
        ok           = $true
        path         = $OutPath
        width        = $w
        height       = $h
        requestedDpi = $Dpi
        actualDpi    = $pixelDpi
        readbackDpi  = $readbackX
        readbackDpiY = $readbackY
        imageDpi     = $imageDpi
        dpi          = $pixelDpi
        mode         = $Mode
        warnings     = @($warnings)
    } | ConvertTo-Json -Compress -Depth 4)
} catch {
    ([ordered]@{
        ok    = $false
        error = ("{0}: {1}" -f $_.Exception.GetType().Name, $_.Exception.Message)
        warnings = @($warnings)
    } | ConvertTo-Json -Compress -Depth 4)
    exit 1
}
