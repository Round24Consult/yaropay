import type { Metadata } from "next"
import { AuthFormSkeleton } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Sign in" }

export default function Page() {
  return (
    <View fallback={<AuthFormSkeleton />}>
      <LoginForm />
    </View>
  )
}
