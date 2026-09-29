import SwiftUI

@main
struct RiveApp: App {
  @State private var store = TransitStore()

  var body: some Scene {
    WindowGroup {
      RiveRootView()
        .environment(store)
        .tint(Color(red: 0.04, green: 0.40, blue: 0.38))
        .task { await store.start() }
        .task(id: store.cityID) { await store.loadCity() }
    }
  }
}
