import type { Metadata } from "next"
import { ConsentScreen } from "@/ee/mcp/consent-screen"

export const metadata: Metadata = { title: "Connect an AI app" }

export default function ConnectAuthorizePage() {
  return <ConsentScreen />
}
