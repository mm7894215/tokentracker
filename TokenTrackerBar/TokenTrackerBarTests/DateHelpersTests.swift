import XCTest

final class DateHelpersTests: XCTestCase {

    func testDayRangeEndsAtProvidedCaptureDate() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let capturedAt = calendar.date(
            from: DateComponents(
                year: 2026,
                month: 8,
                day: 10,
                hour: 23,
                minute: 59,
                second: 59
            )
        )!

        let range = DateHelpers.dayRange(daysBack: 6, endingAt: capturedAt)

        XCTAssertEqual("\(range.from)...\(range.to)", "2026-08-04...2026-08-10")
    }
}
