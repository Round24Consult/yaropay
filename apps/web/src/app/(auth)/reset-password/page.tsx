import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { ResetForm } from "@/components/auth/reset-form"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Choose a new password" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <ResetForm />
    </View>
  )
}
