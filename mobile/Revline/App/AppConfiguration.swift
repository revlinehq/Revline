import Foundation

struct AppConfiguration: Sendable {
    let convexURL: URL
    let webURL: URL
    let clerkKey: String
    let environment: String

    static func load() throws -> Self {
        func value(_ key: String) throws -> String {
            guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
                  !value.isEmpty, !value.contains("$(") else {
                throw AppFailure("App configuration is missing. Follow mobile/README.md to configure this build.")
            }
            return value
        }
        let environment = try value("RevlineEnvironment")
        let key = try value("RevlineClerkPublishableKey")
        guard let convex = URL(string: try value("RevlineConvexURL")),
              let web = URL(string: try value("RevlineWebURL")),
              convex.scheme == "https", convex.host?.hasSuffix(".convex.cloud") == true,
              web.host != nil, ["https", "http"].contains(web.scheme),
              key.hasPrefix("pk_") else { throw AppFailure("The app's connection settings are invalid.") }
        #if !DEBUG
        guard environment == "production", key.hasPrefix("pk_live_"),
              convex.host == "different-gnu-398.convex.cloud", web.scheme == "https",
              web.host == "tryrevline.com" else {
            throw AppFailure("Release requires Revline's production backend, website, and live Clerk instance.")
        }
        #endif
        return Self(convexURL: convex, webURL: web, clerkKey: key, environment: environment)
    }
}
