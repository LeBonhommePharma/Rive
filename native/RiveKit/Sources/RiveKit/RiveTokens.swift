import Foundation
import SwiftUI

public extension Color {
  /// Parse `#16202c`, `0e7490`, or `#0e7`. Used by line chips and live route color.
  init(hex: String) {
    var raw = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    if raw.count == 3 {
      raw = raw.map { "\($0)\($0)" }.joined()
    }
    var value: UInt64 = 0
    Scanner(string: raw).scanHexInt64(&value)
    let red: Double
    let green: Double
    let blue: Double
    let opacity: Double
    if raw.count == 8 {
      opacity = Double((value >> 24) & 0xFF) / 255
      red = Double((value >> 16) & 0xFF) / 255
      green = Double((value >> 8) & 0xFF) / 255
      blue = Double(value & 0xFF) / 255
    } else {
      opacity = 1
      red = Double((value >> 16) & 0xFF) / 255
      green = Double((value >> 8) & 0xFF) / 255
      blue = Double(value & 0xFF) / 255
    }
    self.init(red: red, green: green, blue: blue, opacity: opacity)
  }
}

/// Day/night tokens from `public/Transit/index.html`. Day is the default.
/// Terra is an accent (alerts), not primary chrome. Primary CTA uses chip/sodium.
public struct RiveTokens {
  public var ink: Color
  public var inkSoft: Color
  public var paper: Color
  public var sodium: Color
  public var gold: Color
  public var terra: Color
  public var chip: Color
  public var chipInk: Color
  public var muted: Color
  public var well: Color
  public var hair: Color
  public var radius: CGFloat
  public var radiusMd: CGFloat
  public var blur: CGFloat

  public static let radius: CGFloat = 12
  public static let radiusMd: CGFloat = 8
  public static let blur: CGFloat = 16

  /// `:root, html.day` — ink #16202c, paper #eef2f6, sodium #0e7490.
  public static let day = RiveTokens(
    ink: Color(hex: "#16202c"),
    inkSoft: Color(hex: "#55677a"),
    paper: Color(hex: "#eef2f6"),
    sodium: Color(hex: "#0e7490"),
    gold: Color(hex: "#a35a09"),
    terra: Color(hex: "#5B21B6"),
    chip: Color(hex: "#0e7490"),
    chipInk: Color(hex: "#f0fdfa"),
    muted: Color(hex: "#55677a"),
    well: Color(hex: "#0e7490").opacity(0.07),
    hair: Color(hex: "#0e7490").opacity(0.2),
    radius: 12,
    radiusMd: 8,
    blur: 16
  )

  /// `html.night` — ink #e4eef6, paper #08091A, sodium #45E0A8.
  public static let night = RiveTokens(
    ink: Color(hex: "#e4eef6"),
    inkSoft: Color(hex: "#8fa4b4"),
    paper: Color(hex: "#08091A"),
    sodium: Color(hex: "#45E0A8"),
    gold: Color(hex: "#FF9300"),
    terra: Color(hex: "#A78BFA"),
    chip: Color(hex: "#45E0A8"),
    chipInk: Color(hex: "#05222b"),
    muted: Color(hex: "#8fa4b4"),
    well: Color(hex: "#45E0A8").opacity(0.07),
    hair: Color(hex: "#45E0A8").opacity(0.18),
    radius: 12,
    radiusMd: 8,
    blur: 16
  )

  public static func current(_ scheme: ColorScheme) -> RiveTokens {
    switch scheme {
    case .dark:
      return night
    case .light:
      return day
    @unknown default:
      return day
    }
  }

  public static var ink: Color { day.ink }
  public static var inkSoft: Color { day.inkSoft }
  public static var paper: Color { day.paper }
  public static var sodium: Color { day.sodium }
  public static var gold: Color { day.gold }
  public static var terra: Color { day.terra }
  public static var chip: Color { day.chip }
  public static var chipInk: Color { day.chipInk }
  public static var muted: Color { day.muted }
  public static var well: Color { day.well }
  public static var hair: Color { day.hair }

  public init(
    ink: Color,
    inkSoft: Color,
    paper: Color,
    sodium: Color,
    gold: Color,
    terra: Color,
    chip: Color,
    chipInk: Color,
    muted: Color,
    well: Color,
    hair: Color,
    radius: CGFloat,
    radiusMd: CGFloat,
    blur: CGFloat
  ) {
    self.ink = ink
    self.inkSoft = inkSoft
    self.paper = paper
    self.sodium = sodium
    self.gold = gold
    self.terra = terra
    self.chip = chip
    self.chipInk = chipInk
    self.muted = muted
    self.well = well
    self.hair = hair
    self.radius = radius
    self.radiusMd = radiusMd
    self.blur = blur
  }
}
