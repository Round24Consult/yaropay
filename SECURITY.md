# Security policy

YaroPay routes payments, so we treat security reports as urgent.

## Reporting a vulnerability

Please don't open a public issue. Report it privately, either way:

- **GitHub:** the **Security** tab of this repository → **Report a vulnerability**.
- **Email:** [hello@yaropay.com](mailto:hello@yaropay.com) with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We reply within
3 working days, keep you updated while we fix it, and credit you in the release notes if you want.

Please test only against your own installation or test-mode data, never against other people's
accounts or app.yaropay.com customers' data, and give us a reasonable time to fix the issue before
you disclose it.

## Supported versions

Security fixes go into the latest release and the hosted edition at app.yaropay.com. Self-hosted
installs get them by updating to the latest version.

## How YaroPay protects data

The [security model](https://yaropay.com/docs/security) explains what is protected and how: encrypted
gateway keys, signed webhooks, isolated companies, two-step sign-in and the audit log.
