import type { Metadata } from "next"
import { Suspense } from "react"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { InviteForm } from "@/components/auth/invite-form"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Accept invite" }

async function Content({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params
  return (
    <View fallback={<AuthFormSkeleton />}>
      <InviteForm token={token} />
    </View>
  )
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
