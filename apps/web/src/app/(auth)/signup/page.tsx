import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { View } from "@/components/shared/view"
import { SignupForm } from "@/ee/signup"

export const metadata: Metadata = { title: "Create your company" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <SignupForm />
    </View>
  )
}
