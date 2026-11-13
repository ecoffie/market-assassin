import type { CapacitorConfig } from '@capacitor/cli';

// The app is a native shell around the live Mindy web app, so every web
// deploy reaches phones with no store review. `www/` is only the offline screen.
const config: CapacitorConfig = {
  appId: 'ai.getmindy.app',
  appName: 'Mindy',
  webDir: 'www',
  server: {
    // The phone screen: sign-in, then a Mindy tab and a Map tab (src/app/app/phone).
    url: 'https://getmindy.ai/app/phone',
    // Hosts that stay inside the app. Anything else opens in the phone's browser.
    allowNavigation: ['getmindy.ai', '*.getmindy.ai', 'mi.govcongiants.com'],
    errorPath: 'index.html',
  },
  backgroundColor: '#1B3A6B',
  ios: { contentInset: 'automatic', limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#1B3A6B', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#1B3A6B', overlaysWebView: false },
  },
};

export default config;
