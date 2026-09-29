// Minimal ImageCaptureCore scanner CLI (macOS scanning for Pupa Counter).
// usage: icscan list | icscan scan <outPath.png> <dpi> [color|gray]
// Prints exactly one JSON line on stdout.
//   list -> {"ok":true,"devices":[{"name":...,"id":...}]}
//   scan -> {"ok":true,"path":...,"width":N,"height":N,"dpi":N,"requestedDpi":N,
//            "physicalWidthIn":F,"physicalHeightIn":F,"mode":"color"|"grayscale"}
// Build: swiftc -O icscan.swift -o icscan   (npm run build:icscan)
import Foundation
import ImageCaptureCore
import AppKit

final class S: NSObject, ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
    let browser = ICDeviceBrowser()
    var mode = "list"; var out = ""; var dpi = 300; var gray = false
    var physW = 0.0; var physH = 0.0
    var dev: ICScannerDevice?
    var found: [ICScannerDevice] = []
    func start() {
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue:
            ICDeviceTypeMask.scanner.rawValue | ICDeviceLocationTypeMask.local.rawValue | ICDeviceLocationTypeMask.shared.rawValue | ICDeviceLocationTypeMask.bonjour.rawValue)!
        browser.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            if self.mode == "list" { self.emit(["ok": true, "devices": self.found.map { ["name": $0.name ?? "", "id": $0.uuidString ?? ""] }]); exit(0) }
            if self.dev == nil { self.emit(["ok": false, "error": "no scanner found"]); exit(1) }
        }
    }
    func emit(_ o: [String: Any]) {
        let d = try! JSONSerialization.data(withJSONObject: o); print(String(data: d, encoding: .utf8)!); fflush(stdout)
    }
    func deviceBrowser(_ b: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let sc = device as? ICScannerDevice else { return }
        found.append(sc)
        if mode == "scan" && dev == nil {
            dev = sc; sc.delegate = self; sc.requestOpenSession()
        }
    }
    func deviceBrowser(_ b: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {}
    func didRemove(_ device: ICDevice) {}
    func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {}
    func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
        if let e = error { emit(["ok": false, "error": "open: \(e)"]); exit(1) }
        guard let sc = dev else { return }
        sc.transferMode = .fileBased
        let url = URL(fileURLWithPath: out)
        sc.downloadsDirectory = url.deletingLastPathComponent()
        sc.documentName = url.deletingPathExtension().lastPathComponent
        sc.documentUTI = "public.png"
        // pick flatbed functional unit
        if let fu = sc.availableFunctionalUnitTypes.first(where: { $0.intValue == ICScannerFunctionalUnitType.flatbed.rawValue }) {
            sc.requestSelect(ICScannerFunctionalUnitType(rawValue: UInt(fu.intValue))!)
        } else { configureAndScan() }
    }
    func scannerDevice(_ scanner: ICScannerDevice, didSelect functionalUnit: ICScannerFunctionalUnit, error: Error?) { configureAndScan() }
    func configureAndScan() {
        guard let sc = dev, let fu = sc.selectedFunctionalUnit as ICScannerFunctionalUnit? else { return }
        let supported = fu.supportedResolutions
        var chosen = dpi
        if !supported.contains(dpi) {
            chosen = supported.min(by: { abs($0 - dpi) < abs($1 - dpi) }) ?? dpi
        }
        fu.resolution = chosen
        fu.pixelDataType = gray ? .gray : .RGB
        fu.bitDepth = .depth8Bits
        let size = fu.physicalSize // in measurementUnit
        fu.scanArea = NSRect(x: 0, y: 0, width: size.width, height: size.height)
        let perInch: Double
        switch fu.measurementUnit {
        case .inches: perInch = 1
        case .centimeters: perInch = 2.54
        case .picas: perInch = 6
        case .points: perInch = 72
        case .twips: perInch = 1440
        default: perInch = 0
        }
        if perInch > 0 { physW = Double(size.width) / perInch; physH = Double(size.height) / perInch }
        FileHandle.standardError.write("resolution requested=\(dpi) set=\(fu.resolution) supported=\(Array(supported).prefix(40)) physical=\(size) unit=\(fu.measurementUnit.rawValue)\n".data(using: .utf8)!)
        sc.requestScan()
    }
    func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        let final = URL(fileURLWithPath: out)
        if url.path != final.path { try? FileManager.default.removeItem(at: final); try? FileManager.default.moveItem(at: url, to: final) }
    }
    func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: Error?) {
        if let e = error { emit(["ok": false, "error": "scan: \(e)"]); exit(1) }
        var w = 0, h = 0
        if let rep = NSImageRep(contentsOfFile: out) { w = rep.pixelsWide; h = rep.pixelsHigh }
        emit(["ok": true, "path": out, "width": w, "height": h, "dpi": scanner.selectedFunctionalUnit.resolution,
              "requestedDpi": dpi, "physicalWidthIn": physW, "physicalHeightIn": physH,
              "mode": gray ? "grayscale" : "color"])
        exit(0)
    }
}
let s = S()
let a = CommandLine.arguments
if a.count >= 2 && a[1] == "scan" && a.count >= 4 { s.mode = "scan"; s.out = a[2]; s.dpi = Int(a[3]) ?? 300; s.gray = a.count > 4 && a[4] == "gray" }
s.start()
RunLoop.main.run()
