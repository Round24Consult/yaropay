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

## Security issues

Please don't open public issues for vulnerabilities. Report them privately through GitHub's
"Report a vulnerability" button on the repository's Security tab.
