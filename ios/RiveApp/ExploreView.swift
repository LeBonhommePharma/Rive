import MapKit
import RiveKit
import SwiftUI

struct ExploreView: View {
  @Environment(TransitStore.self) private var store
  @State private var query = ""
  @State private var selectedStop: TransitStop?

  var body: some View {
    Group {
      if let schedule = store.schedule {
        AtlasExplorer(schedule: schedule, query: query, selectedStop: $selectedStop)
          .id(store.cityID)
      } else { ScheduleUnavailableView() }
    }
    .navigationTitle("Rive")
    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Un arrêt, une station, un numéro")
    .toolbar {
      ToolbarItem(placement: .topBarLeading) { CityPicker() }
      ToolbarItem(placement: .topBarTrailing) {
        Button { Task { await store.refresh() } } label: {
          if store.isRefreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
        }
        .disabled(store.isRefreshing || store.cityID.isEmpty)
        .accessibilityLabel("Actualiser les horaires")
      }
    }
    .sheet(item: $selectedStop) { stop in
      NavigationStack {
        StopDetailView(stop: stop)
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fermer") { selectedStop = nil } } }
      }
    }
    .onChange(of: store.cityID) { _, _ in query = ""; selectedStop = nil }
  }
}

private struct AtlasExplorer: View {
  let schedule: TransitSchedule
  let query: String
  @Binding var selectedStop: TransitStop?
  @State private var location = TransitLocation()
  @State private var position: MapCameraPosition
  @State private var region: MKCoordinateRegion
  @State private var mapSelection: String?

  init(schedule: TransitSchedule, query: String, selectedStop: Binding<TransitStop?>) {
    self.schedule = schedule
    self.query = query
    _selectedStop = selectedStop
    let center = schedule.dataset.atlas.meta.center
    let initial = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: center[1], longitude: center[0]),
                                      latitudinalMeters: 7000, longitudinalMeters: 7000)
    _region = State(initialValue: initial)
    _position = State(initialValue: .region(initial))
  }

  private var stops: [TransitStop] {
    if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return schedule.search(query) }
    return schedule.dataset.atlas.stops.filter {
      abs($0.lat - region.center.latitude) < region.span.latitudeDelta / 2
        && abs($0.lon - region.center.longitude) < region.span.longitudeDelta / 2
    }.sorted {
      $0.distance(latitude: region.center.latitude, longitude: region.center.longitude)
        < $1.distance(latitude: region.center.latitude, longitude: region.center.longitude)
    }.prefix(70).map { $0 }
  }

  var body: some View {
    let displayed = stops
    List {
      Section {
        Map(position: $position, selection: $mapSelection) {
          ForEach(displayed) { stop in
            Annotation(stop.name, coordinate: stop.coordinate) {
              Button { selectedStop = stop } label: {
                Circle().fill(.teal).frame(width: stop.kind == 1 ? 16 : 10, height: stop.kind == 1 ? 16 : 10)
                  .overlay(Circle().stroke(.white, lineWidth: 2))
                  .frame(width: 44, height: 44).contentShape(Rectangle())
              }.accessibilityLabel(stop.name)
            }.annotationTitles(.hidden)
          }
          if let coordinate = location.coordinate {
            Annotation("Votre position", coordinate: coordinate) {
              Circle().fill(.blue).frame(width: 14, height: 14).overlay(Circle().stroke(.white, lineWidth: 3))
            }
          }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll, showsTraffic: false))
        .mapControls { MapCompass(); MapScaleView() }
        .onMapCameraChange(frequency: .onEnd) { region = $0.region }
        .frame(height: 260)
        .listRowInsets(EdgeInsets())
        .accessibilityLabel("Carte des arrêts. Les mêmes arrêts sont disponibles dans la liste.")
        Button { location.request() } label: {
          Label(location.isLocating ? "Recherche de position…" : "Autour de moi", systemImage: "location")
        }
        .disabled(location.isLocating)
        .accessibilityIdentifier("nearbyButton")
        if let message = location.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        DataStatusView()
      } header: {
        Text("\(schedule.dataset.atlas.meta.name) · Horaires publiés")
      }
      Section {
        if displayed.isEmpty {
          ContentUnavailableView(query.isEmpty ? "Aucun arrêt dans cette zone" : "Aucun arrêt trouvé",
            systemImage: "magnifyingglass", description: Text("Déplacez la carte ou essayez un autre nom ou numéro."))
        }
        ForEach(displayed) { stop in
          Button { selectedStop = stop } label: { StopRow(stop: stop, schedule: schedule) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("stop-\(stop.id)")
        }
      } header: {
        Text(query.isEmpty ? "Arrêts dans cette zone" : "Résultats")
      } footer: {
        Text("Les horaires restent accessibles hors connexion. La carte nécessite une connexion.")
      }
    }
    .listStyle(.insetGrouped)
    .onChange(of: mapSelection) { _, id in
      if let id, let stop = schedule.stopsByID[id] { selectedStop = stop; mapSelection = nil }
    }
    .onChange(of: location.coordinate?.latitude) { _, _ in
      if let coordinate = location.coordinate {
        position = .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 1800, longitudinalMeters: 1800))
      }
    }
  }
}
