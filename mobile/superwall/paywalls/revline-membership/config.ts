import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Revline membership",
  platforms: ["ios"],
  products: { monthly: "com.revline.app.monthly" },
  background: { light: "#0B0C0E", dark: "#0B0C0E" },
  presentation: { style: "fullscreen" },
  featureGating: "gated",
  introductoryOfferEligibility: "automatic",
  postPurchase: "dismiss",
  insets: "safe-area",
});
