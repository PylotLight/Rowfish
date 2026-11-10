# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/rowfish.rb.tmpl instead — this file is rendered from it.
cask "rowfish" do
  version "0.2.0-beta.4"
  sha256 "7a81ea180cdcf5055299adea20060c05fc6b77115be2eeb7e1e08ca1b8cc8f88"

  url "https://github.com/PylotLight/Rowfish/releases/download/v#{version}/Rowfish-#{version}-mac-arm64.zip"
  name "Rowfish"
  desc "PostgreSQL-first desktop database client with MongoDB support"
  homepage "https://github.com/PylotLight/Rowfish"

  depends_on arch: :arm64
  depends_on macos: :monterey

  app "Rowfish.app"

  caveats <<~EOS
    Rowfish is unsigned. If macOS reports it is "damaged", run:
      xattr -cr /Applications/Rowfish.app
    (Homebrew removed the --no-quarantine flag in v6, so clearing the
    quarantine flag manually is now required.)
  EOS

  zap trash: [
    "~/Library/Application Support/Rowfish",
    "~/Library/Caches/com.pylotlight.rowfish",
    "~/Library/HTTPStorages/com.pylotlight.rowfish",
    "~/Library/Preferences/com.pylotlight.rowfish.plist",
    "~/Library/Saved Application State/com.pylotlight.rowfish.savedState",
  ]
end
