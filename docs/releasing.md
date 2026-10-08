# Mac packaging and releases

Rowfish has two GitHub Actions paths with deliberately different effects.

## Manual Mac test package

After `.github/workflows/mac-package.yml` is on the repository's default branch, open **Actions → mac-package → Run workflow** and choose a branch. It runs tests, type checks and a native macOS package build, then uploads unsigned DMG/ZIP files for Apple Silicon (`arm64`) and Intel (`x64`) as a temporary workflow artifact. This does **not** create a GitHub Release. Artifacts are retained for 14 days.

The workflow has no signing secrets. It sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and packages unsigned test builds. To install them locally, download the artifact from the completed workflow run and use the normal macOS first-open flow; if Gatekeeper quarantines the app, follow Apple's local-development guidance before opening it. Do not distribute unsigned artifacts as a finished product.

## Tagged GitHub release

The `.github/workflows/release.yml` workflow only runs after an intentional `v*` tag push. It checks that the tag version matches `package.json`, then builds and tests on `macos-14`, packages both architectures and publishes the files as a GitHub Release with generated release notes.

To trigger one after the change is merged and ready:

```bash
# First update package.json's version and commit that change on main.
git tag v0.1.0
git push origin v0.1.0
```

Replace `0.1.0` with the version in `package.json`. The tag push is the publishing action; never create or push a release tag just to test compilation. Use the manual Mac package workflow for non-publishing checks.

## Signing and distribution

The Mac targets already enable hardened runtime and use `build/entitlements.mac.plist`. They remain unsigned by default. Developer ID signing and notarization can be added later by configuring the app owner's signing credentials in GitHub Actions; Rowfish does not store or request signing secrets and does not update a Homebrew tap.
