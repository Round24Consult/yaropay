import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { SetupForm } from "@/components/auth/setup-form"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Set up" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <SetupForm />
    </View>
  )
}
