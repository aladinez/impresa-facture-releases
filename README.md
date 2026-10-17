# Impresa foundation releases

This repository contains public desktop downloads and production deployment controls. Application source remains private. The application is currently a synthetic foundation demonstration, not a commercial release.

## Production approval

After successful staging deployment, automation writes `candidate.json` and opens a production approval request. Open Actions → Approve production promotion → the waiting run → Review deployments. Review the linked staging evidence, migrations and backup readiness, then approve production. No SHA entry or manual workflow launch is required. A manual Run workflow remains available to retry the recorded candidate. Only `aladinez` can approve; administrator bypass is disabled. The job verifies staging again after approval and rebuilds that same commit in production. Railway Hobby does not support private registry image pulls, so this is same-commit promotion, not identical-image promotion.

Only web/API revisions change. Production PostgreSQL data is never copied from staging. The API's controlled pre-deploy migration step applies migrations with a database advisory lock. Rollback must use a schema-compatible commit; never automatically reverse migrations.

## Downloads and updates

Windows installers (`.exe`) and macOS installers (`.dmg`) belong under Releases. Staging and production have separate application identities, APIs, signing keys and update feeds. The desktop checks for signed updates at startup and downloads automatically, then asks the user to install/restart.

No installers are published until the release build succeeds. Initial builds are test builds: Apple notarization and Windows Authenticode certificates have not yet been supplied. Tauri update signatures authenticate updates but do not replace operating-system code signing.

The canonical release-control source is maintained in the private application's `infra/release-control` directory. Do not copy application source or secrets into this repository.

## Current test downloads

- [Production 0.1.0 — Windows and macOS](https://github.com/aladinez/impresa-facture-releases/releases/tag/desktop-production-v0.1.0)
- [Staging 0.1.0 — Windows and macOS](https://github.com/aladinez/impresa-facture-releases/releases/tag/desktop-staging-v0.1.0)

Both are synthetic foundation test releases without OS signing/notarization. Their updater feeds are separate. Desktop building/publication is coupled to web/API releases once the matching private workflow and scoped secrets are configured. After the existing production approval and successful deployment, this controller dispatches the private desktop workflow on the exact immutable application revision. Native builds and version/feed publication then run automatically; install/restart remains a user click.

## Automatic desktop activation

The application repository needs Actions repository secret `RELEASE_ASSETS_TOKEN`, from a fine-grained GitHub token restricted to this public releases repository with Contents read/write. This repository's existing protected **production Environment** needs `DESKTOP_DISPATCH_TOKEN`, restricted to the private `aladinez/impresa-facture` repository with Actions read/write. Keep reviewer/bypass restrictions unchanged; never put the dispatch token in an unrestricted public repository secret. Existing updater and Railway secrets remain unchanged.

Merge the matching private workflow first, then this controller change. Re-run the production workflow on main for the latest automation-capable candidate if its previous approval was queued before this workflow merge; cancel the older waiting approval. Do not approve an older application candidate that lacks the new desktop dispatch inputs. Detailed owner setup and recovery instructions are in the private application's `docs/DESKTOP-AUTOMATION.md`.

The desktop publisher verifies this workflow's successful run and immutable candidate against the build source, checks all native jobs, and rejects superseded promotions. The public controller receives no private application source or updater signing key. A missing dispatch token fails the final step after deployment; restore its secret and retry the controlled workflow without bypassing approval.

## Automation author

`Impresa release automation` is a Git commit author label. It uses the explicitly approved write deploy key scoped to this repository, with its private half stored in the private application repository’s Actions secrets. It writes release candidates after staging succeeds; it does not approve production. Revoke the deploy key and remove `RELEASE_CANDIDATE_SSH_KEY` from the private repository to disable this connection. No new GitHub user account was created.
