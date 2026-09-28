import SwiftUI

/// Walk / bike / road / transit. Switch every case; do not leave one unhandled.
public enum RiveLegKind: String, Sendable, Hashable, CaseIterable {
  case walk
  case bike
  case road
  case transit

  public var accessLabel: String {
    switch self {
    case .walk:
      return "à pied"
    case .bike:
      return "vélo"
    case .road:
      return "auto"
    case .transit:
      return ""
    }
  }
}

/// Official line lozenge. Colors come from GTFS, parsed with `Color(hex:)`.
public struct RiveLineChip: View {
  public var shortName: String
  public var colorHex: String
  public var textColorHex: String

  public init(shortName: String, colorHex: String, textColorHex: String = "#f0fdfa") {
    self.shortName = shortName
    self.colorHex = colorHex
    self.textColorHex = textColorHex
  }

  public var body: some View {
    Text(shortName)
      .font(.system(size: 12, weight: .bold, design: .rounded))
      .monospacedDigit()
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .frame(minWidth: 42)
      .foregroundStyle(Color(hex: textColorHex))
      .background(Color(hex: colorHex))
      .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
  }
}

/// Fat primary CTA. Title defaults to **Aller** (never a GO label).
public struct RiveAllerButton: View {
  @Environment(\.colorScheme) private var colorScheme

  public var title: String
  public var action: () -> Void

  public init(title: String = "Aller", action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  public var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    Button(action: action) {
      Text(title)
        .font(.system(size: 17, weight: .bold, design: .rounded))
        .tracking(1.4)
        .frame(maxWidth: .infinity)
        .frame(minHeight: 52)
        .foregroundStyle(tokens.chipInk)
        .background(tokens.chip)
        .clipShape(RoundedRectangle(cornerRadius: tokens.radius, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }
}

/// One itinerary leg: access tag or line chip, plus clock times.
public struct RiveItineraryStep: View {
  @Environment(\.colorScheme) private var colorScheme

  public var kind: RiveLegKind
  public var label: String
  public var shortName: String
  public var colorHex: String
  public var textColorHex: String
  public var clocks: [String]

  public init(
    kind: RiveLegKind,
    label: String,
    shortName: String = "",
    colorHex: String = "#0e7490",
    textColorHex: String = "#f0fdfa",
    clocks: [String] = []
  ) {
    self.kind = kind
    self.label = label
    self.shortName = shortName
    self.colorHex = colorHex
    self.textColorHex = textColorHex
    self.clocks = clocks
  }

  public var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    HStack(alignment: .top, spacing: 10) {
      mark(tokens: tokens)
      VStack(alignment: .leading, spacing: 3) {
        Text(label)
          .font(.system(size: 14, weight: .medium, design: .rounded))
          .foregroundStyle(tokens.ink)
          .fixedSize(horizontal: false, vertical: true)
        if !clocks.isEmpty {
          Text(clocks.joined(separator: "  →  "))
            .font(.system(size: 11.5, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(tokens.muted)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 9)
  }

  @ViewBuilder
  private func mark(tokens: RiveTokens) -> some View {
    switch kind {
    case .walk:
      accessChip(tokens: tokens, text: RiveLegKind.walk.accessLabel)
    case .bike:
      accessChip(tokens: tokens, text: RiveLegKind.bike.accessLabel)
    case .road:
      accessChip(tokens: tokens, text: RiveLegKind.road.accessLabel)
    case .transit:
      RiveLineChip(shortName: shortName, colorHex: colorHex, textColorHex: textColorHex)
    }
  }

  private func accessChip(tokens: RiveTokens, text: String) -> some View {
    Text(text)
      .font(.system(size: 10.5, weight: .medium, design: .rounded))
      .tracking(0.6)
      .padding(.horizontal, 7)
      .padding(.vertical, 5)
      .frame(minWidth: 42)
      .foregroundStyle(tokens.muted)
      .overlay(
        RoundedRectangle(cornerRadius: tokens.radiusMd, style: .continuous)
          .stroke(tokens.hair, lineWidth: 1)
      )
  }
}

/// Nearby stop: line chip, wait minutes, clock times.
public struct RiveNearbyRow: View {
  @Environment(\.colorScheme) private var colorScheme

  public var stopName: String
  public var shortName: String
  public var colorHex: String
  public var textColorHex: String
  public var waitMinutes: Int
  public var clocks: [String]

  public init(
    stopName: String,
    shortName: String,
    colorHex: String,
    textColorHex: String = "#f0fdfa",
    waitMinutes: Int,
    clocks: [String]
  ) {
    self.stopName = stopName
    self.shortName = shortName
    self.colorHex = colorHex
    self.textColorHex = textColorHex
    self.waitMinutes = waitMinutes
    self.clocks = clocks
  }

  public var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    HStack(alignment: .top, spacing: 10) {
      RiveLineChip(shortName: shortName, colorHex: colorHex, textColorHex: textColorHex)
      VStack(alignment: .leading, spacing: 3) {
        Text(waitLabel)
          .font(.system(size: 19, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(tokens.sodium)
        Text(stopName)
          .font(.system(size: 14, weight: .medium, design: .rounded))
          .foregroundStyle(tokens.ink)
          .fixedSize(horizontal: false, vertical: true)
        if !clocks.isEmpty {
          Text(clocks.joined(separator: "  "))
            .font(.system(size: 11.5, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(tokens.muted)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 9)
  }

  private var waitLabel: String {
    waitMinutes == 0 ? "now" : "\(waitMinutes) min"
  }
}

/// City switcher chip. Selected uses chip/sodium; idle uses muted.
public struct RiveCityChip: View {
  @Environment(\.colorScheme) private var colorScheme

  public var title: String
  public var selected: Bool
  public var action: () -> Void

  public init(_ title: String, selected: Bool, action: @escaping () -> Void) {
    self.title = title
    self.selected = selected
    self.action = action
  }

  public var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    Button(action: action) {
      Text(title)
        .font(.system(size: 12.5, weight: selected ? .bold : .medium, design: .rounded))
        .padding(.horizontal, 12)
        .frame(height: 44)
        .foregroundStyle(selected ? tokens.chipInk : tokens.muted)
        .background(selected ? tokens.chip : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: tokens.radiusMd, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// Sheet title + muted lead, matching the web atlas header.
public struct RiveSheetHeader: View {
  @Environment(\.colorScheme) private var colorScheme

  public var title: String
  public var subtitle: String

  public init(_ title: String, subtitle: String) {
    self.title = title
    self.subtitle = subtitle
  }

  public var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.system(size: 19, weight: .bold, design: .rounded))
        .foregroundStyle(tokens.ink)
      Text(subtitle)
        .font(.system(size: 12.5, weight: .regular, design: .rounded))
        .foregroundStyle(tokens.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
