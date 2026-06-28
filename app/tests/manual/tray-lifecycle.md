# Manual test plan — Wenlan tray + lifecycle

Run before merging lifecycle/runtime identity changes. Requires a clean test
user account or willingness to replace an existing Wenlan install. Legacy
Origin LaunchAgents may be present to verify bridge cleanup, but the current
install target is Wenlan.

## Setup

```bash
pkill -9 -f 'Wenlan.app|wenlan-app'
pkill -9 -f wenlan-server
pkill -9 -f origin-server  # legacy bridge cleanup path
rm -f ~/Library/LaunchAgents/com.wenlan.{server,desktop}.plist
rm -f ~/Library/LaunchAgents/com.origin.{server,desktop}.plist
# Reset opt-out sentinel file if present:
rm -f ~/Library/Application\ Support/wenlan/auto_start_disabled.flag
rm -f ~/Library/Application\ Support/origin/auto_start_disabled.flag

# Build:
cd /Users/lucian/Repos/wenlan-app
CXXFLAGS="-std=c++17" pnpm release

# Install:
sudo rm -rf /Applications/Wenlan.app
sudo cp -r target/release/bundle/macos/Wenlan.app /Applications/
sudo xattr -cr /Applications/Wenlan.app
```

## Steps


| #   | Action                                                                                                                                                        | Expected                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Double-click `/Applications/Wenlan.app`                                                                                                                         | Window appears and focuses; `launchctl list` shows both current `com.wenlan` plists                                                                  |
| 2   | Click red X on window                                                                                                                                           | Window hides; app process/tray health stays alive                                                                                                    |
| 3   | Re-open Wenlan from Dock or Finder                                                                                                                              | Existing instance focuses via single-instance plugin; no duplicate app process (`pgrep -c -f "MacOS/wenlan-app"`)                                    |
| 4   | App menu or settings action → Quit Wenlan                                                                                                                        | App exits within 2s; daemon dead (`lsof -ti :7878` empty); current plists removed from `~/Library/LaunchAgents/`                                     |
| 4a  | Re-launch `/Applications/Wenlan.app`                                                                                                                            | App launches; current plists re-installed; `~/Library/Application Support/wenlan/auto_start_disabled.flag` absent                                    |
| 5   | Reboot Mac, or run `launchctl bootout gui/$(id -u)/com.wenlan.server; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wenlan.{server,desktop}.plist` | Current plists auto-load; daemon up; Wenlan app can be focused from Dock/Finder                                                                       |
| 6   | Settings → toggle "Run at login" off                                                                                                                            | App exits within 2s; daemon dies; current plists removed from `~/Library/LaunchAgents/`; owned legacy Origin plists are cleaned if present             |
| 7   | Open Wenlan.app from /Applications after Step 6                                                                                                                  | App runs; setup detects `auto_start_disabled.flag`, skips silent install, and spawns daemon as a Tauri child fallback                                 |
| 8   | Settings → toggle "Run at login" on                                                                                                                             | Daemon up; current plists re-installed; `auto_start_disabled.flag` removed                                                                            |
| 9   | `pkill -9 -f wenlan-server` (do NOT use `kill $(lsof -ti :7878)` because it can also kill the app keep-alive client)                                             | Health indicator goes down briefly, then active again after launchd respawn                                                                           |
| 10  | Create owned legacy `com.origin.{server,desktop}.plist`, then launch Wenlan                                                                                      | Owned legacy Origin plists are unloaded/removed only after current Wenlan replacements are installed; foreign legacy files are preserved              |
| 11  | First run with `chmod -w ~/Library/LaunchAgents/` (permissions denied)                                                                                          | App remains usable in fallback mode; no silent deletion of user/foreign LaunchAgent files                                                             |


## Cleanup

```bash
chmod +w ~/Library/LaunchAgents/  # restore if step 11 was tested
sudo rm -rf /Applications/Wenlan.app  # optional
```
