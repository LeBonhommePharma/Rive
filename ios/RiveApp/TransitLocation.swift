import CoreLocation
import Observation

@MainActor @Observable
// CLLocationManager delivers delegate callbacks on its creation thread (the main actor here).
final class TransitLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private(set) var coordinate: CLLocationCoordinate2D?
  private(set) var isLocating = false
  var message: String?

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  func request() {
    message = nil
    switch manager.authorizationStatus {
    case .notDetermined:
      isLocating = true
      manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse:
      isLocating = true
      manager.requestLocation()
    case .denied, .restricted:
      isLocating = false
      message = "Position désactivée. Recherchez un arrêt ou autorisez Rive dans les réglages de localisation."
    @unknown default: isLocating = false
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard isLocating else { return }
    request()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    isLocating = false
    guard let latest = locations.last, latest.horizontalAccuracy >= 0,
      abs(latest.timestamp.timeIntervalSinceNow) < 120 else {
      message = "Position indisponible pour le moment. La recherche reste accessible."
      return
    }
    coordinate = latest.coordinate
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    isLocating = false
    message = "Position indisponible pour le moment. La recherche reste accessible."
  }
}
