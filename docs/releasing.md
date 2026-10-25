# Mac packaging and releases

Rowfish separates verification, preview artifacts, dependency-update PRs and intentional release publishing. Workflows use hosted runners; they do not assume Surffish’s private runner labels exist here.

## Manual Mac test package

After `.github/workflows/mac-package.yml` is on the repository's default branch, open **Actions → mac-package → Run workflow** and choose a branch. It runs tests, type checks and a native macOS package build, then uploads unsigned DMG/ZIP files for Apple Silicon (`arm64`) as a temporary workflow artifact. This does **not** create a GitHub Release. Artifacts are retained for 14 days.

The workflow has no signing secrets. It sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and packages unsigned test builds. To install them locally, download the artifact from the completed workflow run and use the normal macOS first-open flow; if Gatekeeper quarantines the app, follow Apple's local-development guidance before opening it. Do not distribute unsigned artifacts as a finished product.

## Tagged GitHub release

The `.github/workflows/release.yml` workflow only runs after an intentional `v*` tag push. It validates the stable/prerelease tag and checks that its version matches `package.json`, then builds and tests on `macos-14`, packages Apple Silicon (`arm64`) and publishes the files as a GitHub Release with generated release notes and `SHA256SUMS.txt` checksums.

To trigger one after the change is merged and ready:

```bash
# First update package.json's version and commit that change on main.
git tag v0.1.0
git push origin v0.1.0
```

Replace `0.1.0` with the version in `package.json`. The tag push is the publishing action; never create or push a release tag just to test compilation. Use the manual Mac package workflow for non-publishing checks.

## Signing and distribution

The Mac targets already enable hardened runtime and use `build/entitlements.mac.plist`. They remain unsigned by default. Developer ID signing and notarization can be added later by configuring the app owner's signing credentials in GitHub Actions; Rowfish does not store or request signing secrets.

## Homebrew

This repo doubles as the Homebrew tap (`brew tap pylotlight/rowfish https://github.com/PylotLight/Rowfish.git`, then `brew install --cask rowfish`). After a release publishes (including prereleases), the `homebrew` job in `release.yml` renders `Casks/rowfish.rb` from `Casks/rowfish.rb.tmpl` with the new version and the arm64 zip SHA-256 and pushes it to main. Edit the template, never the rendered file.

## Verification and preview workflows

- **verify (`ci.yml`)** runs on pushes to main, pull requests and manual dispatch. It uses PostgreSQL 16 and a disposable fixture to exercise the actual Electron app under Xvfb, in addition to unit/type/build checks. It keeps diagnostic screenshots/results as artifacts.
- **Screenshots (`screenshots.yml`)** manually repeats the PostgreSQL desktop suite and uploads screenshot/result artifacts for 14 days. It never commits images or publishes a release.
- **windows build (`windows-build.yml`)** produces unsigned, experimental Windows ZIP artifacts for x64, arm64 or both on demand. Workflow-file pull requests build x64. This is a packaging smoke path, not completed native Windows product QA; it does not change Mac release publishing.
- **Electron bump (`electron-bump.yml`)** checks the latest stable Electron weekly or a manually selected stable version. It rejects downgrades, updates only the Electron pin plus lockfile, and opens/reuses an update PR without auto-merging. Dry-run never changes remote state. The job explicitly dispatches verification because GITHUB_TOKEN-created PRs do not trigger recursive CI. The repository must allow Actions to create pull requests.

These workflows have been edited and validated locally. Committing/pushing them is necessary before GitHub can execute them; local validation is not a successful remote run. Signing/notarization and native platform smoke checks remain separate.
