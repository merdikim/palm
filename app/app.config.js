/**
 * Dynamic Expo config — the app's display name, Android package, and deep-link
 * scheme all vary by environment so development / preview / production builds can
 * coexist on one device and never cross-wire deep links.
 *
 * Environment resolution: `APP_ENV` wins (handy for local `expo start`), else the
 * EAS build profile (`EAS_BUILD_PROFILE`, set automatically during EAS builds),
 * defaulting to `development`. Profiles match eas.json.
 */
const ENV = process.env.APP_ENV || process.env.EAS_BUILD_PROFILE || 'development';

const VARIANTS = {
  development: {
    name: 'Palm (Dev)',
    androidPackage: 'io.usepalm.app.dev',
    scheme: 'palmdev',
  },
  preview: {
    name: 'Palm (Preview)',
    androidPackage: 'io.usepalm.app.preview',
    scheme: 'palmpreview',
  },
  production: {
    name: 'Palm',
    androidPackage: 'io.usepalm.app',
    scheme: 'palm',
  },
};

const variant = VARIANTS[ENV] ?? VARIANTS.development;

module.exports = () => ({
  expo: {
    name: variant.name,
    // slug is the stable EAS project identity — must NOT change per environment.
    slug: 'palm-app',
    scheme: variant.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    backgroundColor: '#F6F8F6',
    icon: './assets/icon.png',
    assetBundlePatterns: ['**/*'],
    platforms: ['android'],
    android: {
      package: variant.androidPackage,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0D3B2E',
      },
    },
    plugins: [
      'expo-secure-store',
      'expo-notifications',
      'expo-asset',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#F6F8F6',
        },
      ],
    ],
    extra: {
      appEnv: ENV,
      eas: {
        projectId: 'c7c03273-1a5c-45d0-8a86-b71bb646cd6c',
      },
    },
  },
});
