# Impresa Facture downloads

| App               | Download                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Production        | [Current production installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/production) |
| Staging (testing) | [Current staging installers](https://github.com/aladinez/impresa-facture-releases/releases/tag/staging)       |

Choose one installer: **Windows x64 EXE**, **Mac Apple Silicon DMG**, or **Mac Intel DMG**. Update archives, JSON files and GitHub's generated source archives do not need manual installation.

Both apps check for signed updates at startup, download automatically, then show **Installer et redémarrer**. Staging and production use separate API environments and update feeds. Save your work before restarting.

Apple notarization and Windows Authenticode are not configured. Keep system security settings enabled.

## Release process

1. Merge the application PR after **Validate** passes.
2. Staging web/API deploy, then all three staging desktop installers publish. Only then is production approval offered.
3. Approve the single **production** Environment request. Production web/API deploy and production desktop publishes with the **same version and source commit** as staging.
4. The production workflow succeeds after its desktop build and public update feed are verified. Its summary links the installers.

Only approve the latest candidate. A newer staging deployment intentionally blocks approval of an older commit. No manual workflow dispatch, version entry or second production approval is required in the normal flow.

The controller is maintained in the private application repository and synchronized here automatically with each ready staging candidate. Application source, updater private keys and customer data remain private. Production data is never copied from staging.

## One-time credentials and recovery

The private application's Actions secret `RELEASE_ASSETS_TOKEN` needs Contents read/write on this releases repository. This repository's protected **production Environment** secret `DESKTOP_DISPATCH_TOKEN` needs Actions read/write on the private `aladinez/impresa-facture` repository. Keep the existing required reviewer and bypass restrictions.

A token rejected with HTTP 403 must be corrected in GitHub account fine-grained token settings and saved to the matching secret. The controller checks desktop dispatch before changing production web. After correcting configuration, rerun the failed production job through its existing approval gate. Desktop retries reuse the original build where possible.

`Impresa release automation` is the commit author used by the existing repository-scoped deploy key. It prepares candidates and synchronizes this controller; it does not approve production or create a GitHub account.
