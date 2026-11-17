import { resetTwoStep, setPlatformRole } from "../auth/account-repairs.js"
import { loadConfig } from "../config/config.js"
import { openDatabase } from "../database/db.js"

/**
 * Account commands for whoever runs the server. Inside the API container:
 *
 *   node dist/cli/accounts.js reset-two-step <email>      turn off two-step sign-in for a locked-out account
 *   node dist/cli/accounts.js grant-super-admin <email>   open the Cloud platform console to this account
 *   node dist/cli/accounts.js revoke-super-admin <email>  close it again (and sign the account out)
 */

const USAGE = `Usage: node dist/cli/accounts.js <command> <email>

  reset-two-step <email>      Turn off two-step sign-in for someone who lost their phone and recovery codes
  grant-super-admin <email>   Make the account a super admin (YaroPay Cloud platform console)
  revoke-super-admin <email>  Remove super admin and sign the account out`

const COMMANDS = ["reset-two-step", "grant-super-admin", "revoke-super-admin"]
const [command, email] = process.argv.slice(2)
if (!COMMANDS.includes(command) || !email) {
  console.error(USAGE)
  process.exit(2)
}

const handle = await openDatabase(loadConfig())
try {
  if (command === "reset-two-step") {
    const result = await resetTwoStep(handle.db, email)
    if (result.kind === "no_account") {
      console.error(`No account for ${email}.`)
      process.exitCode = 1
    } else if (result.kind === "already_off") console.log(`Two-step sign-in is already off for ${result.email}.`)
    else console.log(`Two-step sign-in is off for ${result.email} and their sessions were signed out. They can sign in with their password and set it up again.`)
  } else {
    const grant = command === "grant-super-admin"
    const result = await setPlatformRole(handle.db, email, grant ? "super_admin" : null)
    if (result.kind === "no_account") {
      console.error(`No account for ${email}.`)
      process.exitCode = 1
    } else if (result.kind === "unchanged") console.log(`${result.email} ${grant ? "is already" : "isn't"} a super admin.`)
    else if (grant) console.log(`${result.email} is now a super admin. The console needs two-step sign-in, and only exists in YaroPay Cloud (YAROPAY_CLOUD=true).`)
    else console.log(`${result.email} is no longer a super admin and was signed out.`)
  }
} finally {
  await handle.close()
}
