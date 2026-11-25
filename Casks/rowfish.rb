# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/rowfish.rb.tmpl instead — this file is rendered from it.
cask "rowfish" do
  version "0.2.0-beta.5"
  sha256 "0358dcb02e0d6f4eb5f1108872e56ed8e9f7a04533d233580de4e83d6f80cc3a"

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
