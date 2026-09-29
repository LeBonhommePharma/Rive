import SwiftUI
import RiveKit

struct RiveRootView: View {
  @Environment(TransitStore.self) private var store

  var body: some View {
    TabView {
      NavigationStack { ExploreView() }
        .tabItem { Label("Explorer", systemImage: "map") }
      NavigationStack { FavoritesView() }
        .tabItem { Label("Favoris", systemImage: "star") }
      NavigationStack { JourneyView() }
        .tabItem { Label("Trajet", systemImage: "arrow.triangle.turn.up.right.diamond") }
      NavigationStack { AboutView() }
        .tabItem { Label("À propos", systemImage: "info.circle") }
    }
  }
}
