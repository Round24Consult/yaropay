import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { ForgotForm } from "@/components/auth/forgot-form"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Reset password" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <ForgotForm />
    </View>
  )
}
