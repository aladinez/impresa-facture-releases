# Impresa Facture downloads

| App               | Download                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Production        | [Current production installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/production) |
| Staging (testing) | [Current staging installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/staging)       |

Choose one installer: **Windows x64 EXE**, **Mac Apple Silicon DMG**, or **Mac Intel DMG**. Update archives, JSON files and GitHub's generated source archives do not need manual installation.

Both apps check for signed updates at startup, download automatically, then show **Installer et redémarrer**. Staging and production use separate API environments and update feeds. Save your work before restarting.

Production installers are customer releases under the owner’s accepted unsigned OS distribution policy. Apple notarization and Windows Authenticode are deferred until requested. Tauri updates remain signed. Keep system security settings enabled.

## Release process

1. Merge the application PR after **Validate** passes.
2. Staging web/API deploy, then both desktop variants are built and staging installers publish. Production binaries stay in a draft until approval. Only then is production approval offered.
3. Approve the single **production** Environment request. Production web/API deploy and production desktop publishes with the **same version and source commit** as staging.
4. The production workflow succeeds after the prepared desktop files publish and the public update feed is verified. Its summary links the installers.

Only approve the latest candidate. A newer staging deployment intentionally blocks approval of an older commit. No manual workflow dispatch, version entry or second production approval is required in the normal flow.

The runtime controller scripts are maintained in the private application repository and synchronized here automatically with each ready staging candidate. The protected workflow is installed separately through a reviewed maintainer change; routine bot pushes do not modify workflow files. Application source, updater private keys and customer data remain private. Production data is never copied from staging.

## One-time credentials and recovery

The private application's Actions secret `RELEASE_ASSETS_TOKEN` needs Contents read/write on this releases repository. The protected production job uses its own `GITHUB_TOKEN` to publish already prepared production files; it needs no token or access to the private repository. Keep the existing required reviewer and bypass restrictions.

For failed builds/uploads, rerun the failed jobs. Production verifies the prepared archive checksum before changing web/API and publishes desktop afterward. Published installers are never overwritten; retries can finish a failed channel upload. The obsolete `DESKTOP_DISPATCH_TOKEN` is no longer used.

`Impresa release automation` is the commit author used by the existing repository-scoped deploy key. It prepares candidates and synchronizes this controller; it does not approve production or create a GitHub account.
