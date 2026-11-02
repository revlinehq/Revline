import Foundation

struct BillingStatus: Decodable, Sendable {
    let enabled: Bool
    let configured: Bool
    let plan: String
    let subscribed: Bool
    let complimentary: Bool?
    let needsPayment: Bool
    let subscriptionSource: String?
    var active: Bool { subscribed || complimentary == true }
}
