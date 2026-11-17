"use client"

import { Eye, EyeOff } from "lucide-react"
import * as React from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

/** Password field with a show/hide toggle. */
export function PasswordInput({ invalid, ...props }: React.ComponentProps<"input"> & { invalid?: boolean }) {
  const [shown, setShown] = React.useState(false)
  return (
    <InputGroup>
      <InputGroupInput type={shown ? "text" : "password"} spellCheck={false} aria-invalid={invalid} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"}>
          {shown ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
