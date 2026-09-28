import Foundation

/// The same published GTFS representation used by the web atlas. No web runtime is needed.
public struct TransitCatalog: Codable, Sendable {
  public let cities: [TransitCity]
}

public struct TransitCity: Codable, Hashable, Identifiable, Sendable {
  public let city: String
  public let name: String
  public let timezone: String
  public let updated: String
  public let start: String
  public let end: String
  public let attribution: String
  public let center: [Double] // longitude, latitude
  public let agencies: [TransitAgency]?
  public var id: String { city }
}

public struct TransitAgency: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let attribution: String
  public let licenseUrl: String
}

public struct TransitStop: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let code: String?
  public let name: String
  public let lat: Double
  public let lon: Double
  public let parent: String?
  public let kind: Int
  public let wheel: Int
  public let routes: [String]
  public let children: [String]?
  public let aliases: [String]?

  public var lookupIDs: Set<String> { Set([id] + (children ?? []) + (parent.map { [$0] } ?? [])) }

  public func distance(latitude: Double, longitude: Double) -> Double {
    let radians = Double.pi / 180
    let a = pow(sin((latitude - lat) * radians / 2), 2)
      + cos(lat * radians) * cos(latitude * radians) * pow(sin((longitude - lon) * radians / 2), 2)
    return 6_371_000 * 2 * asin(sqrt(min(1, max(0, a))))
  }
}

public struct TransitRoute: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let shortName: String
  public let longName: String
  public let type: Int
  public let color: String
  public let textColor: String
  public let agencyId: String
  public let dirs: [TransitDirection]
}

public struct TransitDirection: Codable, Hashable, Sendable {
  public let id: Int
  public let headsign: String
  public let line: String
  public let stops: [String]
  public let hops: [Int]
}

public struct TransitCalendar: Codable, Sendable {
  public let id: String
  public let days: [Int]
  public let start: String
  public let end: String
}

public struct TransitException: Codable, Sendable {
  public let id: String
  public let date: String
  public let type: Int
}

public struct TransitAtlas: Codable, Sendable {
  public let meta: TransitCity
  public let stops: [TransitStop]
  public let routes: [TransitRoute]
  public let calendar: [TransitCalendar]
  public let exceptions: [TransitException]
  public let services: [String]
}

public struct TransitTimes: Codable, Sendable {
  public let r: String
  public let h: String
  public let d: Int
  public let s: [Int] // Each service shares the complete t array, not a zip of s and t.
  public let t: [Int] // GTFS minutes may exceed 24:00.
}

public struct TransitDataset: Codable, Sendable {
  public let atlas: TransitAtlas
  public let timetable: [String: [TransitTimes]]

  public init(atlas: TransitAtlas, timetable: [String: [TransitTimes]]) {
    self.atlas = atlas
    self.timetable = timetable
  }

  public func validate(city: String) throws {
    guard atlas.meta.city == city, !atlas.stops.isEmpty, !atlas.routes.isEmpty,
      !timetable.isEmpty, TimeZone(identifier: atlas.meta.timezone) != nil,
      atlas.meta.center.count == 2,
      atlas.stops.allSatisfy({ $0.lat.isFinite && $0.lon.isFinite && abs($0.lat) <= 90 && abs($0.lon) <= 180 }),
      Set(atlas.stops.map(\.id)).count == atlas.stops.count,
      Set(atlas.routes.map(\.id)).count == atlas.routes.count,
      Set(atlas.services).count == atlas.services.count
    else { throw TransitDataError.invalidData }
    let routes = Set(atlas.routes.map(\.id))
    guard timetable.values.joined().allSatisfy({ row in
      routes.contains(row.r) && row.s.allSatisfy { atlas.services.indices.contains($0) }
        && row.t.allSatisfy { $0 >= 0 && $0 <= 72 * 60 }
    }) else { throw TransitDataError.invalidData }
  }
}

public enum TransitDataError: LocalizedError {
  case invalidData, unavailable, invalidCity
  public var errorDescription: String? {
    switch self {
    case .invalidData: "Les données reçues sont incomplètes. Réessayez plus tard."
    case .unavailable: "Les horaires sont indisponibles. Vérifiez votre connexion et réessayez."
    case .invalidCity: "Cette ville n’est pas disponible."
    }
  }
}
