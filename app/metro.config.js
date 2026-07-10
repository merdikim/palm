// Default Expo Metro config. Solana web3.js works with the Buffer +
// react-native-get-random-values polyfills imported first in index.ts.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
