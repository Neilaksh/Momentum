import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neilaksh.momentum',
  appName: 'Momentum',
  webDir: 'public',
  server: {
    url: 'https://momentum-lifesync.lovable.app',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
