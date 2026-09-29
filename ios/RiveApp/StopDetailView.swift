import MapKit
import RiveKit
import SwiftUI

struct StopDetailView: View {
  let stop: TransitStop
  @Environment(TransitStore.self) private var store
  @State private var selectedDate = Date()
  @State private var useNow = true

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      List {
        Section {
          Text(stop.name).font(.title2.bold())
          if let code = stop.code { Text("Arrêt \(code)").foregroundStyle(.secondary) }
          Button { store.toggleFavorite(stop) } label: {
            Label(store.isFavorite(stop) ? "Retirer des favoris" : "Ajouter aux favoris",
                  systemImage: store.isFavorite(stop) ? "star.fill" : "star")
          }
          .accessibilityIdentifier("favoriteButton")
          Button("Marcher vers cet arrêt", systemImage: "figure.walk") {
            let item = MKMapItem(placemark: MKPlacemark(coordinate: stop.coordinate))
            item.name = stop.name
            item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
          }
        }
        Section {
          Toggle("À partir de maintenant", isOn: $useNow)
          if !useNow {
            DatePicker("Départ", selection: $selectedDate, displayedComponents: [.date, .hourAndMinute])
              .environment(\.timeZone, store.schedule?.timeZone ?? .current)
          }
          DataStatusView()
        } footer: { Text("Heures locales du réseau. Horaires planifiés, sans suivi des véhicules en temps réel.") }
        if let schedule = store.schedule {
          let after = useNow ? context.date : selectedDate
          let departures = schedule.departures(at: stop, after: after)
          Section("Prochains départs · 24 heures") {
            if departures.isEmpty {
              ContentUnavailableView("Aucun départ publié", systemImage: "calendar.badge.clock",
                description: Text("Aucun service n’est publié pour cet arrêt sur cette période. Essayez une autre heure ou actualisez les données."))
            }
            ForEach(departures) { departure in
              HStack(alignment: .top, spacing: 12) {
                RouteBadge(route: departure.route)
                VStack(alignment: .leading, spacing: 4) {
                  Text(departure.headsign).font(.subheadline)
                  Text(departure.route.agencyId).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 5)
                VStack(alignment: .trailing, spacing: 4) {
                  Text(transitClock(departure.date, timeZone: schedule.timeZone)).font(.headline.monospacedDigit())
                  if schedule.stamp(departure.date) != schedule.stamp(after) {
                    Text("Demain").font(.caption).foregroundStyle(.secondary)
                  } else if useNow {
                    Text("\(max(0, Int(ceil(departure.date.timeIntervalSince(context.date) / 60)))) min")
                      .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                  }
                }
              }
              .accessibilityElement(children: .combine)
            }
          }
        }
      }
    }
    .navigationTitle("Départs")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct FavoritesView: View {
  @Environment(TransitStore.self) private var store
  var body: some View {
    Group {
      if let schedule = store.schedule {
        let stops = schedule.dataset.atlas.stops.filter { store.isFavorite($0) }
          .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        if stops.isEmpty {
          ContentUnavailableView("Vos arrêts, à portée de main", systemImage: "star",
            description: Text("Ouvrez un arrêt dans Explorer et ajoutez-le aux favoris. Ils restent sur cet appareil."))
        } else {
          List(stops) { stop in
            NavigationLink { StopDetailView(stop: stop) } label: { StopRow(stop: stop, schedule: schedule) }
              .swipeActions { Button("Retirer", role: .destructive) { store.toggleFavorite(stop) } }
          }
          .id(store.cityID)
        }
      } else { ScheduleUnavailableView() }
    }
    .navigationTitle("Favoris")
    .toolbar { ToolbarItem(placement: .topBarTrailing) { CityPicker() } }
  }
}
