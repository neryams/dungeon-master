import test from 'node:test';
import assert from 'node:assert/strict';
import { DicePromptSound } from '../build/desktop/dice-prompt-sound.js';

function audio(t, initialState = 'running') {
  const starts = [];
  const stops = [];
  let resumes = 0;
  let context;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  });
  globalThis.AudioContext = class {
    state = initialState;
    currentTime = 10;
    destination = {};
    constructor() {
      context = this;
    }
    resume() {
      resumes++;
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
        start(at) {
          starts.push(at);
        },
        stop(at) {
          stops.push(at);
        },
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
  };
  return {
    starts,
    stops,
    get resumes() {
      return resumes;
    },
    get context() {
      return context;
    },
  };
}

test('dice prompt pings once per visible prompt across refreshes and recovery', (t) => {
  const a = audio(t);
  const sound = new DicePromptSound();
  sound.observe('campaign');
  assert.equal(a.starts.length, 0);
  sound.observe('campaign', 'first');
  sound.observe('campaign', 'first');
  sound.observe('campaign');
  sound.observe('campaign', 'first');
  assert.equal(a.starts.length, 1);
  sound.observe('campaign', 'second');
  sound.observe('other-campaign', 'first');
  assert.equal(a.starts.length, 3);
  assert.ok(a.stops.every((stop, i) => stop > a.starts[i] && stop - a.starts[i] < 0.3));
});

test('browser audio unlock does not replay old prompts', (t) => {
  const a = audio(t, 'suspended');
  const sound = new DicePromptSound();
  sound.observe('campaign', 'before-interaction');
  assert.equal(a.starts.length, 0);
  sound.unlock();
  sound.observe('campaign', 'before-interaction');
  assert.equal(a.resumes, 1);
  assert.equal(a.starts.length, 0);
  sound.observe('campaign', 'new');
  assert.equal(a.starts.length, 1);
});

test('unavailable audio never breaks prompt updates', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: class {
      constructor() {
        throw Error('Audio unavailable');
      }
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else delete globalThis.AudioContext;
  });
  const sound = new DicePromptSound();
  assert.doesNotThrow(() => {
    sound.unlock();
    sound.observe('campaign', 'first');
    sound.observe('campaign', 'second');
  });
});
