import Foundation
import XCTest
@testable import RiveKit

final class TransitScheduleTests: XCTestCase {
  private func date(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }

  private func fixture(calendar: [TransitCalendar] = [], exceptions: [TransitException],
                       times: [Int], services: [String] = ["weekday"], serviceIDs: [Int] = [0]) -> TransitSchedule {
    let meta = TransitCity(city: "test", name: "Test", timezone: "America/Toronto", updated: "20260922",
      start: "20260101", end: "20261231", attribution: "Test", center: [-71, 46], agencies: nil)
    let stops = ["a", "b", "c"].enumerated().map { index, id in
      TransitStop(id: id, code: "\(index + 1)", name: index == 0 ? "Université Laval" : id,
        lat: 46 + Double(index) / 100, lon: -71, parent: nil, kind: 0, wheel: 0,
        routes: index == 0 ? ["r1"] : (index == 1 ? ["r1", "r2"] : ["r2"]), children: nil, aliases: nil)
    }
    let first = TransitRoute(id: "r1", shortName: "1", longName: "Ligne 1", type: 3, color: "#000000",
      textColor: "#FFFFFF", agencyId: "TEST", dirs: [TransitDirection(id: 0, headsign: "b", line: "", stops: ["a", "b"], hops: [10])])
    let second = TransitRoute(id: "r2", shortName: "2", longName: "Ligne 2", type: 3, color: "#000000",
      textColor: "#FFFFFF", agencyId: "TEST", dirs: [TransitDirection(id: 0, headsign: "c", line: "", stops: ["b", "c"], hops: [7])])
    let atlas = TransitAtlas(meta: meta, stops: stops, routes: [first, second], calendar: calendar, exceptions: exceptions, services: services)
    return TransitSchedule(dataset: TransitDataset(atlas: atlas, timetable: [
      "a": [TransitTimes(r: "r1", h: "b", d: 0, s: serviceIDs, t: times)],
      "b": [TransitTimes(r: "r2", h: "c", d: 0, s: serviceIDs, t: [610, 615, 630])]
    ]))
  }

  func testExceptionsOverrideWeekdayCalendar() {
    let cal = TransitCalendar(id: "weekday", days: [1, 1, 1, 1, 1, 0, 0], start: "20260901", end: "20260930")
    let schedule = fixture(calendar: [cal], exceptions: [
      TransitException(id: "weekday", date: "20260922", type: 2),
      TransitException(id: "weekday", date: "20260926", type: 1)
    ], times: [600])
    XCTAssertTrue(schedule.activeServices(on: date("2026-09-22T15:00:00Z")).isEmpty)
    XCTAssertEqual(schedule.activeServices(on: date("2026-09-26T15:00:00Z")), [0])
    XCTAssertTrue(schedule.activeServices(on: date("2026-10-01T15:00:00Z")).isEmpty)
  }

  func testDoesNotInventTomorrowByWrappingTodaysService() {
    let schedule = fixture(exceptions: [TransitException(id: "weekday", date: "20260922", type: 1)], times: [600])
    let stop = schedule.stopsByID["a"]!
    XCTAssertTrue(schedule.departures(at: stop, after: date("2026-09-22T15:00:00Z")).isEmpty)
  }

  func testTomorrowUsesTomorrowsService() {
    let schedule = fixture(exceptions: [TransitException(id: "tomorrow", date: "20260923", type: 1)],
      times: [480], services: ["today", "tomorrow"], serviceIDs: [1])
    let rows = schedule.departures(at: schedule.stopsByID["a"]!, after: date("2026-09-23T02:00:00Z"))
    XCTAssertEqual(rows.map(\.date), [date("2026-09-23T12:00:00Z")])
  }

  func testAfterMidnightRetainsPreviousServiceDay() {
    let schedule = fixture(exceptions: [TransitException(id: "weekday", date: "20260922", type: 1)], times: [25 * 60 + 10])
    let rows = schedule.departures(at: schedule.stopsByID["a"]!, after: date("2026-09-23T04:30:00Z"))
    XCTAssertEqual(rows.map(\.date), [date("2026-09-23T05:10:00Z")])
    XCTAssertTrue(schedule.departures(at: schedule.stopsByID["a"]!, after: date("2026-09-24T04:30:00Z")).isEmpty)
  }

  func testServiceDayUsesAgencyTimeZone() {
    let schedule = fixture(exceptions: [TransitException(id: "weekday", date: "20260922", type: 1)], times: [1380])
    let instant = date("2026-09-23T02:00:00Z")
    XCTAssertEqual(schedule.stamp(instant), "20260922")
    XCTAssertEqual(schedule.departures(at: schedule.stopsByID["a"]!, after: instant).first?.date, date("2026-09-23T03:00:00Z"))
  }

  func testGTFSNoonAnchorAcrossDaylightSaving() {
    let schedule = fixture(exceptions: [], times: [])
    let spring = date("2026-03-08T16:00:00Z")
    XCTAssertEqual(schedule.serviceDate(minutes: 210, on: spring), date("2026-03-08T07:30:00Z"))
    XCTAssertEqual(schedule.serviceDate(minutes: 210, on: spring).timeIntervalSince(schedule.serviceDate(minutes: 150, on: spring)), 3600)
    let autumn = date("2026-11-01T17:00:00Z")
    XCTAssertEqual(schedule.serviceDate(minutes: 150, on: autumn), date("2026-11-01T07:30:00Z"))
  }

  func testSearchIgnoresAccentsAndMatchesStopCodes() {
    let schedule = fixture(exceptions: [], times: [])
    XCTAssertEqual(schedule.search("universite laval").map(\.id), ["a"])
    XCTAssertEqual(schedule.search("1").first?.id, "a")
    XCTAssertTrue(schedule.search("   ").isEmpty)
    XCTAssertTrue(schedule.search("does not exist").isEmpty)
  }

  func testDirectJourneyAndTransferWaitUseScheduledDepartures() {
    let schedule = fixture(exceptions: [TransitException(id: "weekday", date: "20260922", type: 1)], times: [600])
    let now = date("2026-09-22T13:50:00Z")
    let direct = schedule.journeys(from: schedule.stopsByID["a"]!, to: schedule.stopsByID["b"]!, after: now)
    XCTAssertEqual(direct.first?.departure, date("2026-09-22T14:00:00Z"))
    XCTAssertEqual(direct.first?.arrival, date("2026-09-22T14:10:00Z"))
    let transfer = schedule.journeys(from: schedule.stopsByID["a"]!, to: schedule.stopsByID["c"]!, after: now)
    XCTAssertEqual(transfer.first?.legs.count, 2)
    // The 10:10 bus cannot be caught after a 10:10 arrival plus 3-minute transfer.
    XCTAssertEqual(transfer.first?.legs.last?.departure.date, date("2026-09-22T14:15:00Z"))
    XCTAssertEqual(transfer.first?.arrival, date("2026-09-22T14:22:00Z"))
    XCTAssertTrue(schedule.journeys(from: schedule.stopsByID["b"]!, to: schedule.stopsByID["a"]!, after: now).isEmpty)
  }

  func testInconsistentServiceIndexesAreRejected() {
    let schedule = fixture(exceptions: [], times: [600], serviceIDs: [99])
    XCTAssertThrowsError(try schedule.dataset.validate(city: "test"))
  }

  func testRepeatedTimesAreDeduplicated() {
    let schedule = fixture(exceptions: [TransitException(id: "weekday", date: "20260922", type: 1)], times: [600, 600, 610])
    XCTAssertEqual(schedule.departures(at: schedule.stopsByID["a"]!, after: date("2026-09-22T13:00:00Z")).count, 2)
  }
}
