import Foundation

public enum TransitDataSource: String, Sendable {
  case bundled, cached, network
}

public struct LoadedTransit: Sendable {
  public let schedule: TransitSchedule
  public let source: TransitDataSource
}

/// All JSON decoding and disk I/O happen off the UI actor. A single cache file commits
/// the atlas and timetable together, so interruption cannot leave half an update.
public actor TransitRepository {
  private let bundledDirectory: URL
  private let cacheDirectory: URL
  private let baseURL: URL
  private let session: URLSession

  /// `baseURL` is the published copy of `public/data/`. `scripts/publish-transit.mjs` composes it
  /// under `/transit/data/` on thebonhomme.com (see DEPLOY.md); nothing publishes a `/rive/` route.
  public init(bundledDirectory: URL, cacheDirectory: URL,
              baseURL: URL = URL(string: "https://thebonhomme.com/transit/data/")!,
              session: URLSession = .shared) {
    self.bundledDirectory = bundledDirectory
    self.cacheDirectory = cacheDirectory
    self.baseURL = baseURL
    self.session = session
  }

  public func catalog() throws -> [TransitCity] {
    let data = try Data(contentsOf: bundledDirectory.appendingPathComponent("index.json"))
    return try JSONDecoder().decode(TransitCatalog.self, from: data).cities
  }

  public func load(city: String) throws -> LoadedTransit {
    try validateCity(city)
    if let data = try? Data(contentsOf: cacheURL(city)),
      let cached = try? JSONDecoder().decode(TransitDataset.self, from: data),
      (try? cached.validate(city: city)) != nil {
      return LoadedTransit(schedule: TransitSchedule(dataset: cached), source: .cached)
    }
    let root = bundledDirectory.appendingPathComponent(city)
    let dataset = try decode(atlas: Data(contentsOf: root.appendingPathComponent("atlas.json")),
                             timetable: Data(contentsOf: root.appendingPathComponent("timetable.json")), city: city)
    return LoadedTransit(schedule: TransitSchedule(dataset: dataset), source: .bundled)
  }

  public func refresh(city: String) async throws -> LoadedTransit {
    try validateCity(city)
    async let atlasData = fetch(city: city, file: "atlas.json")
    async let timetableData = fetch(city: city, file: "timetable.json")
    let dataset = try await decode(atlas: atlasData, timetable: timetableData, city: city)
    try Task.checkCancellation()
    try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    try JSONEncoder().encode(dataset).write(to: cacheURL(city), options: .atomic)
    return LoadedTransit(schedule: TransitSchedule(dataset: dataset), source: .network)
  }

  private func fetch(city: String, file: String) async throws -> Data {
    var request = URLRequest(url: baseURL.appendingPathComponent(city).appendingPathComponent(file))
    request.timeoutInterval = 45
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200,
      data.count <= 80 * 1024 * 1024 else { throw TransitDataError.unavailable }
    return data
  }

  private func decode(atlas: Data, timetable: Data, city: String) throws -> TransitDataset {
    let decoder = JSONDecoder()
    let result = TransitDataset(atlas: try decoder.decode(TransitAtlas.self, from: atlas),
      timetable: try decoder.decode([String: [TransitTimes]].self, from: timetable))
    try result.validate(city: city)
    return result
  }

  private func validateCity(_ city: String) throws {
    guard !city.isEmpty, city.utf8.allSatisfy({ (97...122).contains($0) || $0 == 45 }),
      try catalog().contains(where: { $0.city == city }) else { throw TransitDataError.invalidCity }
  }

  private func cacheURL(_ city: String) -> URL { cacheDirectory.appendingPathComponent("\(city).json") }
}
