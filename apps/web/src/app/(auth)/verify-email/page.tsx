import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { View } from "@/components/shared/view"
import { VerifyEmail } from "@/ee/signup"

export const metadata: Metadata = { title: "Confirm your email" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <VerifyEmail />
    </View>
  )
}
