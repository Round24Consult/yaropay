import type { Metadata } from "next"
import { ApprovalScreen } from "@/ee/mcp/approval-screen"

export const metadata: Metadata = { title: "Approve an AI app action" }

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ApprovalScreen id={id} />
}
