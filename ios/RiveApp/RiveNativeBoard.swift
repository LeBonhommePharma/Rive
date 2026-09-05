import SwiftUI
import RiveKit

/// Non-WebKit iPhone board: city chips, nearby rows, Aller. Not a planner.
struct RiveNativeBoard: View {
  @Environment(\.colorScheme) private var colorScheme
  @State private var city = BoardCity.quebec

  var body: some View {
    let tokens = RiveTokens.current(colorScheme)
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        RiveSheetHeader("Rive", subtitle: "Horaires sans abonnement. Apache 2.0.")
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 2) {
            ForEach(BoardCity.allCases) { item in
              RiveCityChip(item.label, selected: city == item) {
                city = item
              }
            }
          }
        }
        VStack(alignment: .leading, spacing: 0) {
          Text("près d'ici")
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .tracking(2)
            .foregroundStyle(tokens.muted)
            .padding(.bottom, 4)
          ForEach(Array(city.nearby.enumerated()), id: \.offset) { index, row in
            if index > 0 {
              tokens.hair.frame(height: 1)
            }
            RiveNearbyRow(
              stopName: row.stop,
              shortName: row.line,
              colorHex: row.color,
              textColorHex: row.ink,
              waitMinutes: row.wait,
              clocks: row.clocks
            )
          }
        }
        RiveAllerButton(title: "Aller", action: {})
      }
      .padding(16)
    }
    .background(tokens.paper.ignoresSafeArea())
  }
}

private struct NearbySample {
  var stop: String
  var line: String
  var color: String
  var ink: String
  var wait: Int
  var clocks: [String]
}

private enum BoardCity: String, CaseIterable, Identifiable {
  case quebec
  case levis
  case montreal
  case laval
  case longueuil
  case sherbrooke
  case troisRivieres = "trois-rivieres"

  var id: String { rawValue }

  var label: String {
    switch self {
    case .quebec:
      return "Québec"
    case .levis:
      return "Lévis"
    case .montreal:
      return "Montréal"
    case .laval:
      return "Laval"
    case .longueuil:
      return "Longueuil"
    case .sherbrooke:
      return "Sherbrooke"
    case .troisRivieres:
      return "Trois-Rivières"
    }
  }

  var nearby: [NearbySample] {
    switch self {
    case .quebec, .levis:
      return [
        NearbySample(
          stop: "D'Youville",
          line: "801",
          color: "#0071e3",
          ink: "#f0fdfa",
          wait: 4,
          clocks: ["16:04", "16:16"]
        ),
        NearbySample(
          stop: "Jean-Talon / Charest",
          line: "800",
          color: "#0071e3",
          ink: "#f0fdfa",
          wait: 9,
          clocks: ["16:11", "16:23"]
        ),
      ]
    case .montreal, .laval, .longueuil:
      return [
        NearbySample(
          stop: "Station Berri-UQAM",
          line: "1",
          color: "#00A651",
          ink: "#f0fdfa",
          wait: 3,
          clocks: ["16:04", "16:12"]
        ),
        NearbySample(
          stop: "McGill",
          line: "24",
          color: "#009EE0",
          ink: "#f0fdfa",
          wait: 6,
          clocks: ["16:08", "16:20"]
        ),
      ]
    case .sherbrooke:
      return [
        NearbySample(
          stop: "Terminus 13e Avenue",
          line: "4",
          color: "#0e7490",
          ink: "#f0fdfa",
          wait: 5,
          clocks: ["16:07", "16:22"]
        ),
      ]
    case .troisRivieres:
      return [
        NearbySample(
          stop: "Terminus UQTR",
          line: "1",
          color: "#0e7490",
          ink: "#f0fdfa",
          wait: 8,
          clocks: ["16:12", "16:27"]
        ),
      ]
    }
  }
}
