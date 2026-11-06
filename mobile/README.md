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

## How sign-in works in the app
Google blocks sign-in inside app WebViews, so in the app the Google/Microsoft/Apple buttons open the
**system browser**. After sign-in, `/app/auth/callback?native=1` → `/app/auth/native-return` deep-links
`ai.getmindy.app://auth?to=…#tokens` back into the app, which closes the browser and finishes sign-in
in the WebView (`src/components/NativeBridge.tsx`). The website is unchanged.

## Push notifications ("🎯 N new opportunities")
1. Apply `supabase/migrations/20261106_mobile_push.sql` (`npm run migrate -- --only 20261106_mobile_push.sql --go`).
2. **iOS:** Apple Developer → Keys → new key with APNs → Vercel env `APNS_KEY_ID`, `APNS_TEAM_ID`,
   `APNS_PRIVATE_KEY` (.p8 contents), `APNS_PRODUCTION=true` for TestFlight/App Store.
3. **Android:** Firebase project → add Android app `ai.getmindy.app` → put `google-services.json` in
   `mobile/android/app/` → service-account key into Vercel env `FCM_SERVICE_ACCOUNT_JSON`.
4. Turn on: `NEXT_PUBLIC_MOBILE_PUSH_PLATFORMS=ios` (add `,android` only after the Firebase file ships —
   registering without it crashes Android) and `MOBILE_PUSH_ENABLED=true`. Redeploy.
5. Schedule: `cron_jobs` row `send-mobile-push` → `/api/cron/send-mobile-push`, after the daily-alerts
   window (e.g. `30 17 * * *`). Dry run: `?preview=1&password=$ADMIN_PASSWORD`.

The push job is separate from `daily-alerts` on purpose — it can't slow or break email sends. One push
per user per day (`mobile_push_log` claim row). Dead device tokens are disabled automatically.

## Still open before store submission
1. **Apple guideline 3.1.1 (payments)** — Pro upgrade goes to Stripe. Hide upgrade buttons when the UA
   contains `MindyApp`, or use the US external-purchase link entitlement.
2. **Store listing** — screenshots, privacy policy URL, description, App Privacy answers.
