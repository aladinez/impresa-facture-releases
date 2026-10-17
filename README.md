# Impresa foundation releases

This repository contains public desktop downloads and production deployment controls. Application source remains private. The application is currently a synthetic foundation demonstration, not a commercial release.

## Production approval

After successful staging deployment, automation writes `candidate.json` and opens a production approval request. Open Actions → Approve production promotion → the waiting run → Review deployments. Review the linked staging evidence, migrations and backup readiness, then approve production. No SHA entry or manual workflow launch is required. A manual Run workflow remains available to retry the recorded candidate. Only `aladinez` can approve; administrator bypass is disabled. The job verifies staging again after approval and rebuilds that same commit in production. Railway Hobby does not support private registry image pulls, so this is same-commit promotion, not identical-image promotion.

Only web/API revisions change. Production PostgreSQL data is never copied from staging. The API's controlled pre-deploy migration step applies migrations with a database advisory lock. Rollback must use a schema-compatible commit; never automatically reverse migrations.

## Downloads and updates

Windows installers (`.exe`) and macOS installers (`.dmg`) belong under Releases. Staging and production have separate application identities, APIs, signing keys and update feeds. The desktop checks for signed updates at startup and downloads automatically, then asks the user to install/restart.

No installers are published until the release build succeeds. Initial builds are test builds: Apple notarization and Windows Authenticode certificates have not yet been supplied. Tauri update signatures authenticate updates but do not replace operating-system code signing.

The canonical release-control source is maintained in the private application's `infra/release-control` directory. Do not copy application source or secrets into this repository.
