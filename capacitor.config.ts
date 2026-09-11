import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neilaksh.momentum',
  appName: 'Momentum',
  // Static SPA shells + client assets produced by `npm run build:static`
  // (see vite.config.android.ts). The Android WebView loads index.html from
  // this bundled directory, so the app boots without a web server.
  webDir: 'dist/client'
};

export default config;
