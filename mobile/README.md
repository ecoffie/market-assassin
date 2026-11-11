# Mindy phone app (iPhone + Android)

A native app shell around the live Mindy web app (`https://getmindy.ai/app`),
built with Capacitor 7. Every website deploy shows up in the app right away,
with no store review needed.

- App ID: `ai.getmindy.app` · Name: **Mindy**
- `capacitor.config.ts`: start URL, which hosts stay in the app, splash and status bar
- `www/`: the offline screen only (shown when the phone has no connection)
- `assets/`: icon and splash sources; regenerate with `npm run assets`
- `android/`, `ios/`: generated native projects (commit them; re-run `npx cap sync` after changing the config or plugins)

## Test on Android
1. GitHub → Actions → **mobile-android** → newest run → Artifacts → **Mindy-android-test**.
2. Unzip it on the phone and open `Mindy-test.apk` (allow "install unknown apps" when asked).

## Test on iPhone (needs a Mac with Xcode)
```bash
cd mobile && npm ci && npx cap sync ios && npx cap open ios
```
In Xcode: plug in the iPhone, pick it as the target, set **Signing & Capabilities → Team**
to your Apple ID, then press Run. With a free Apple ID the build lasts 7 days; with
the paid Apple Developer account ($99/yr) use Product → Archive → TestFlight instead.

## Known limits (v1)
- **Google sign-in does not work inside the app.** Google blocks its sign-in page in
  embedded web views. Email + password sign-in works. Fix: native Google/Apple sign-in
  that opens the system browser and returns to the app.
- **App Store review:** Apple can reject apps that are only a website. Before submitting,
  add at least one phone-only feature (push notifications for daily alerts is the plan).

## Store release (later)
- Google Play: $25 developer account, a signed release build (`./gradlew bundleRelease` with an upload key).
- Apple App Store: $99/yr developer account, archive in Xcode, submit through App Store Connect.
