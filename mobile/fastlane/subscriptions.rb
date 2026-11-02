require "json"
require "net/http"
require "uri"
require "date"
require "time"
require "bigdecimal"
require "spaceship"

# Uses Apple's published REST resources. Authentication stays in memory; keys
# are loaded directly from the owner's private path and never copied or logged.
class RevlineSubscriptions
  ORIGIN = "https://api.appstoreconnect.apple.com".freeze

  class RequestError < StandardError
    attr_reader :status

    def initialize(status, message)
      @status = status
      super(message)
    end
  end

  def initialize(apply: false)
    @apply = apply
    @config = JSON.parse(File.read(File.expand_path("../AppStore/subscription.json", __dir__)))
    @token = Spaceship::ConnectAPI::Token.create(key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"), filepath: File.expand_path(ENV.fetch("ASC_KEY_PATH")))
  end

  def request(method, path, body: nil, query: {})
    uri = URI(path.start_with?("https://") ? path : "#{ORIGIN}#{path}")
    raise "Unexpected API host" unless uri.scheme == "https" && uri.host == URI(ORIGIN).host
    uri.query = URI.encode_www_form(query) unless query.empty?
    klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch }.fetch(method)
    req = klass.new(uri)
    req["Authorization"] = "Bearer #{@token.text}"
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(body) if body
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 20, read_timeout: 60) { |http| http.request(req) }
    result = response.body.to_s.empty? ? {} : JSON.parse(response.body)
    unless response.is_a?(Net::HTTPSuccess)
      errors = result.fetch("errors", []).map { |e| [e["code"], e["detail"] || e["title"]].compact.join(": ") }.join("; ")
      raise RequestError.new(response.code.to_i, "Apple #{response.code} #{uri.path}: #{errors}")
    end
    if method != :get
      event = { at: Time.now.utc.iso8601, method: method, path: uri.path, resource: result.dig("data", "type"), id: result.dig("data", "id") }
      log = File.expand_path("../.build/asc-subscription-changes.jsonl", __dir__)
      File.open(log, "a") { |file| file.puts(JSON.generate(event)) }
      puts "Updated #{event[:resource]} #{event[:id]}"
    end
    result
  end

  def list(path, query: {})
    values = []
    loop do
      response = request(:get, path, query: query)
      values.concat(response.fetch("data"))
      path = response.dig("links", "next")
      break unless path
      query = {}
    end
    values
  end

  def relation(type, id)
    { data: { type: type, id: id } }
  end

  def create(type, attributes, relationships)
    request(:post, "/v1/#{type}", body: { data: { type: type, attributes: attributes, relationships: relationships } }).fetch("data")
  end

  def run
    identifier = ENV.fetch("ASC_APP_IDENTIFIER", "com.revline.app")
    app = list("/v1/apps", query: { "filter[bundleId]" => identifier }).first
    raise "Create the #{identifier} app record in App Store Connect → My Apps first. Apple does not provide an app-record creation API." unless app
    groups = list("/v1/apps/#{app.fetch('id')}/subscriptionGroups")
    group = nil
    product = nil
    groups.each do |candidate|
      found = list("/v1/subscriptionGroups/#{candidate.fetch('id')}/subscriptions").find { |s| s.dig("attributes", "productId") == @config.fetch("productId") }
      if found
        group = candidate; product = found; break
      end
    end
    unless @apply
      puts JSON.pretty_generate(mode: "plan", app: app.fetch("id"), bundleId: identifier, existingProduct: product&.fetch("id"), configuration: @config)
      puts "Run fastlane ios subscriptions apply:true to create or reconcile this single product. No review submission occurs."
      return
    end
    group ||= groups.find { |g| g.dig("attributes", "referenceName") == @config.fetch("group") }
    group ||= create("subscriptionGroups", { referenceName: @config.fetch("group") }, { app: relation("apps", app.fetch("id")) })
    group_id = group.fetch("id")
    localizations = list("/v1/subscriptionGroups/#{group_id}/subscriptionGroupLocalizations")
    unless localizations.any? { |l| l.dig("attributes", "locale") == "en-US" }
      create("subscriptionGroupLocalizations", { locale: "en-US", name: @config.fetch("groupDisplayName"), customAppName: "Revline" }, { subscriptionGroup: relation("subscriptionGroups", group_id) })
    end
    product ||= create("subscriptions", { name: @config.fetch("name"), productId: @config.fetch("productId"), subscriptionPeriod: @config.fetch("period"), familySharable: false, groupLevel: 1 }, { group: relation("subscriptionGroups", group_id) })
    product_id = product.fetch("id")
    raise "Existing subscription has a different period" unless product.dig("attributes", "subscriptionPeriod") == @config.fetch("period")
    localizations = list("/v1/subscriptions/#{product_id}/subscriptionLocalizations")
    unless localizations.any? { |l| l.dig("attributes", "locale") == "en-US" }
      create("subscriptionLocalizations", { locale: "en-US", name: @config.fetch("name"), description: @config.fetch("description") }, { subscription: relation("subscriptions", product_id) })
    end
    availability = begin
      request(:get, "/v1/subscriptions/#{product_id}/subscriptionAvailability")
    rescue RequestError => error
      raise unless error.status == 404
      { "data" => nil }
    end
    if availability["data"].nil?
      territories = list("/v1/territories", query: { "limit" => 200 })
      create("subscriptionAvailabilities", { availableInNewTerritories: true }, { subscription: relation("subscriptions", product_id), availableTerritories: { data: territories.map { |t| { type: "territories", id: t.fetch("id") } } } })
    end
    configure_prices(product_id)
    puts "Single monthly product reconciled. No subscription or app was submitted for review."
  end

  def configure_prices(product_id)
    base = @config.fetch("baseTerritory")
    points = list("/v1/subscriptions/#{product_id}/pricePoints", query: { "filter[territory]" => base, "limit" => 200, "include" => "territory" })
    point = points.find { |p| BigDecimal(p.fetch("attributes").fetch("customerPrice")) == BigDecimal(@config.fetch("basePrice")) }
    raise "Apple has no exact #{@config.fetch('basePrice')} price point in #{base}; no substitute price was selected." unless point
    equalized = list("/v1/subscriptionPricePoints/#{point.fetch('id')}/equalizations", query: { "limit" => 200, "include" => "territory" })
    all_points = ([point] + equalized).uniq { |p| p.dig("relationships", "territory", "data", "id") }
    prices = list("/v1/subscriptions/#{product_id}/prices", query: { "limit" => 200, "include" => "subscriptionPricePoint,territory" })
    offers = list("/v1/subscriptions/#{product_id}/introductoryOffers", query: { "limit" => 200, "include" => "territory" })
    all_points.each do |price_point|
      territory = price_point.dig("relationships", "territory", "data", "id")
      raise "Apple returned a price point without a territory" unless territory
      target = price_point.fetch("id")
      current = prices.select { |p| p.dig("relationships", "territory", "data", "id") == territory && p.dig("attributes", "startDate").to_s <= Date.today.iso8601 && (p.dig("attributes", "endDate").nil? || p.dig("attributes", "endDate") > Date.today.iso8601) }.max_by { |p| p.dig("attributes", "startDate").to_s }
      if current&.dig("relationships", "subscriptionPricePoint", "data", "id") != target
        create("subscriptionPrices", { preserveCurrentPrice: false }, { subscription: relation("subscriptions", product_id), territory: relation("territories", territory), subscriptionPricePoint: relation("subscriptionPricePoints", target) })
      end
      existing = offers.find { |o| o.dig("relationships", "territory", "data", "id") == territory && o.dig("attributes", "endDate").nil? }
      trial = @config.fetch("trial")
      if existing
        expected = existing.dig("attributes", "duration") == trial.fetch("duration") && existing.dig("attributes", "offerMode") == trial.fetch("mode") && existing.dig("attributes", "numberOfPeriods") == trial.fetch("periods")
        raise "A different introductory offer already exists in #{territory}; review it in App Store Connect." unless expected
      else
        create("subscriptionIntroductoryOffers", { duration: trial.fetch("duration"), offerMode: trial.fetch("mode"), numberOfPeriods: trial.fetch("periods") }, { subscription: relation("subscriptions", product_id), territory: relation("territories", territory) })
      end
    end
  end
end

RevlineSubscriptions.new(apply: ARGV.include?("--apply")).run if $PROGRAM_NAME == __FILE__
