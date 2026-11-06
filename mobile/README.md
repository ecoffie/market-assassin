# Mindy mobile (iOS + Android)

Capacitor shell that loads **https://getmindy.ai/app** inside a native app.
Every web deploy updates the app instantly — no store re-submission for UI changes.

- App ID: `ai.getmindy.app` · Name: **Mindy**
- Native: splash, status bar, push notifications, offline screen, system-browser for outside links (Stripe, OAuth)
- User agent ends in `MindyApp` so the web app can detect it.
- CI: `.github/workflows/mobile-build.yml` → Android debug APK artifact + iOS compile check.

## One-time accounts
| Store | Cost | Link |
|---|---|---|
| Apple Developer Program | $99/yr | developer.apple.com/programs |
| Google Play Console | $25 once | play.google.com/console |

## iPhone (needs a Mac + Xcode 16+)
```bash
cd mobile && npm ci && npx cap sync ios && npx cap open ios
```
In Xcode: **Signing & Capabilities** → pick your Team → add **Push Notifications** capability →
Product ▸ Archive → Distribute ▸ App Store Connect → submit in App Store Connect.

## Google Play (Android Studio)
```bash
cd mobile && npm ci && npx cap sync android && npx cap open android
```
Add `android/app/google-services.json` from Firebase (for push) → Build ▸ Generate Signed Bundle (AAB)
→ upload to Play Console (Internal testing first, then Production).

## Regenerate icons / splash
Replace `resources/icon-only.png` (1024²) or `resources/splash.png` (2732²), then `npm run assets && npx cap sync`.

## Known gaps before store submission
1. **Google / Microsoft sign-in** — Google blocks sign-in inside app WebViews, so those buttons open the
   system browser and the session lands there, not in the app. Email + password works in-app today.
   Fix: deep-link callback (`ai.getmindy.app://auth/callback`) + `@capacitor/browser`.
2. **Apple guideline 3.1.1 (payments)** — Pro upgrade goes to Stripe. Either hide the upgrade button
   when the UA contains `MindyApp`, or use the US external-purchase link entitlement.
3. **Apple guideline 4.2 (minimum functionality)** — a pure website wrapper is often rejected. Push
   notifications for daily alerts are the native feature that gets this approved — needs server-side
   APNs/FCM sending wired to `user_notification_settings`.
4. **Sign in with Apple** is required by Apple when Google sign-in is offered — already exists on the web.
