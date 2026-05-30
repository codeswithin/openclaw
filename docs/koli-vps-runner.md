## ⚠️ CRITICAL: Do Not Re-trigger Workflows

**NEVER trigger a new workflow run on the same branch while one is already in progress.** The self-hosted runner can only run one job at a time. Each new dispatch cancels the previous in-progress run, wasting 45+ minutes of build time.

- Build takes ~30 minutes (Gradle + CMake for native modules)
- Firebase Test Lab tests take ~10-15 minutes
- Total: ~45-60 minutes per run
- The workflow has NO `concurrency` / `cancel-in-progress` setting

**Rule:** Before dispatching a new run, check if one is already running. If it is, wait for it to finish.

# koli-co Self-Hosted GitHub Actions Runner

## Overview

A self-hosted GitHub Actions runner is installed on this VPS (`srv1539099`) for the `koli-co/koli-app2` repo. It runs as a systemd service and has Android SDK + NDK pre-installed.

## Service Details

- **Service Name:** `koli-runner`
- **User:** `paperclip`
- **Runner Name:** `koli-vps-runner`
- **Labels:** `self-hosted`, `linux`, `x64`, `koli-vps`
- **Workflow YAML `runs-on`:** `[self-hosted, linux, x64, koli-vps]`
- **Install Path:** `/opt/actions-runner`
- **Work Dir:** `/opt/actions-runner/_work`

### Commands

| Action | Command |
|---|---|
| Restart runner | `systemctl restart koli-runner` |
| Check status | `systemctl status koli-runner --no-pager` |
| View logs | `journalctl -u koli-runner -n 50 --no-pager` |

## Environment Variables

Set in `/etc/systemd/system/koli-runner.service`:

```
ANDROID_HOME=/opt/android-sdk
ANDROID_SDK_ROOT=/opt/android-sdk
```

Also copied to `/opt/actions-runner/.env` for reference.

## Pre-Installed Android SDK

Located at `/opt/android-sdk/`:

| Component | Version |
|---|---|
| Platforms | android-36 |
| Build Tools | 35.0.0 |
| NDK | 27.0.12077973, 27.1.12297006 |
| CMake | 3.22.1 |
| Platform Tools | Installed |

## Known Issues & Fixes

### 1. Metro Cache Permissions

**Symptom:** `Error: EACCES: permission denied, rmdir '/tmp/metro-cache/00'` during `createBundleReleaseJsAndAssets`

**Cause:** Metro bundler tries to clean `/tmp/metro-cache` created by a previous build running as a different user (root vs paperclip).

**Fix:** Added a `Clean Metro cache` step in the workflow before the Gradle build:
```yaml
- name: Clean Metro cache
  run: rm -rf /tmp/metro-cache
```

If the step is not in the workflow, run manually:
```bash
rm -rf /tmp/metro-cache
```

### 2. ANDROID_HOME not found in self-hosted runner

**Symptom:** `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable`

**Cause:** The old runner at `/home/paperclip/actions-runner/` (now deleted) didn't have env vars set. The systemd service at `/opt/actions-runner/` has them via `Environment=` directive.

**Fix:** If env vars are missing, add to systemd service:
```bash
sed -i '/^Group=/a Environment="ANDROID_HOME=/opt/android-sdk"\nEnvironment="ANDROID_SDK_ROOT=/opt/android-sdk"' /etc/systemd/system/koli-runner.service
systemctl daemon-reload && systemctl restart koli-runner
```

### 3. Firebase Test Lab - Required APIs to Enable

Firebase Test Lab requires TWO APIs to be enabled on the GCP project.

**GCP Project:** `mimetic-science-406407` (project number: `947439590531`)
**Service Account Key File:** `/tmp/firebase-service-account.json`

#### API 1: Cloud Tool Results API (for storing test results)

**Symptom:** `Cloud Tool Results API has not been used in project 947439590531 before or it is disabled`

**Fix (Browser - quickest):**
1. Click: https://console.cloud.google.com/apis/api/toolresults.googleapis.com/overview?project=mimetic-science-406407
2. Click **Enable**
3. Wait 2-3 min for propagation
4. Re-run the workflow

**Fix via gcloud CLI:**
```bash
gcloud auth activate-service-account --key-file=/tmp/firebase-service-account.json
gcloud config set project mimetic-science-406407
gcloud services enable toolresults.googleapis.com
```

**Fix via REST API:**
```bash
ACCESS_TOKEN=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type=jwt-bearer" \
  -d "assertion=$(python3 -c '
import json, time, jwt
with open("/tmp/firebase-service-account.json") as f:
    sa = json.load(f)
token = jwt.encode({"iss": sa["client_email"], "sub": sa["client_email"],
    "aud": "https://oauth2.googleapis.com/token", "iat": int(time.time()),
    "exp": int(time.time()) + 3600,
    "scope": "https://www.googleapis.com/auth/cloud-platform"},
    sa["private_key"], algorithm="RS256")
print(token)
') " 2>&1 | jq -r '.access_token')

curl -s -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://serviceusage.googleapis.com/v1/projects/mimetic-science-406407/services/toolresults.googleapis.com:enable"
```

#### API 2: Cloud Testing API

**Symptom:** `Cloud Testing API has not been used in project 947439590531 before or it is disabled`

**Fix (Browser):** https://console.cloud.google.com/apis/api/testing.googleapis.com/overview?project=mimetic-science-406407

**Fix via gcloud:**
```bash
gcloud services enable testing.googleapis.com
```

**Fix via REST:** Same pattern as API 1, change URL to `testing.googleapis.com`.

### 4. Firebase Test Lab - APK Not Found (Relative Path Issue)

**Symptom:** `(gcloud.firebase.test.android.run) [app/build/outputs/apk/release/app-release.apk] not found or not accessible`

**Cause:** The build step runs `cd android && ./gradlew assembleRelease` and sets `$APK_PATH` via `find app/build/outputs/apk/release -name "*.apk"`. This creates a relative path like `app/build/outputs/apk/release/app-release.apk`. But when the gcloud firebase command runs later, the working directory is the repo root — not `android/`. So the relative path doesn't resolve.

**Fix:** Prefix the find path with `$GITHUB_WORKSPACE`:

Before (broken):
```yaml
APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
```

After (fixed):
```yaml
APK=$(find $GITHUB_WORKSPACE/android/app/build/outputs/apk/release -name "*.apk" | head -1)
```

---

#### ALSO IMPORTANT: Billing Must Be Enabled

Firebase Test Lab requires billing even for free-tier usage. If you get:
```
Permission denied while creating bucket. Is billing enabled for project?
```

Fix:
1. Go to https://console.cloud.google.com/billing/linkedaccount?project=mimetic-science-406407
2. Link a billing account

#### Verify APIs are enabled

```bash
gcloud auth activate-service-account --key-file=/tmp/firebase-service-account.json
gcloud services list --enabled --project=mimetic-science-406407 | grep -E "toolresults|testing"
```

### 5. Firebase Test Lab - Robo Login Script

To make Robo test use real login credentials, the workflow now includes a **logged-in Robo test** step that passes a `TestLabLogin.robo` script.

**Script location:** `scripts/TestLabLogin.robo` in the repo
**Credentials in script (hardcoded):** `koliapp2019@gmail.com` / `koliapp2019`

**How the workflow is structured:**
- **Guest Robo** (5 min timeout) — explores the app without logging in
- **Logged-In Robo** (10 min timeout) — executes the login script first, then explores after auth
- Results are saved in separate directories (`guest/` vs `logged-in/`) within the artifact zip

**To update credentials:** Edit `scripts/TestLabLogin.robo` and commit to `rn0831`.

**Note:** React Native apps render UI via JavaScript, so resource IDs aren't native Android `R.id.*` values. The robo script uses text-based selectors (`resourceName` matching text hints). If the login screen layout changes, the script may need updates.

### 6. Testing iOS

Firebase Test Lab **does not support iOS app testing** (it only runs Android virtual/physical devices).

For iOS testing on this project:
- **Codemagic** builds the iOS app already (via `codemagic.yaml`)
- iOS devices only run tests on **macOS** (Xcode required)
- Options for iOS automated testing:
  1. **Add iOS device tests to Codemagic workflow** — Codemagic can run XCTests/XCUITests on real iOS devices after each build
  2. **BrowserStack / Sauce Labs / AWS Device Farm** — cloud iOS device testing services (paid)
  3. **GitHub Actions macOS runner** — could use a self-hosted macOS runner with Xcode installed

**Recommended approach:** Add an iOS smoke test step to Codemagic's `react-native-ios` workflow using their built-in device testing.

## Workflow History

| Run # | Result | Issue |
|---|---|---|
| 1 | ❌ | No npm install before gradle build (free runner, fixed) |
| 2 | ❌ | Cancelled by GitHub (free runner 6h timeout) |
| 3-5 | ❌ | ANDROID_HOME not set on self-hosted runner (old duplicate runner) |
| 6 | ❌ | Metro cache EACCES permission denied |
| 7 | ❌ | YAML parse error (broken sed) |
| 8 | ✅ Build / ❌ Firebase | Build succeeded; Cloud Testing API disabled |
| 9 | ✅ Build / ❌ Firebase | Cloud Testing API enabled; deprecated Pixel2 device |
| 10 | ✅ Build / ❌ Firebase | Device fixed; billing / Tool Results API needed |
| 11 | ❌ | Short-lived; probably tool-results |
| 12 | ❌ Firebase | Build ok; APK relative path issue |
| 13-14 | — | Test runs from corrupted workflow (blank file) |
| 15 | ✅ All | First full green run |

## GitHub Token

Token for `koli-co` operations is stored in `/root/.openclaw/workspace/.secrets/tokens.md`.
