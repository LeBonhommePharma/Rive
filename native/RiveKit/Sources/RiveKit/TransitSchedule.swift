import Foundation

public struct ScheduledDeparture: Identifiable, Hashable, Sendable {
  public let route: TransitRoute
  public let headsign: String
  public let direction: Int
  public let date: Date
  public var id: String { "\(route.id)|\(direction)|\(headsign)|\(date.timeIntervalSince1970)" }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.route.id == rhs.route.id && lhs.direction == rhs.direction && lhs.headsign == rhs.headsign && lhs.date == rhs.date
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(route.id)
    hasher.combine(direction)
    hasher.combine(headsign)
    hasher.combine(date)
  }
}

/// Immutable, indexed timetable. Calendar decisions always use the agency's time zone.
public struct TransitSchedule: Sendable {
  public let dataset: TransitDataset
  public let stopsByID: [String: TransitStop]
  public let routesByID: [String: TransitRoute]
  private let serviceIndexes: [String: Int]
  private let searchTerms: [String: String]
  public var timeZone: TimeZone { TimeZone(identifier: dataset.atlas.meta.timezone) ?? .gmt }
  public var calendar: Calendar {
    var result = Calendar(identifier: .gregorian)
    result.timeZone = timeZone
    return result
  }

  public init(dataset: TransitDataset) {
    self.dataset = dataset
    stopsByID = Dictionary(dataset.atlas.stops.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    routesByID = Dictionary(dataset.atlas.routes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    serviceIndexes = Dictionary(dataset.atlas.services.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { first, _ in first })
    searchTerms = Dictionary(dataset.atlas.stops.map { stop in
      (stop.id, Self.fold(([stop.name, stop.code ?? ""] + (stop.aliases ?? [])).joined(separator: " ")))
    }, uniquingKeysWith: { first, _ in first })
  }

  public static func fold(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_CA"))
  }

  public func search(_ text: String, limit: Int = 60) -> [TransitStop] {
    let words = Self.fold(text).split(whereSeparator: { $0.isWhitespace }).map(String.init)
    guard !words.isEmpty else { return [] }
    return dataset.atlas.stops.filter { stop in
      let haystack = searchTerms[stop.id] ?? ""
      return words.allSatisfy(haystack.contains)
    }.sorted {
      let lhsExact = Self.fold($0.code ?? "") == Self.fold(text) ? 0 : 1
      let rhsExact = Self.fold($1.code ?? "") == Self.fold(text) ? 0 : 1
      if lhsExact != rhsExact { return lhsExact < rhsExact }
      if $0.kind != $1.kind { return $0.kind == 1 }
      return $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }.prefix(max(0, limit)).map { $0 }
  }

  public func stamp(_ date: Date) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d%02d%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  public func activeServices(on date: Date) -> Set<Int> {
    let day = stamp(date)
    let weekday = (calendar.component(.weekday, from: date) + 5) % 7
    var active = Set<Int>()
    for row in dataset.atlas.calendar where row.start <= day && day <= row.end {
      if row.days.indices.contains(weekday), row.days[weekday] == 1, let index = serviceIndexes[row.id] {
        active.insert(index)
      }
    }
    for row in dataset.atlas.exceptions where row.date == day {
      guard let index = serviceIndexes[row.id] else { continue }
      if row.type == 1 { active.insert(index) }
      if row.type == 2 { active.remove(index) }
    }
    return active
  }

  public func isWithinFeed(_ date: Date) -> Bool {
    let day = stamp(date)
    return dataset.atlas.meta.start <= day && day <= dataset.atlas.meta.end
  }

  /// GTFS defines time as elapsed time from local noon minus twelve hours.
  /// This is deliberate on daylight-saving transition days (not wall-clock midnight).
  public func serviceDate(minutes: Int, on day: Date) -> Date {
    let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day)!
    return noon.addingTimeInterval(Double(minutes * 60 - 43_200))
  }

  public func departures(at stop: TransitStop, after now: Date, limit: Int = 40,
                         routeID: String? = nil, direction: Int? = nil,
                         headsign: String? = nil) -> [ScheduledDeparture] {
    let entries = stop.lookupIDs.flatMap { dataset.timetable[$0] ?? [] }.filter {
      (routeID == nil || $0.r == routeID) && (direction == nil || $0.d == direction)
        && (headsign == nil || $0.h == headsign || $0.h.isEmpty)
    }
    var found = Set<ScheduledDeparture>()
    let horizon = now.addingTimeInterval(24 * 3600)
    // Up to 72:00 is supported. Yesterday's service is not today's calendar.
    for offset in -3...1 {
      guard let day = calendar.date(byAdding: .day, value: offset, to: now) else { continue }
      let active = activeServices(on: day)
      guard !active.isEmpty else { continue }
      let base = serviceDate(minutes: 0, on: day)
      for entry in entries where entry.s.contains(where: active.contains) {
        guard let route = routesByID[entry.r] else { continue }
        for minute in entry.t {
          let date = base.addingTimeInterval(Double(minute) * 60)
          if date >= now && date <= horizon {
            found.insert(ScheduledDeparture(route: route, headsign: entry.h.isEmpty ? route.longName : entry.h,
                                           direction: entry.d, date: date))
          }
        }
      }
    }
    return found.sorted {
      if $0.date != $1.date { return $0.date < $1.date }
      return $0.id < $1.id
    }.prefix(max(0, limit)).map { $0 }
  }
}
