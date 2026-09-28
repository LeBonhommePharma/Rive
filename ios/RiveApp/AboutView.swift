import RiveKit
import SwiftUI

struct AboutView: View {
  @Environment(TransitStore.self) private var store
  @State private var confirmClear = false

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Rive").font(.largeTitle.bold())
          Text("Vos transports. Votre rythme.").font(.title3)
          Text("Horaires de transport collectif à Québec, Lévis, Montréal, Laval, Longueuil, Sherbrooke et Trois-Rivières.")
            .font(.subheadline).foregroundStyle(.secondary)
        }.padding(.vertical, 12)
        LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0")
      }
      Section("Vos données") {
        NavigationLink("Confidentialité") { NativePrivacyView() }
        Button("Effacer mes favoris et ma préférence de ville", role: .destructive) { confirmClear = true }
      }
      Section("Aide et logiciel libre") {
        Link("Signaler un problème", destination: URL(string: "https://github.com/LeBonhommePharma/Transit/issues")!)
        Link("Code source et licence Apache 2.0", destination: URL(string: "https://github.com/LeBonhommePharma/Transit")!)
        Link("Rive sur le web", destination: URL(string: "https://thebonhomme.com/rive/")!)
      }
      if let loaded = store.loaded {
        let meta = loaded.schedule.dataset.atlas.meta
        Section("Horaires · \(meta.name)") {
          LabeledContent("Source locale", value: sourceName(loaded.source))
          LabeledContent("Fin de la période publiée", value: dateLabel(meta.end))
          Text("Les horaires sont planifiés. Rive n’annonce pas de position de véhicule ni de retard en temps réel.")
            .font(.footnote).foregroundStyle(.secondary)
          Button("Actualiser les horaires") { Task { await store.refresh() } }.disabled(store.isRefreshing)
          DataStatusView()
        }
        Section("Sources et attributions") {
          Text(meta.attribution).font(.footnote)
          ForEach(meta.agencies ?? []) { agency in
            if let url = URL(string: agency.licenseUrl), url.scheme == "https" || url.scheme == "http" {
              Link(agency.name, destination: url)
            }
          }
          Text("Les sociétés de transport conservent les droits sur leurs données et n’endossent pas Rive. La carte est fournie par Apple Plans.")
            .font(.footnote).foregroundStyle(.secondary)
        }
      }
    }
    .navigationTitle("À propos")
    .confirmationDialog("Effacer les données personnelles enregistrées dans Rive ?", isPresented: $confirmClear, titleVisibility: .visible) {
      Button("Effacer", role: .destructive) { store.clearPersonalData() }
    } message: { Text("Les horaires publics téléchargés restent disponibles hors connexion.") }
  }

  private func sourceName(_ source: TransitDataSource) -> String {
    switch source { case .bundled: "Inclus dans l’app"; case .cached: "Dernier téléchargement"; case .network: "Actualisé pendant cette session" }
  }

  private func dateLabel(_ raw: String) -> String {
    guard raw.count == 8 else { return raw }
    return "\(raw.prefix(4))-\(raw.dropFirst(4).prefix(2))-\(raw.suffix(2))"
  }
}

private struct NativePrivacyView: View {
  var body: some View {
    List {
      Section("Rive pour iOS · 22 septembre 2026") {
        Text("Cette politique décrit cette application native. Le site web Rive peut utiliser d’autres services.")
      }
      Section("Sur votre appareil") {
        Text("Les recherches d’arrêts, le calcul des départs et les propositions de trajets sont effectués sur votre appareil. Les favoris et la ville choisie y sont conservés. Aucun compte, publicité ou outil d’analyse d’utilisation n’est intégré.")
      }
      Section("Localisation facultative") {
        Text("Rive demande votre position uniquement lorsque vous touchez « Autour de moi ». Elle sert à classer les arrêts et à centrer la carte. Rive ne conserve pas d’historique de position et ne transmet pas vos coordonnées à son serveur de données. Vous pouvez refuser l’accès et continuer à rechercher des arrêts.")
      }
      Section("Connexions réseau") {
        Text("La carte utilise Apple MapKit. Les requêtes cartographiques sont traitées par Apple selon sa politique de confidentialité. Si vous ouvrez un itinéraire dans Plans, ce trajet est confié à Apple Plans.")
        Link("Confidentialité d’Apple Plans", destination: URL(string: "https://www.apple.com/legal/privacy/data/en/apple-maps/")!)
        Text("Le bouton Actualiser télécharge les horaires publics de la ville choisie depuis thebonhomme.com, hébergé sur GitHub Pages. L’hébergeur reçoit les informations techniques habituelles, dont l’adresse IP et la ressource demandée. Les recherches, favoris et coordonnées GPS ne figurent pas dans ces requêtes.")
        Link("Politique de confidentialité de GitHub", destination: URL(string: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement")!)
      }
      Section("Vos choix") {
        Text("Effacez vos favoris et la préférence de ville depuis À propos. Révoquez l’accès à la position dans Réglages > Confidentialité et sécurité > Service de localisation. Supprimer l’application efface ses données locales. Les liens externes ouvrent les services concernés, avec leurs propres pratiques de confidentialité.")
        Link("Assistance et questions sur la confidentialité", destination: URL(string: "https://github.com/LeBonhommePharma/Transit/issues")!)
      }
    }
    .navigationTitle("Confidentialité")
    .navigationBarTitleDisplayMode(.inline)
  }
}
