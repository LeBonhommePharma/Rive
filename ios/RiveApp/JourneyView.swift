import MapKit
import RiveKit
import SwiftUI

private enum JourneyEndpoint: String, Identifiable {
  case origin, destination
  var id: String { rawValue }
}

struct JourneyView: View {
  @Environment(TransitStore.self) private var store
  @State private var origin: TransitStop?
  @State private var destination: TransitStop?
  @State private var departure = Date()
  @State private var picking: JourneyEndpoint?
  @State private var journeys: [TransitJourney] = []
  @State private var isPlanning = false

  private var requestKey: String {
    "\(store.cityID)|\(store.revision)|\(origin?.id ?? "")|\(destination?.id ?? "")|\(departure.timeIntervalSince1970)"
  }

  var body: some View {
    Group {
      if let schedule = store.schedule {
        List {
          Section {
            endpointButton("De", stop: origin, endpoint: .origin)
            endpointButton("Vers", stop: destination, endpoint: .destination)
            if origin != nil, destination != nil {
              Button("Inverser", systemImage: "arrow.up.arrow.down") { swap(&origin, &destination) }
            }
            DatePicker("Partir à", selection: $departure, displayedComponents: [.date, .hourAndMinute])
              .environment(\.timeZone, schedule.timeZone)
            Button("Partir maintenant") { departure = Date() }
          } footer: { Text("D’arrêt à arrêt, en trajet direct ou avec une correspondance au même arrêt ou à la même station.") }
          DataStatusView()
          if origin != nil, destination != nil {
            Section {
              if isPlanning { ProgressView("Recherche d’un trajet…") }
              else if journeys.isEmpty {
                ContentUnavailableView("Aucun trajet proposé", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                  description: Text("Essayez un autre arrêt ou une autre heure. Les trajets avec plusieurs correspondances ne sont pas encore pris en charge."))
              } else {
                ForEach(journeys) { journey in
                  NavigationLink { JourneyDetailView(journey: journey, schedule: schedule) } label: {
                    VStack(alignment: .leading, spacing: 10) {
                      HStack {
                        Text("\(transitClock(journey.departure, timeZone: schedule.timeZone)) → \(transitClock(journey.arrival, timeZone: schedule.timeZone))")
                          .font(.headline.monospacedDigit())
                        Spacer()
                        Text("≈ \(journey.duration) min").font(.subheadline)
                      }
                      HStack {
                        ForEach(journey.legs) { RouteBadge(route: $0.departure.route) }
                        Text(journey.legs.count == 1 ? "Direct" : "1 correspondance")
                          .font(.caption).foregroundStyle(.secondary)
                      }
                    }.padding(.vertical, 6)
                  }
                }
              }
            } header: { Text("Propositions")
            } footer: { Text("Départs selon les horaires publiés. Durées et arrivées estimées à partir des parcours; vérifiez les avis du transporteur.") }
          }
        }
      } else { ScheduleUnavailableView() }
    }
    .navigationTitle("Votre trajet")
    .toolbar { ToolbarItem(placement: .topBarTrailing) { CityPicker() } }
    .sheet(item: $picking) { endpoint in
      NavigationStack {
        StopPickerView(title: endpoint == .origin ? "Point de départ" : "Destination") { stop in
          if endpoint == .origin { origin = stop } else { destination = stop }
        }
      }
    }
    .onChange(of: store.cityID) { _, _ in origin = nil; destination = nil; journeys = []; picking = nil }
    .task(id: requestKey) {
      journeys = []
      guard let schedule = store.schedule, let origin, let destination else { isPlanning = false; return }
      let date = departure
      isPlanning = true
      let task = Task.detached(priority: .userInitiated) {
        schedule.journeys(from: origin, to: destination, after: date)
      }
      let result = await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
      guard !Task.isCancelled else { return }
      journeys = result
      isPlanning = false
    }
  }

  private func endpointButton(_ title: String, stop: TransitStop?, endpoint: JourneyEndpoint) -> some View {
    Button { picking = endpoint } label: {
      HStack(alignment: .firstTextBaseline) {
        Text(title).foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
        Text(stop?.name ?? "Choisir un arrêt").foregroundStyle(stop == nil ? .secondary : .primary)
        Spacer()
        Image(systemName: "magnifyingglass").foregroundStyle(.tint)
      }.padding(.vertical, 6)
    }
    .accessibilityIdentifier(endpoint == .origin ? "originPicker" : "destinationPicker")
  }
}

private struct StopPickerView: View {
  let title: String
  let choose: (TransitStop) -> Void
  @Environment(TransitStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""

  var body: some View {
    List {
      if let schedule = store.schedule {
        let stops = query.isEmpty ? Array(schedule.dataset.atlas.stops.prefix(40)) : schedule.search(query)
        ForEach(stops) { stop in
          Button { choose(stop); dismiss() } label: { StopRow(stop: stop, schedule: schedule) }.buttonStyle(.plain)
        }
        if stops.isEmpty { ContentUnavailableView.search(text: query) }
      }
    }
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Nom ou numéro d’arrêt")
    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } } }
  }
}

private struct JourneyDetailView: View {
  let journey: TransitJourney
  let schedule: TransitSchedule

  var body: some View {
    List {
      Section {
        Map {
          ForEach(journey.legs) { leg in
            let coordinates = leg.stopIDs.compactMap { schedule.stopsByID[$0]?.coordinate }
            MapPolyline(coordinates: coordinates).stroke(Color(routeHex: leg.departure.route.color), lineWidth: 5)
            Marker(leg.from.name, coordinate: leg.from.coordinate)
            Marker(leg.to.name, coordinate: leg.to.coordinate)
          }
        }
        .frame(height: 260)
        .listRowInsets(EdgeInsets())
      } footer: { Text("La ligne relie les arrêts du trajet; elle ne représente pas le tracé exact des rues.") }
      ForEach(Array(journey.legs.enumerated()), id: \.element.id) { index, leg in
        Section(index == 0 ? "Monter à bord" : "Correspondance · au moins 3 min") {
          HStack { RouteBadge(route: leg.departure.route); Text(leg.departure.headsign) }
          LabeledContent(transitClock(leg.departure.date, timeZone: schedule.timeZone), value: leg.from.name)
          LabeledContent("≈ \(transitClock(leg.arrival, timeZone: schedule.timeZone))", value: leg.to.name)
        }
      }
    }
    .navigationTitle("≈ \(journey.duration) minutes")
    .navigationBarTitleDisplayMode(.inline)
  }
}
