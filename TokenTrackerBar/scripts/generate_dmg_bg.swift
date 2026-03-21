#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

// ==========================================================
// DMG Background — TokenTracker
// Inspired by Sketch/Linear DMG: clean, refined, professional
//
// Coordinate system:
//   Finder: 660x400, Y=0 at TOP
//   CG:     1320x800 @2x, Y=0 at BOTTOM
//   Convert: cg_y = (400 - finder_y) * 2
//
//   App icon:     Finder(170, 200) → CG(340, 400)
//   Apps folder:  Finder(490, 200) → CG(980, 400)
// ==========================================================

let W: CGFloat = 1320
let H: CGFloat = 800

// Icon centers in CG coords
let appCX: CGFloat = 340
let appsCX: CGFloat = 980
let iconCY: CGFloat = 400

let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(W), pixelsHigh: Int(H),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!

NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext
let cs = CGColorSpaceCreateDeviceRGB()

// ── 1. Background — soft warm white gradient ──
let c1 = NSColor(red: 0.976, green: 0.973, blue: 0.969, alpha: 1).cgColor  // top: warm white
let c2 = NSColor(red: 0.945, green: 0.937, blue: 0.929, alpha: 1).cgColor  // bottom: slightly warm
let bg = CGGradient(colorsSpace: cs, colors: [c1, c2] as CFArray, locations: [0, 1])!
cg.drawLinearGradient(bg, start: CGPoint(x: 0, y: H), end: .zero, options: [])

// ── 2. Very subtle noise-like dot pattern for depth ──
cg.saveGState()
let dotColor = NSColor(white: 0.0, alpha: 0.012).cgColor
cg.setFillColor(dotColor)
for x in stride(from: CGFloat(0), through: W, by: 20) {
    for y in stride(from: CGFloat(0), through: H, by: 20) {
        cg.fillEllipse(in: CGRect(x: x - 0.75, y: y - 0.75, width: 1.5, height: 1.5))
    }
}
cg.restoreGState()

// ── 3. Soft light pools behind icon positions ──
func radialGlow(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ alpha: CGFloat) {
    let g = CGGradient(colorsSpace: cs,
        colors: [NSColor(white: 1, alpha: alpha).cgColor,
                 NSColor(white: 1, alpha: 0).cgColor] as CFArray, locations: [0, 1])!
    cg.saveGState()
    cg.drawRadialGradient(g, startCenter: CGPoint(x: cx, y: cy), startRadius: 0,
                          endCenter: CGPoint(x: cx, y: cy), endRadius: r, options: [])
    cg.restoreGState()
}
radialGlow(appCX, iconCY, 180, 0.5)
radialGlow(appsCX, iconCY, 180, 0.5)

// ── 4. THE ARROW — elegant dashed arc with arrowhead ──
// Curved path from app to Applications, slightly arching upward
let arrowColor = NSColor(red: 0.30, green: 0.35, blue: 0.45, alpha: 0.50)

cg.saveGState()
cg.setStrokeColor(arrowColor.cgColor)
cg.setLineWidth(4.0)
cg.setLineCap(.round)
cg.setLineDash(phase: 0, lengths: [12, 8])

// Bezier curve arching slightly above center
let startX = appCX + 150
let endX = appsCX - 150
let controlY = iconCY + 80  // arch upward (CG coords, + is up)

let arrowPath = CGMutablePath()
arrowPath.move(to: CGPoint(x: startX, y: iconCY))
arrowPath.addQuadCurve(to: CGPoint(x: endX, y: iconCY),
                       control: CGPoint(x: (startX + endX) / 2, y: controlY))
cg.addPath(arrowPath)
cg.strokePath()

// Solid arrowhead at the end (no dash)
cg.setLineDash(phase: 0, lengths: [])
cg.setFillColor(arrowColor.cgColor)
cg.setLineWidth(3.5)

// Calculate tangent direction at end of curve for proper arrowhead angle
let t: CGFloat = 0.95
let tangentX = 2 * (1 - t) * ((startX + endX) / 2 - startX) + 2 * t * (endX - (startX + endX) / 2)
let tangentY = 2 * (1 - t) * (controlY - iconCY) + 2 * t * (iconCY - controlY)
let angle = atan2(tangentY, tangentX)

let headLen: CGFloat = 28
let headWidth: CGFloat = 12
let tipX = endX
let tipY = iconCY

let head = CGMutablePath()
head.move(to: CGPoint(x: tipX, y: tipY))
head.addLine(to: CGPoint(x: tipX - headLen * cos(angle) + headWidth * sin(angle),
                         y: tipY - headLen * sin(angle) - headWidth * cos(angle)))
head.addLine(to: CGPoint(x: tipX - headLen * cos(angle) - headWidth * sin(angle),
                         y: tipY - headLen * sin(angle) + headWidth * cos(angle)))
head.closeSubpath()
cg.addPath(head)
cg.fillPath()
cg.restoreGState()

// ── 5. Bottom section — thin separator + text ──
let paraStyle = NSMutableParagraphStyle()
paraStyle.alignment = .center

// Thin separator line
let sepY: CGFloat = 150
cg.setFillColor(NSColor(white: 0.0, alpha: 0.06).cgColor)
cg.fill(CGRect(x: W / 2 - 180, y: sepY, width: 360, height: 1))

// Instruction text
("Drag to Applications to install" as NSString).draw(
    in: NSRect(x: 0, y: 80, width: W, height: 44),
    withAttributes: [
        .font: NSFont.systemFont(ofSize: 22, weight: .regular),
        .foregroundColor: NSColor(red: 0.30, green: 0.30, blue: 0.34, alpha: 0.65),
        .paragraphStyle: paraStyle,
        .kern: 0.3 as NSNumber
    ])

// Brand wordmark
("TOKENTRACKER" as NSString).draw(
    in: NSRect(x: 0, y: 40, width: W, height: 24),
    withAttributes: [
        .font: NSFont.systemFont(ofSize: 13, weight: .medium),
        .foregroundColor: NSColor(white: 0.45, alpha: 0.35),
        .paragraphStyle: paraStyle,
        .kern: 3.0 as NSNumber
    ])

NSGraphicsContext.restoreGraphicsState()

// Set 144 DPI for retina
rep.size = NSSize(width: Int(W) / 2, height: Int(H) / 2)

// Save
let out = URL(fileURLWithPath: CommandLine.arguments[0])
    .deletingLastPathComponent().appendingPathComponent("dmg-background.png")
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try! png.write(to: out)
print("Done: \(out.path)")
