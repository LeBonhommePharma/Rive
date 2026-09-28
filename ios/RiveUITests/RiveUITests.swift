import XCTest

final class RiveUITests: XCTestCase {
  @MainActor
  func testSearchFavoritesAndPrivacyWithoutLocationPermission() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launch()
    let search = app.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 20))
    search.tap()
    search.typeText("Youville")
    let stop = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "stop-")).firstMatch
    XCTAssertTrue(stop.waitForExistence(timeout: 10))
    stop.tap()
    let favorite = app.buttons["favoriteButton"]
    XCTAssertTrue(favorite.waitForExistence(timeout: 10))
    if favorite.label.contains("Retirer") { favorite.tap() }
    favorite.tap()
    XCTAssertTrue(favorite.label.contains("Retirer"))
    let departures = XCTAttachment(screenshot: app.screenshot())
    departures.name = "Native stop departures"
    departures.lifetime = .keepAlways
    add(departures)
    app.navigationBars["Départs"].buttons["Fermer"].tap()
    if app.navigationBars["Rive"].buttons["Fermer"].exists {
      app.navigationBars["Rive"].buttons["Fermer"].tap()
    }
    app.tabBars.buttons["Favoris"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Youville")).firstMatch.waitForExistence(timeout: 5))
    app.tabBars.buttons["À propos"].tap()
    app.buttons["Confidentialité"].tap()
    XCTAssertTrue(app.navigationBars["Confidentialité"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Localisation facultative"].exists)
    let privacy = XCTAttachment(screenshot: app.screenshot())
    privacy.name = "Native privacy"
    privacy.lifetime = .keepAlways
    add(privacy)
  }
}
