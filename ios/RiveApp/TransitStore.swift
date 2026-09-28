import Foundation
import Observation
import RiveKit

@MainActor @Observable
final class TransitStore {
  private let defaults = UserDefaults.standard
  private let repository: TransitRepository
  var cities: [TransitCity] = []
  var cityID = "" {
    didSet { if !cityID.isEmpty { defaults.set(cityID, forKey: "rive.city") } }
  }
  private(set) var loaded: LoadedTransit?
  private(set) var revision = UUID()
  private(set) var isLoading = false
  private(set) var isRefreshing = false
  var errorMessage: String?
  private(set) var favorites: Set<String>
  var schedule: TransitSchedule? { loaded?.schedule }

  init() {
    favorites = Set(defaults.stringArray(forKey: "rive.favorites") ?? [])
    repository = TransitRepository(
      bundledDirectory: Bundle.main.resourceURL!.appendingPathComponent("data"),
      cacheDirectory: URL.cachesDirectory.appendingPathComponent("RiveSchedules", isDirectory: true))
  }

  func start() async {
    guard cities.isEmpty else { return }
    do {
      cities = try await repository.catalog()
      let saved = defaults.string(forKey: "rive.city") ?? "quebec"
      cityID = cities.contains(where: { $0.city == saved }) ? saved : (cities.first?.city ?? "")
    } catch { errorMessage = "Impossible d’ouvrir les horaires inclus dans Rive. \(error.localizedDescription)" }
  }

  func loadCity() async {
    let requested = cityID
    guard !requested.isEmpty else { return }
    loaded = nil
    errorMessage = nil
    isLoading = true
    isRefreshing = false
    defer { if cityID == requested { isLoading = false } }
    do {
      let value = try await repository.load(city: requested)
      guard cityID == requested, !Task.isCancelled else { return }
      loaded = value
      revision = UUID()
    } catch {
      guard cityID == requested, !Task.isCancelled else { return }
      errorMessage = error.localizedDescription
    }
  }

  func refresh() async {
    let requested = cityID
    guard !requested.isEmpty, !isRefreshing else { return }
    isRefreshing = true
    errorMessage = nil
    defer { if cityID == requested { isRefreshing = false } }
    do {
      let value = try await repository.refresh(city: requested)
      guard cityID == requested, !Task.isCancelled else { return }
      loaded = value
      revision = UUID()
    } catch {
      guard cityID == requested, !Task.isCancelled else { return }
      errorMessage = loaded == nil ? error.localizedDescription
        : "Mise à jour impossible. Les horaires téléchargés restent accessibles."
    }
  }

  func isFavorite(_ stop: TransitStop) -> Bool { favorites.contains("\(cityID)|\(stop.id)") }

  func toggleFavorite(_ stop: TransitStop) {
    let key = "\(cityID)|\(stop.id)"
    if favorites.contains(key) { favorites.remove(key) } else { favorites.insert(key) }
    defaults.set(favorites.sorted(), forKey: "rive.favorites")
  }

  func clearPersonalData() {
    favorites.removeAll()
    defaults.removeObject(forKey: "rive.favorites")
    defaults.removeObject(forKey: "rive.city")
  }
}
