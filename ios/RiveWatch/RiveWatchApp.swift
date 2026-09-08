import SwiftUI
import Combine
import RiveKit
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// Native Apple Watch entry point. The iPhone publishes the active stop/route;
/// the Watch receives it, caches it, and renders it immediately on next launch.
@main
struct RiveWatchApp: App {
  @StateObject private var store = WatchDepartureStore()

  var body: some Scene {
    WindowGroup {
      if let live = store.live {
        WatchPulseView(live: live)
      } else {
        WatchIdleView()
      }
    }
  }
}

private struct WatchIdleView: View {
  var body: some View {
    let tokens = RiveTokens.night
    ZStack {
      tokens.paper.ignoresSafeArea()
      VStack(spacing: 6) {
        Text("Rive")
          .font(.system(size: 24, weight: .bold, design: .rounded))
          .foregroundStyle(tokens.ink)
        Text("Ouvre un arrêt sur l’iPhone")
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .multilineTextAlignment(.center)
          .foregroundStyle(tokens.muted)
        Text("Il apparaîtra ici automatiquement.")
          .font(.system(size: 10, design: .rounded))
          .multilineTextAlignment(.center)
          .foregroundStyle(tokens.sodium)
      }
      .padding(12)
    }
  }
}

#if canImport(WatchConnectivity) && os(watchOS)
/// Watch-side inbox for the application context and low-latency tick sent by PhoneToWatch.
/// The last valid payload is persisted so launching RiveWatch is one tap even when the
/// phone is temporarily unreachable.
final class WatchDepartureStore: NSObject, ObservableObject, WCSessionDelegate, @unchecked Sendable {
  @Published private(set) var live: LiveDeparture?

  private static let cacheKey = "rive.watch.lastLiveDeparture"

  override init() {
    if let data = UserDefaults.standard.data(forKey: Self.cacheKey) {
      live = try? JSONDecoder().decode(LiveDeparture.self, from: data)
    } else {
      live = nil
    }
    super.init()

    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  private func apply(_ payload: [String: Any]) {
    if payload["end"] as? Bool == true {
      clear()
      return
    }

    let data = (payload["live"] as? Data) ?? (payload["tick"] as? Data)
    guard let data, !data.isEmpty,
      let decoded = try? JSONDecoder().decode(LiveDeparture.self, from: data)
    else { return }

    DispatchQueue.main.async { [weak self] in
      self?.live = decoded
      UserDefaults.standard.set(data, forKey: Self.cacheKey)
    }
  }

  private func clear() {
    DispatchQueue.main.async { [weak self] in
      self?.live = nil
      UserDefaults.standard.removeObject(forKey: Self.cacheKey)
    }
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated else { return }
    apply(session.receivedApplicationContext)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(message)
  }
}
#else
final class WatchDepartureStore: ObservableObject {
  @Published private(set) var live: LiveDeparture? = nil
}
#endif
