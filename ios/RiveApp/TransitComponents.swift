import MapKit
import RiveKit
import SwiftUI

extension TransitStop {
  var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

extension Color {
  init(routeHex: String) {
    let cleaned = routeHex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    let number = UInt64(cleaned, radix: 16) ?? 0x176963
    self.init(.sRGB, red: Double((number >> 16) & 255) / 255,
              green: Double((number >> 8) & 255) / 255, blue: Double(number & 255) / 255, opacity: 1)
  }
}

struct RouteBadge: View {
  let route: TransitRoute
  var body: some View {
    Text(route.shortName).font(.subheadline.weight(.bold).monospacedDigit())
      .padding(.horizontal, 9).padding(.vertical, 5)
      .foregroundStyle(Color(routeHex: route.textColor))
      .background(Color(routeHex: route.color), in: RoundedRectangle(cornerRadius: 7))
      .accessibilityLabel("Ligne \(route.shortName)")
  }
}

struct StopRow: View {
  let stop: TransitStop
  let schedule: TransitSchedule
  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: stop.kind == 1 ? "tram.fill" : "bus.fill")
        .font(.title3).foregroundStyle(.tint).frame(width: 30)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 5) {
        Text(stop.name).font(.body.weight(.medium))
        Text(stop.routes.prefix(5).compactMap { schedule.routesByID[$0]?.shortName }.joined(separator: " · "))
          .font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      if let code = stop.code, !code.isEmpty {
        Text(code).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

struct CityPicker: View {
  @Environment(TransitStore.self) private var store
  var body: some View {
    @Bindable var store = store
    Picker("Ville", selection: $store.cityID) {
      ForEach(store.cities) { city in Text(city.name).tag(city.city) }
    }
    .accessibilityIdentifier("cityPicker")
  }
}

struct DataStatusView: View {
  @Environment(TransitStore.self) private var store
  var body: some View {
    if let error = store.errorMessage {
      Label(error, systemImage: "exclamationmark.triangle")
        .font(.footnote).foregroundStyle(.secondary)
    }
    if let schedule = store.schedule, !schedule.isWithinFeed(Date()) {
      Label("La période publiée est terminée ou n’a pas commencé. Actualisez les horaires.", systemImage: "calendar.badge.exclamationmark")
        .font(.footnote).foregroundStyle(.orange)
    }
  }
}

struct ScheduleUnavailableView: View {
  @Environment(TransitStore.self) private var store
  var body: some View {
    if store.isLoading {
      ProgressView("Chargement des horaires…").frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ContentUnavailableView {
        Label("Horaires indisponibles", systemImage: "bus")
      } description: {
        Text(store.errorMessage ?? "Choisissez une ville pour commencer.")
      } actions: {
        Button("Réessayer") { Task { await store.start(); await store.loadCity() } }
      }
    }
  }
}

func transitClock(_ date: Date, timeZone: TimeZone) -> String {
  var style = Date.FormatStyle.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
  style.timeZone = timeZone
  return date.formatted(style)
}
