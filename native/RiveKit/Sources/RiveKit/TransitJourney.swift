import Foundation

public struct TransitJourneyLeg: Identifiable, Hashable, Sendable {
  public let departure: ScheduledDeparture
  public let from: TransitStop
  public let to: TransitStop
  public let arrival: Date
  public let stopIDs: [String]
  public var id: String { "\(departure.id)|\(from.id)|\(to.id)" }
}

public struct TransitJourney: Identifiable, Hashable, Sendable {
  public let legs: [TransitJourneyLeg]
  public var id: String { legs.map(\.id).joined(separator: ">") }
  public var departure: Date { legs[0].departure.date }
  public var arrival: Date { legs[legs.count - 1].arrival }
  public var duration: Int { Int(ceil(arrival.timeIntervalSince(departure) / 60)) }
}

extension TransitSchedule {
  /// Stop-to-stop proposals with at most one transfer at the same stop/station.
  /// Departures use actual service calendars. Ride durations use the atlas's representative
  /// hop times; the UI must label arrivals as estimates, not vehicle predictions.
  public func journeys(from origin: TransitStop, to destination: TransitStop, after now: Date) -> [TransitJourney] {
    guard origin.lookupIDs.isDisjoint(with: destination.lookupIDs) else { return [] }
    var results = directLegs(from: origin, to: destination, after: now).map { TransitJourney(legs: [$0]) }
    let destinationRoutes = routes(at: destination)
    let possibleTransfers = Set(destinationRoutes.flatMap { $0.dirs.flatMap(\.stops) })

    for route in routes(at: origin) {
      if Task.isCancelled { return [] }
      for dir in route.dirs {
        guard let start = index(of: origin, in: dir), start + 1 < dir.stops.count,
          let departure = departures(at: origin, after: now, limit: 1, routeID: route.id,
                                     direction: dir.id, headsign: dir.headsign).first else { continue }
        for end in (start + 1)..<dir.stops.count {
          if Task.isCancelled { return [] }
          guard let transfer = stopsByID[dir.stops[end]],
            !transfer.lookupIDs.isDisjoint(with: possibleTransfers)
          else { continue }
          guard let first = leg(departure: departure, from: origin, to: transfer, direction: dir, start: start, end: end)
          else { continue }
          let onward = directLegs(from: transfer, to: destination,
                                  after: first.arrival.addingTimeInterval(180), excludingRoute: route.id)
          results += onward.filter { $0.arrival.timeIntervalSince(now) <= 12 * 3600 }
            .map { TransitJourney(legs: [first, $0]) }
        }
      }
    }
    var signatures = Set<String>()
    return results.sorted { $0.arrival < $1.arrival }.filter {
      let signature = $0.legs.map { "\($0.departure.route.id)|\($0.departure.direction)|\($0.to.id)" }.joined(separator: ">")
      return $0.arrival.timeIntervalSince(now) <= 12 * 3600 && signatures.insert(signature).inserted
    }.prefix(6).map { $0 }
  }

  private func routes(at stop: TransitStop) -> [TransitRoute] {
    let ids = Set(stop.lookupIDs.flatMap { stopsByID[$0]?.routes ?? [] })
    return ids.sorted().compactMap { routesByID[$0] }
  }

  private func index(of stop: TransitStop, in direction: TransitDirection) -> Int? {
    direction.stops.firstIndex(where: stop.lookupIDs.contains)
  }

  private func directLegs(from: TransitStop, to: TransitStop, after: Date, excludingRoute: String? = nil) -> [TransitJourneyLeg] {
    var result: [TransitJourneyLeg] = []
    for route in routes(at: from) where route.id != excludingRoute {
      for dir in route.dirs {
        guard let i = index(of: from, in: dir), let j = index(of: to, in: dir), j > i,
          let departure = departures(at: from, after: after, limit: 1, routeID: route.id,
                                     direction: dir.id, headsign: dir.headsign).first,
          let ride = leg(departure: departure, from: from, to: to, direction: dir, start: i, end: j)
        else { continue }
        result.append(ride)
      }
    }
    return result
  }

  private func leg(departure: ScheduledDeparture, from: TransitStop, to: TransitStop,
                   direction: TransitDirection, start: Int, end: Int) -> TransitJourneyLeg? {
    guard start >= 0, end > start, end < direction.stops.count, end <= direction.hops.count else { return nil }
    let minutes = max(1, direction.hops[start..<end].reduce(0, +))
    return TransitJourneyLeg(departure: departure, from: from, to: to,
      arrival: departure.date.addingTimeInterval(Double(minutes) * 60),
      stopIDs: Array(direction.stops[start...end]))
  }
}
