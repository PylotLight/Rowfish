# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/rowfish.rb.tmpl instead — this file is rendered from it.
cask "rowfish" do
  version "0.1.1"
  sha256 "77bee11438d3db1cb73d37a6cfc9eeb84f5c50a4f6638c2637d7b6a8647f68b0"

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
