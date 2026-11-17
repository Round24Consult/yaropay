import { comingSoon } from "../coming-soon.ts"

export const monnify = comingSoon({
  id: "monnify",
  name: "Monnify",
  monogram: "MN",
  tagline: "Reserved accounts and bank transfers in Nigeria",
  website: "https://monnify.com",
  api: { baseUrl: { test: "https://sandbox.monnify.com", live: "https://api.monnify.com" } },
})
