module.exports = {
  appId: 'com.neryams.dungeonmaster',
  productName: 'Dungeon Master',
  electronVersion: '45.0.0',
  directories: {
    app: 'build/desktop-app',
    output: 'release',
  },
  files: ['**/*'],
  asar: false,
  mac: {
    category: 'public.app-category.games',
    icon: 'build/dungeon-master.icns',
    target: ['dmg', 'zip'],
    identity: null,
    hardenedRuntime: false,
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Dungeon Master uses the microphone only when you record speech to dictate a message to the DM.',
    },
  },
  win: {
    icon: 'build/dungeon-master.ico',
    target: ['nsis', 'zip'],
    signAndEditExecutable: false,
  },
  dmg: {
    title: 'Dungeon Master',
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  artifactName: '${productName}-${version}-${arch}.${ext}',
  extraResources: [
    {
      from: 'build/desktop-node',
      to: 'node',
      filter: ['bin/node', 'bin/node.exe', 'LICENSE'],
    },
  ],
};
