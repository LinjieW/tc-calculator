#!/bin/bash
# Build "薪酬测算.app" — a self-contained, ad-hoc-signed macOS app.
#
# Needs only the Xcode Command Line Tools (swiftc, codesign, iconutil) and
# python3 for the icon. No Xcode project, no packages, no network.
#
#   ./build.sh            build into ./build and copy the .app next to this script
#   ./build.sh --run      build, then launch it
#   ./build.sh --install  build, then also copy it into /Applications
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$PWD"
APP_NAME="薪酬测算"
BUNDLE_ID="local.otcalc"
VERSION="1.0"
BUILD="$ROOT/build"
APP="$BUILD/$APP_NAME.app"

RUN=0; INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --install) INSTALL=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------- preflight
command -v swiftc   >/dev/null || { echo "swiftc not found. Install the Command Line Tools: xcode-select --install" >&2; exit 1; }
command -v codesign >/dev/null || { echo "codesign not found." >&2; exit 1; }

say "清理"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ---------------------------------------------------------------- compile
say "编译 Swift"
swiftc -O \
  -target "$(uname -m)-apple-macosx11.0" \
  -o "$APP/Contents/MacOS/$APP_NAME" \
  "$ROOT/src/main.swift"

# ---------------------------------------------------------------- resources
say "拷贝界面资源"
rm -rf "$APP/Contents/Resources/web"
mkdir -p "$APP/Contents/Resources/web"
cp "$ROOT"/web/*.html "$ROOT"/web/*.css "$ROOT"/web/*.js "$APP/Contents/Resources/web/"

# The source workbook does NOT ride along. It holds real compensation figures
# (see .gitignore), and anything in Resources goes wherever the .app is copied,
# AirDropped or zipped. The guard below refuses to finish a bundle that has one.

# ---------------------------------------------------------------- icon
# Rendered once and cached in build/: it is ~16s of pure-Python rasterising and
# the output only changes when makeicon.py does.
ICON_NAME=""
ICON_CACHE="$BUILD/AppIcon.icns"
if [ -f "$ICON_CACHE" ] && [ "$ICON_CACHE" -nt "$ROOT/tools/makeicon.py" ]; then
  cp "$ICON_CACHE" "$APP/Contents/Resources/AppIcon.icns" && ICON_NAME="AppIcon"
elif command -v python3 >/dev/null && command -v iconutil >/dev/null; then
  say "生成图标"
  if python3 "$ROOT/tools/makeicon.py" "$ICON_CACHE" >/dev/null 2>&1; then
    cp "$ICON_CACHE" "$APP/Contents/Resources/AppIcon.icns" && ICON_NAME="AppIcon"
  else
    echo "    图标生成失败，跳过（不影响运行）"
  fi
fi

# ---------------------------------------------------------------- Info.plist
say "写 Info.plist"
ICON_ENTRY=""
if [ -n "$ICON_NAME" ]; then
  ICON_ENTRY="	<key>CFBundleIconFile</key>
	<string>$ICON_NAME</string>"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>$APP_NAME</string>
	<key>CFBundleDisplayName</key>
	<string>$APP_NAME</string>
	<key>CFBundleExecutable</key>
	<string>$APP_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$VERSION</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
$ICON_ENTRY
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSSupportsAutomaticTermination</key>
	<true/>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.finance</string>
	<key>NSHumanReadableCopyright</key>
	<string>Local use only.</string>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP/Contents/PkgInfo"

# ---------------------------------------------------------------- sign
# Ad-hoc ("-") signature. There is no Developer ID or self-signed certificate in
# this keychain, and for an app that is built and run on this machine none is
# needed: the bundle never carries a quarantine flag, so Gatekeeper does not
# gate it. A signature is still worth having — it is what lets macOS keep the
# app's identity stable across rebuilds, so window position, the saved theme and
# any permissions stay attached to the same app instead of resetting each time.
# ---------------------------------------------------------------- privacy guard
# Nothing that can carry real figures may ship inside the bundle. Captured into a
# variable rather than piped into `grep -q`: under pipefail, grep exiting on the
# first match SIGPIPEs find once its output passes ~16 KB, and the guard passed.
SHEETS=$(find "$APP" \( -iname '*.xls*' -o -iname '*.csv' -o -iname '*.tsv' \
                       -o -iname '*.numbers' -o -iname '*.ods' \) -print)
if [ -n "$SHEETS" ]; then
  echo "refusing to sign: a spreadsheet ended up inside $APP" >&2
  printf '%s\n' "$SHEETS" >&2
  exit 1
fi

say "签名（ad-hoc）"
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 \
  || codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP" && say "签名校验通过"

# ---------------------------------------------------------------- deliver
rm -rf "$ROOT/$APP_NAME.app"
cp -R "$APP" "$ROOT/$APP_NAME.app"

if [ "$INSTALL" = "1" ]; then
  say "安装到 /Applications"
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP" "/Applications/$APP_NAME.app"
fi

# ---------------------------------------------------------------- single file
# The same web/ folded into one self-contained .html, written to index.html at
# the repo root — which is both the shareable file and what GitHub Pages serves.
# Built here rather than on demand so it cannot silently drift from the app: if
# you changed the UI, both change. (web/index.html is the SOURCE; ./index.html is
# the generated bundle. The CI check in .github/workflows verifies they agree.)
if command -v python3 >/dev/null; then
  say "打包单文件 HTML"
  python3 "$ROOT/tools/bundle.py" "$ROOT/web" "$ROOT/index.html"
  rm -f "$ROOT/$APP_NAME.html"     # superseded by index.html; do not keep two copies
fi

say "完成： $ROOT/$APP_NAME.app"

if [ "$RUN" = "1" ]; then
  say "启动"
  open "$ROOT/$APP_NAME.app"
fi
