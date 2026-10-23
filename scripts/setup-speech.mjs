import { setTimeout as delay } from 'node:timers/promises';
import { PHONON_LICENSE_REVISION, SpeechInstaller } from '../dist/desktop/speech-install.js';

const acceptFlag = '--accept-phonon-noncommercial';
const declineFlag = '--decline-phonon-narration';
const args = process.argv.slice(2);

if (args.includes(declineFlag)) {
  const installer = new SpeechInstaller();
  try {
    const state = await installer.decline();
    console.log(state.detail);
  } finally {
    installer.close();
  }
} else if (!args.includes(acceptFlag)) {
  console.log(
    'Optional narration installs the Phonon 40M model under CC BY-NC 4.0, which permits non-commercial use.',
  );
  console.log('The selected Easton and Zoey voice files are distributed under Apache 2.0.');
  console.log('Review licenses/phonon/CC-BY-NC-4.0.txt and licenses/phonon/NOTICE.md.');
  console.log(`To accept and install, run: npm run speech:setup -- ${acceptFlag}`);
  console.log(`License revision: ${PHONON_LICENSE_REVISION}`);
  process.exitCode = 2;
} else {
  const installer = new SpeechInstaller();
  const stop = () => void installer.cancel();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let state = await installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    });
    console.log(state.detail);
    while (state.phase === 'installing') {
      await delay(1_000);
      state = await installer.status();
      console.log(state.detail);
    }
    if (state.phase !== 'ready') {
      console.error(state.detail);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    installer.close();
  }
}
