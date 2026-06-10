const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The sync/merge core lives in ../shared so the server folds events through
// the exact same reducer. Metro only watches the project root by default.
config.watchFolders = [path.resolve(__dirname, '../shared')];

module.exports = config;
