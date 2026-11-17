import { comingSoon } from "../coming-soon.ts"

export const stripe = comingSoon({
  id: "stripe",
  name: "Stripe",
  monogram: "ST",
  tagline: "Global cards, wallets and local methods",
  website: "https://stripe.com",
  api: { baseUrl: "https://api.stripe.com" },
})
