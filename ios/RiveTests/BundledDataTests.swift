import XCTest
import RiveKit
@testable import Rive

final class BundledDataTests: XCTestCase, @unchecked Sendable {
  func testEveryBundledCityDecodesAndHasSearchableStops() throws {
    let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("data")
    let decoder = JSONDecoder()
    let catalog = try decoder.decode(TransitCatalog.self, from: Data(contentsOf: root.appendingPathComponent("index.json")))
    XCTAssertEqual(Set(catalog.cities.map(\.city)), ["quebec", "montreal", "sherbrooke", "trois-rivieres"])
    for city in catalog.cities {
      let folder = root.appendingPathComponent(city.city)
      let atlas = try decoder.decode(TransitAtlas.self, from: Data(contentsOf: folder.appendingPathComponent("atlas.json")))
      let times = try decoder.decode([String: [TransitTimes]].self, from: Data(contentsOf: folder.appendingPathComponent("timetable.json")))
      let dataset = TransitDataset(atlas: atlas, timetable: times)
      try dataset.validate(city: city.city)
      let schedule = TransitSchedule(dataset: dataset)
      let first = try XCTUnwrap(atlas.stops.first)
      XCTAssertFalse(schedule.search(first.name).isEmpty, city.name)
    }
  }

  func testOfflineCacheRecoveryAndRejectedCityPaths() async throws {
    let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("data")
    let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: cache) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [OfflineProtocol.self]
    let repository = TransitRepository(bundledDirectory: root, cacheDirectory: cache, session: URLSession(configuration: config))
    let initial = try await repository.load(city: "quebec")
    XCTAssertEqual(initial.source, .bundled)
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    let snapshot = try JSONEncoder().encode(initial.schedule.dataset)
    let cacheFile = cache.appendingPathComponent("quebec.json")
    try snapshot.write(to: cacheFile)
    do { _ = try await repository.refresh(city: "quebec"); XCTFail("An offline refresh must fail") }
    catch { XCTAssertTrue(error is URLError) }
    XCTAssertEqual(try Data(contentsOf: cacheFile), snapshot, "Failed refresh must preserve the last complete dataset")
    let cached = try await repository.load(city: "quebec")
    XCTAssertEqual(cached.source, .cached)
    try Data("incomplete JSON".utf8).write(to: cacheFile)
    let recovered = try await repository.load(city: "quebec")
    XCTAssertEqual(recovered.source, .bundled)
    do { _ = try await repository.load(city: "../quebec"); XCTFail("Paths are not city identifiers") }
    catch { XCTAssertTrue(error is TransitDataError) }
  }
}

private final class OfflineProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
  override func stopLoading() {}
}
