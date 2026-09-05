import SwiftUI
import RiveKit

/// Not a cloned phone app. A pulse the iPhone pushes to the Watch.
public struct WatchPulseView: View {
  public var live: LiveDeparture
  @State private var beat = false

  public init(live: LiveDeparture) {
    self.live = live
  }

  public var body: some View {
    let tokens = RiveTokens.night
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let remain = live.remainMinutes(at: context.date)
      ZStack {
        tokens.paper.ignoresSafeArea()
        Circle()
          .fill(Color(hex: live.colorHex).opacity(beat ? 0.55 : 0.22))
          .scaleEffect(beat ? 1.08 : 0.92)
          .blur(radius: tokens.blur)
        VStack(spacing: 2) {
          Text(live.routeShortName)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(tokens.ink)
          Text(remain == 0 ? "now" : "\(remain)")
            .font(.system(size: remain > 99 ? 36 : 52, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(0.5)
            .foregroundStyle(tokens.gold)
          Text(live.stopName)
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .foregroundStyle(tokens.muted)
          Text(live.clocks.prefix(3).joined(separator: "  "))
            .font(.system(size: 10, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(tokens.sodium)
        }
        .padding(8)
      }
      .onChange(of: remain) { _, _ in
        withAnimation(.easeInOut(duration: 0.8)) { beat.toggle() }
      }
    }
  }
}
