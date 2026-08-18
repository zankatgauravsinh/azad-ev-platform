import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

/**
 * Initialises native-only integrations (status bar, splash, hardware back button).
 * A no-op on the web/desktop build — every call is guarded by `isNativePlatform`,
 * so desktop behaviour is completely unaffected.
 */
export function initNative(): void {
  if (!Capacitor.isNativePlatform()) return;

  // Status bar overlays the web view; content is padded via the safe-area insets.
  // Icons follow the theme so they stay readable (dark on light, light on dark).
  void StatusBar.setOverlaysWebView({ overlay: true });
  const applyStatusBarStyle = (): void => {
    // Capacitor's Style.Dark = light icons (for a dark bar); Style.Light = dark icons.
    const dark = document.documentElement.classList.contains('dark');
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  };
  applyStatusBarStyle();
  new MutationObserver(applyStatusBarStyle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Hide the native splash now that the app has painted.
  void SplashScreen.hide();

  // Hardware back button: dismiss an open dialog/drawer first, then walk history,
  // and only exit the app at the root.
  void App.addListener('backButton', ({ canGoBack }) => {
    const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]');
    const drawerOpen = document.querySelector('[data-mobile-drawer="open"]');
    if (dialogOpen || drawerOpen) {
      if (dialogOpen) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (drawerOpen) window.dispatchEvent(new CustomEvent('android-back'));
      return;
    }
    if (canGoBack && window.location.pathname !== '/') {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}
