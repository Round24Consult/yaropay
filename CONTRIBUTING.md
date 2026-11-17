# Contributing to YaroPay

Thanks for helping. This guide covers the editions, the contributor licence agreement, local setup and
what a pull request needs.

## Editions and where code goes

YaroPay is open core:

- **Community** (this repository, outside `ee` folders) is licensed under the GNU AGPL v3. Pull
  requests are welcome here.
- **Enterprise and Cloud** add paid features. Their server code lives in a private repository; their
  dashboard code lives in `ee` folders here, under the [YaroPay Enterprise License](ee/LICENSE.md).
  We don't accept outside changes to `ee` folders.

The core must build, test and run with no paid code present. Never import from an `ee` folder in core
code; paid features plug in through the extension points in `apps/api/src/extension`.

## Contributor licence agreement

Before we can merge your first pull request, you sign the [CLA](CLA.md) by commenting on the pull
request:

> I have read the CLA Document and I hereby sign the CLA

A bot records the signature once; later pull requests don't need it again. The CLA lets Round24 Consult
Limited ship your change in every edition while you keep your copyright.

## Local setup

Requires Node 22.12 or newer. No database to install: the API uses an embedded Postgres (PGlite) until
`DATABASE_URL` is set.

```bash
npm install
npm run dev          # shared core + API on :4000 + dashboard on :3000
```

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test             # core unit tests and API tests
npm run e2e          # Playwright, against a throwaway API and a production dashboard build
```

- API code is ESM: relative imports end in `.js`.
- Changing `apps/api/src/database/schema.ts` needs a migration: `npm run db:generate`.
- Add or update tests for behaviour you change. API tests live in `apps/api/test`; browser tests in
  `apps/web/e2e`.
- Keep pull requests focused, and describe what changes for users.

`main` only accepts pull requests, and a pull request merges once these checks pass: typecheck, lint and
tests; API tests on Postgres; end-to-end tests; and both Docker image builds. On a first contribution, a
maintainer approves running the checks.

The pull request's title becomes its line in the release notes, so write it for users ("Stripe gateway",
"Fix duplicate webhook deliveries after a restart"). Maintainers add a label that decides the section:
`gateway`, `feature`, `bug`, `security` or `documentation` (`skip-changelog` leaves it out).

## Releases

Versions follow [semantic versioning](https://semver.org). While YaroPay is below 1.0, a minor version
(0.2.0) can include changes you need to act on; the release notes say what to do.

To cut a release, a maintainer:

1. Opens a pull request that sets the new version in the root `package.json`, `apps/api/package.json`,
   `apps/web/package.json` and `packages/core/package.json`, and merges it once the checks pass.
2. Tags the merge commit and pushes the tag:

   ```bash
   git switch main && git pull
   git tag -a v0.2.0 -m "YaroPay 0.2.0" && git push origin v0.2.0
   ```

The Release workflow checks the tag matches `package.json`, publishes `ghcr.io/round24consult/yaropay/api`
and `ghcr.io/round24consult/yaropay/web` (tagged `0.2.0`, `0.2` and `latest`) and creates the GitHub
Release with notes built from the merged pull requests.

## Security issues

Please don't open public issues for vulnerabilities. Report them privately through GitHub's
"Report a vulnerability" button on the repository's Security tab.
