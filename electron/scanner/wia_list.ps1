#Requires -Version 5.1
# Enumerate WIA scanners. Emits one JSON line on stdout.
# Success: {"ok":true,"devices":[{"id":"...","name":"...","manufacturer":"...","description":"..."}]}
# Failure: {"ok":false,"error":"..."}
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $devices = @()
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $d = $dm.DeviceInfos.Item($i)
        function Get-Prop($name) {
            try { $d.Properties.Item($name).Value } catch { "" }
        }
        $devices += [ordered]@{
            id           = $d.DeviceID
            name         = (Get-Prop "Name")
            description  = (Get-Prop "Description")
            manufacturer = (Get-Prop "Manufacturer")
        }
    }
    ([ordered]@{ ok = $true; devices = $devices } | ConvertTo-Json -Depth 5 -Compress)
} catch {
    ([ordered]@{ ok = $false; error = ("{0}: {1}" -f $_.Exception.GetType().Name, $_.Exception.Message) } | ConvertTo-Json -Compress)
    exit 1
}
