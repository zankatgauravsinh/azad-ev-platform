import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.azadev.app',
  appName: 'Azad EV',
  webDir: 'dist',
  // Serve the bundled app over http://localhost so its API calls aren't blocked
  // as mixed content (localhost is still a secure context in Chromium). An
  // https API is still reachable — only https→http is blocked, not http→https.
  server: {
    androidScheme: 'http',
  },
  plugins: {
    SplashScreen: {
      // Hidden manually from JS once the app has mounted (avoids a white flash).
      launchAutoHide: false,
      backgroundColor: '#F8FAFC',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    Keyboard: {
      // Resize the web view when the keyboard opens so focused inputs stay visible.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
