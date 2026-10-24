import type {
  CampaignSnapshot,
  DesktopSnapshot,
  DesktopEvent,
  SubmitInput,
  MapInput,
  PlayerView,
  LanStatus,
  LocalSettings,
  ModelCatalog,
  Provider,
  SpeechInstallState,
} from '#desktop/contracts';
import { elements, node, errorMessage } from './dom.js';
import { markdownMessage } from './markdown.js';
import { markerBadge } from './markers.js';
import {
  NarrationController,
  type NarrationMessage,
  type NarrationSnapshot,
  type NarrationVoice,
} from './narration.js';
import { NarrationAudio } from './narration-audio.js';
import { DiceFeedback } from './dice-feedback.js';
import { rollCard } from './roll-cards.js';
const tags = {
  'campaign-heading': 'div',
  revision: 'span',
  'lan-host': 'button',
  'lan-join': 'button',
  campaigns: 'button',
  connection: 'button',
  stop: 'button',
  'speech-settings': 'button',
  'speech-dialog': 'dialog',
  'speech-intro': 'p',
  'speech-license-info': 'p',
  'speech-download-info': 'p',
  'speech-license-link': 'button',
  'speech-model-link': 'button',
  'speech-access-link': 'button',
  'speech-token-link': 'button',
  'speech-consent': 'input',
  'speech-token': 'input',
  'speech-token-label': 'label',
  'speech-status': 'p',
  'speech-install': 'button',
  'speech-cancel': 'button',
  'speech-close': 'button',
  'model-dialog': 'dialog',
  'model-current': 'p',
  'switch-model': 'select',
  'model-dialog-status': 'p',
  'model-apply': 'button',
  'model-cancel': 'button',
  'change-model': 'button',
  'lan-dialog': 'dialog',
  'lan-help': 'p',
  'lan-qr': 'img',
  'lan-links': 'select',
  'lan-copy': 'button',
  'lan-play': 'button',
  'lan-rotate': 'button',
  'lan-players': 'div',
  'lan-required': 'div',
  'lan-resolve': 'button',
  'lan-continue': 'button',
  'lan-stop': 'button',
  'lan-close': 'button',
  'join-dialog': 'dialog',
  'join-link': 'input',
  'join-open': 'button',
  'join-close': 'button',
  welcome: 'main',
  'provider-status': 'span',
  provider: 'select',
  'provider-command': 'code',
  'provider-help': 'p',
  'hosted-model-settings': 'div',
  'provider-model': 'select',
  'refresh-models': 'button',
  'models-status': 'span',
  'local-settings': 'div',
  'local-endpoint': 'input',
  'local-model': 'input',
  'local-models': 'datalist',
  'local-context': 'input',
  'local-check': 'button',
  'local-save': 'button',
  'local-hardware': 'p',
  'local-suggestions': 'ul',
  'local-status': 'p',
  'check-provider': 'button',
  'choose-cli': 'button',
  'open-campaign': 'button',
  recent: 'button',
  'new-tab': 'h2',
  'create-form': 'form',
  name: 'input',
  slug: 'input',
  edition: 'select',
  'choose-parent': 'button',
  create: 'button',
  play: 'main',
  'party-count': 'span',
  party: 'div',
  'table-seat': 'button',
  pass: 'button',
  'sheet-tab': 'button',
  'quest-tab': 'button',
  sheet: 'div',
  quests: 'div',
  'map-select': 'select',
  'map-legend': 'section',
  'map-legend-types': 'div',
  'map-legend-items': 'ul',
  'scene-details': 'details',
  'scene-title': 'summary',
  'scene-summary': 'p',
  'map-surface': 'div',
  'map-empty': 'div',
  'map-image': 'img',
  'pan-left': 'button',
  'pan-up': 'button',
  'pan-down': 'button',
  'pan-right': 'button',
  'center-map': 'button',
  'map-size': 'select',
  'map-details': 'button',
  'map-status': 'span',
  'review-mode': 'span',
  encounter: 'div',
  transcript: 'div',
  'roll-prompt': 'section',
  'roll-prompt-title': 'h2',
  'roll-prompt-detail': 'p',
  'roll-prompt-help': 'p',
  'roll-inputs': 'div',
  'roll-error': 'p',
  'roll-submit': 'button',
  'narration-controls': 'div',
  'narration-voice': 'select',
  'narration-mute': 'button',
  'narration-skip': 'button',
  'narration-status': 'span',
  'conversation-label': 'span',
  'setup-guide': 'div',
  'setup-progress': 'p',
  'setup-activity': 'div',
  'setup-activity-detail': 'p',
  'session-status': 'div',
  'active-turn': 'div',
  'active-turn-phase': 'span',
  'active-turn-elapsed': 'time',
  'dice-feedback': 'section',
  'dice-label': 'div',
  'dice-notation': 'div',
  'dice-total': 'div',
  'dice-breakdown': 'div',
  'dice-announcement': 'div',
  'dice-dismiss': 'button',
  'status-dot': 'span',
  'status-text': 'span',
  recovery: 'div',
  reconnect: 'button',
  fresh: 'button',
  'action-form': 'form',
  'acting-as': 'label',
  action: 'textarea',
  send: 'button',
  notice: 'div',
  'notice-text': 'span',
  dismiss: 'button',
} as const;
const $ = elements(tags);
const api = window.table;
const diceFeedback = new DiceFeedback(
  {
    panel: $('dice-feedback'),
    label: $('dice-label'),
    notation: $('dice-notation'),
    total: $('dice-total'),
    breakdown: $('dice-breakdown'),
    announcement: $('dice-announcement'),
    dismiss: $('dice-dismiss'),
  },
  () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
);
let state: CampaignSnapshot,
  selected: string | undefined,
  chosenParent: string | undefined,
  recent: string | undefined,
  shownRevision = -1,
  transcriptKey = '',
  mapKey = '',
  legendKey = '',
  selectedMap = '',
  mapDetails = false,
  offset = { x: 0, y: 0 },
  polling = false,
  submitting = false,
  pendingSubmission: SubmitInput | undefined;
let modelRequest = 0;
let manualRollValues = new Map<string, string[]>();
let rollSubmission: { id: string; dice?: number[] } | undefined;
let rollSubmitting = false;
let renderedRollPromptId: string | undefined;
let modelSaving: Promise<void> = Promise.resolve();
let dialogModel: string | undefined;
let modelSwitching = false;
let dialogRequest = 0;
let viewGeneration = 0;
let updateSequence = 0;
let refreshQueued = false;
let updateRefreshTimer: number | undefined;
let mapRetryTimer: number | undefined;
function scheduleRefresh() {
  if (updateRefreshTimer !== undefined) return;
  updateRefreshTimer = window.setTimeout(() => {
    updateRefreshTimer = undefined;
    if (!$('play').hidden) void refresh();
  }, 30);
}
function receiveUpdate(update: DesktopEvent) {
  if (
    !state ||
    $('play').hidden ||
    update.root !== state.root ||
    update.campaignId !== state.campaign.id ||
    update.sequence <= updateSequence
  )
    return;
  updateSequence = update.sequence;
  state = {
    ...state,
    stage: update.stage,
    detail: update.detail,
    activitySequence: update.sequence,
    ...(update.kind === 'activity' && update.activity ? { activity: update.activity } : {}),
  };
  renderState();
  scheduleRefresh();
}
const unsubscribeUpdates = api.onUpdate(receiveUpdate);
const narrationStorageKey = 'dungeon-master.narration.v1';
function savedNarration(): { enabled: boolean; voice: NarrationVoice } {
  try {
    const saved = JSON.parse(localStorage.getItem(narrationStorageKey) ?? 'null');
    if (saved && typeof saved.enabled === 'boolean' && ['Easton', 'Zoey'].includes(saved.voice))
      return { enabled: saved.enabled, voice: saved.voice };
  } catch {
    /* Missing or inaccessible storage uses the documented defaults. */
  }
  return { enabled: true, voice: 'Easton' };
}
const narrationAudio = new NarrationAudio();
let narrationAvailable: boolean | undefined;
let speechInstallState: SpeechInstallState | undefined;
let firstSpeechPromptChecked = false;
let speechSetupPoll: number | undefined;
let speechInstallBusy = false;
let resolvingSince: number | undefined;
const narration = new NarrationController(
  {
    synthesize: (message, voice, part) => {
      if (speechInstallState?.phase !== 'ready')
        return Promise.reject(new Error('Narration setup is not complete.'));
      return api.speech({
        campaignId: message.campaignId,
        turnId: message.turnId,
        revision: message.revision,
        voice,
        part,
      });
    },
    cancelSynthesis: () => api.cancelSpeech(),
    play: (audio) => narrationAudio.play(audio),
    stopAudio: () => narrationAudio.stop(),
    onChange: () => renderNarration(),
  },
  savedNarration(),
);
function saveNarration() {
  const { enabled, voice } = narration.getState();
  try {
    localStorage.setItem(narrationStorageKey, JSON.stringify({ enabled, voice }));
  } catch {
    notice('Your narration preference could not be saved on this computer.');
  }
}
function narrationSnapshot(snapshot: CampaignSnapshot): NarrationSnapshot {
  const eligible = new Set(snapshot.speechEligibleRevisions ?? []);
  return {
    campaignKey: `${snapshot.root}:${snapshot.campaign.id}`,
    active: snapshot.reviewMode !== 'setup' && !$('play').hidden,
    messages: snapshot.table.flatMap((turn) =>
      turn.messages.map((message) => ({
        id: `${turn.id}:${message.revision}`,
        campaignId: snapshot.campaign.id,
        turnId: turn.id,
        revision: message.revision,
        eligible: speechInstallState?.phase === 'ready' && eligible.has(message.revision),
      })),
    ),
  };
}
function renderNarration() {
  const current = narration.getState();
  const active = !!state?.campaign && state.reviewMode !== 'setup' && !$('play').hidden;
  $('narration-controls').hidden = !active;
  $('narration-voice').value = current.voice;
  $('narration-mute').textContent = current.enabled ? 'Mute narration' : 'Enable narration';
  $('narration-mute').setAttribute('aria-pressed', String(!current.enabled));
  $('narration-skip').disabled = !['preparing', 'reading'].includes(current.activity);
  $('narration-status').textContent =
    current.activity === 'error'
      ? errorMessage(current.error).replace(/^Error invoking remote method '[^']+': Error: /, '')
      : current.activity === 'preparing'
        ? `Preparing ${current.voice}…`
        : current.activity === 'reading'
          ? `Reading · ${current.voice}${current.enabled ? '' : ' · Automatic narration muted'}`
          : !current.enabled
            ? 'Automatic narration muted'
            : narrationAvailable === false
              ? 'Narration is not installed on this computer.'
              : `New DM messages will be read by ${current.voice}.`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.message-read')) {
    const reading =
      button.dataset.messageId === current.currentId &&
      ['preparing', 'reading'].includes(current.activity);
    button.textContent = reading ? 'Stop reading' : 'Read aloud';
    button.setAttribute(
      'aria-label',
      reading ? 'Stop reading this message' : `Read this message aloud with ${current.voice}`,
    );
    button.setAttribute('aria-pressed', String(reading));
    button.disabled = speechInstallState?.phase !== 'ready';
  }
}
async function checkNarration() {
  try {
    speechInstallState = await api.speechSetupStatus();
    narrationAvailable = speechInstallState.phase === 'ready';
  } catch {
    narrationAvailable = false;
  }
  updateSpeechSetupDialog();
  renderNarration();
}
function updateSpeechSetupDialog() {
  const current = speechInstallState;
  if (!current) return;
  const bundled = current.bundled === true;
  $('speech-consent').disabled = current.phase === 'installing';
  $('speech-token').disabled = bundled || current.phase === 'installing';
  $('speech-license-info').hidden = current.phase === 'ready';
  $('speech-download-info').hidden = bundled || current.phase === 'ready';
  $('speech-token-label').hidden = bundled || current.phase === 'ready';
  $('speech-install').disabled =
    speechInstallBusy ||
    current.phase === 'installing' ||
    current.phase === 'ready' ||
    !$('speech-consent').checked;
  $('speech-install').textContent = bundled
    ? current.phase === 'error'
      ? 'Try narration again'
      : 'Agree & enable narration'
    : current.phase === 'error'
      ? 'Agree & retry installation'
      : 'Agree & install narration';
  $('speech-cancel').hidden = current.phase !== 'installing';
  $('speech-close').disabled = false;
  $('speech-close').textContent =
    current.phase === 'ready'
      ? 'Done'
      : current.phase === 'installing'
        ? 'Continue playing'
        : 'Skip for now';
  $('speech-consent').closest('label')!.hidden = current.phase === 'ready';
  $('speech-intro').textContent =
    current.phase === 'ready'
      ? bundled
        ? 'Narration is enabled. New DM messages can be read aloud with a local Phonon voice. Automatic narration can be muted in the conversation controls.'
        : 'Narration is installed and ready. New DM messages can be read aloud with a local Phonon voice. Automatic narration can be muted in the conversation controls.'
      : bundled
        ? 'Dungeon Master includes optional Phonon narration. Accept its noncommercial license to enable it. Speech runs locally on this computer. You can skip this and play normally, or change this later from Narration setup.'
        : 'Dungeon Master can read new DM messages aloud with a local Phonon voice. The speech model downloads to this computer and runs locally. Text is sent to the local speech engine only. You can skip this and play normally, or set it up later from Narration setup.';
  $('speech-status').textContent =
    bundled && current.phase === 'ready'
      ? 'Narration is ready.'
      : bundled && current.phase === 'error'
        ? safeSpeechDetail(current.detail)
        : bundled && current.phase === 'declined'
          ? 'Narration is off. You can still play normally and enable it later.'
          : current.phase === 'installing'
            ? safeSpeechDetail(current.detail) ||
              'Installing narration… This can take a few minutes. You can keep playing while it installs.'
            : current.phase === 'error'
              ? safeSpeechDetail(current.detail) ||
                'Narration could not be installed. Check model access and try again.'
              : current.phase === 'declined'
                ? 'Narration is off. You can still play normally and set it up later.'
                : current.phase === 'ready'
                  ? safeSpeechDetail(current.detail) || 'Narration is ready.'
                  : safeSpeechDetail(current.detail) ||
                    'Optional: install local narration when you are ready.';
  if (!firstSpeechPromptChecked) {
    firstSpeechPromptChecked = true;
    if (current.phase === 'unconfigured') {
      if (current.accepted) $('speech-consent').checked = true;
      $('speech-dialog').showModal();
      $('speech-install').disabled = !current.accepted;
    }
  }
  if (current.phase === 'installing') monitorSpeechSetup();
  renderNarration();
}
function safeSpeechDetail(detail: string) {
  return detail.replace(/hf_[A-Za-z0-9_-]{10,}/g, '[hidden token]');
}
function monitorSpeechSetup() {
  if (speechSetupPoll !== undefined) return;
  speechSetupPoll = window.setInterval(() => {
    void api
      .speechSetupStatus()
      .then((next) => {
        speechInstallState = next;
        narrationAvailable = next.phase === 'ready';
        updateSpeechSetupDialog();
        if (next.phase !== 'installing') {
          window.clearInterval(speechSetupPoll);
          speechSetupPoll = undefined;
        }
      })
      .catch((error) => {
        $('speech-status').textContent = safeSpeechDetail(errorMessage(error));
        if (speechSetupPoll !== undefined) window.clearInterval(speechSetupPoll);
        speechSetupPoll = undefined;
      });
  }, 1000);
}
function showSpeechSetup() {
  if (!speechInstallState) void checkNarration().then(() => $('speech-dialog').showModal());
  else {
    if (speechInstallState.phase === 'installing') monitorSpeechSetup();
    $('speech-dialog').showModal();
  }
}
async function skipSpeechSetup() {
  if (speechInstallState?.phase === 'unconfigured' && !speechInstallState.accepted)
    speechInstallState = await api.declineSpeech();
  $('speech-token').value = '';
  if (speechInstallState?.phase === 'declined') $('speech-consent').checked = false;
  if (state?.campaign) narration.reset(narrationSnapshot(state));
  updateSpeechSetupDialog();
  $('speech-dialog').close();
}
async function installSpeech() {
  if (!speechInstallState || !$('speech-consent').checked || speechInstallBusy) return;
  const token = speechInstallState.bundled
    ? undefined
    : $('speech-token').value.trim() || undefined;
  $('speech-token').value = '';
  speechInstallBusy = true;
  updateSpeechSetupDialog();
  try {
    speechInstallState = await api.installSpeech({
      accepted: true,
      licenseRevision: speechInstallState.licenseRevision,
      ...(token ? { token } : {}),
    });
    narrationAvailable = speechInstallState.phase === 'ready';
    updateSpeechSetupDialog();
    if (speechInstallState.phase === 'installing') monitorSpeechSetup();
  } catch (error) {
    $('speech-status').textContent = safeSpeechDetail(errorMessage(error));
  } finally {
    speechInstallBusy = false;
    updateSpeechSetupDialog();
  }
}
async function cancelSpeechSetup() {
  speechInstallState = await api.cancelSpeechInstall();
  if (speechSetupPoll !== undefined) window.clearInterval(speechSetupPoll);
  speechSetupPoll = undefined;
  $('speech-token').value = '';
  $('speech-consent').checked = false;
  narrationAvailable = speechInstallState.phase === 'ready';
  updateSpeechSetupDialog();
}
async function openSpeechInfo(link: 'license' | 'model' | 'token') {
  await api.openSpeechLink(link);
}
function notice(error: unknown) {
  $('notice-text').textContent = errorMessage(error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
  $('notice').hidden = false;
}
function on(id: keyof typeof tags, fn: () => unknown) {
  $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(notice));
}
function row(label: string, value: string | number) {
  const e = node('div', undefined, 'sheet-row');
  e.append(node('span', label), node('small', value));
  return e;
}
function section(title: string, container: HTMLElement, content: (element: HTMLElement) => void) {
  const e = node('section', undefined, `sheet-section${title === 'Abilities' ? ' abilities' : ''}`);
  e.append(node('h3', title));
  content(e);
  container.append(e);
}
function members() {
  return state?.party?.members ?? [];
}
function seat(id: string | undefined) {
  selected = state.reviewMode === 'setup' ? undefined : id;
  renderParty();
  renderSheet();
  $('acting-as').textContent = selected
    ? `Playing as ${members().find((p) => p.id === selected)?.name ?? 'character'}`
    : state.reviewMode === 'setup'
      ? 'Your campaign preferences'
      : 'Table';
}
function renderParty() {
  const party = $('party');
  party.replaceChildren();
  $('party-count').textContent = String(members().length);
  if (!members().length) party.append(node('p', 'Ask the DM to add characters.', 'help'));
  for (const p of members()) {
    const card = node('button', undefined, `party-card${p.id === selected ? ' selected' : ''}`);
    card.setAttribute('aria-pressed', String(p.id === selected));
    const avatar = markerBadge(p.marker, 'party-avatar');
    card.append(avatar);
    card.append(node('strong', p.name));
    const stats = node('div', undefined, 'party-stats');
    stats.append(
      node('span', `${p.hp} / ${p.maxHp} HP${p.tempHp ? ` +${p.tempHp}` : ''}`),
      node('span', `AC ${p.ac ?? '—'}`),
    );
    const track = node('div', undefined, 'hp-track');
    const fill = node('div', undefined, 'hp-fill');
    fill.style.width = `${Math.min(100, (100 * p.hp) / p.maxHp)}%`;
    track.append(fill);
    card.append(stats, track);
    card.addEventListener('click', () => seat(p.id));
    party.append(card);
  }
  $('pass').disabled = !members().length;
  $('table-seat').setAttribute('aria-pressed', String(!selected));
  $('table-seat').title = 'Speak for the whole table';
}
function renderSheet() {
  const container = $('sheet');
  container.replaceChildren();
  const sheet = state?.sheets?.find((s) => s.character.id === selected);
  if (!sheet) {
    container.append(node('p', 'Select a character to view their sheet.', 'help'));
    return;
  }
  const c = sheet.character.character;
  section('Conditions', container, (e) =>
    e.append(
      node(
        'p',
        c.conditions.length
          ? c.conditions.map((x) => x.name + (x.duration ? ` · ${x.duration}` : '')).join(', ')
          : 'None',
      ),
    ),
  );
  section('Abilities', container, (e) => {
    for (const [key, value] of Object.entries(c.abilities)) e.append(row(key.toUpperCase(), value));
    if (!Object.keys(c.abilities).length) e.append(node('p', 'Not recorded'));
  });
  section('Resources', container, (e) => {
    for (const [key, value] of Object.entries(c.resources))
      e.append(row(key, `${value.current} / ${value.max}`));
    if (!Object.keys(c.resources).length) e.append(node('p', 'None recorded'));
  });
  section('Inventory', container, (e) => {
    for (const item of sheet.inventory)
      e.append(row(item.name, `×${item.item.quantity}${item.item.equipped ? ' · equipped' : ''}`));
    if (!sheet.inventory.length) e.append(node('p', 'Empty'));
  });
  section('Position', container, (e) => {
    for (const place of sheet.placements)
      e.append(
        node(
          'p',
          `${place.mapName}: ${place.nodeLabel ?? `${place.position.x}, ${place.position.y}`}`,
        ),
      );
    if (!sheet.placements.length) e.append(node('p', 'Not placed'));
  });
}
function renderQuests() {
  const container = $('quests');
  container.replaceChildren();
  const objective = state.focus?.primaryObjective;
  if (objective) section('Objective', container, (e) => e.append(node('p', objective)));
  for (const q of state.quests ?? [])
    section(q.name, container, (e) => {
      e.append(node('p', q.quest.objective));
      for (const lead of q.quest.leads) e.append(node('p', `• ${lead}`));
    });
  if (!container.children.length)
    container.append(node('p', 'Objectives and active quests will appear here.', 'help'));
}
function renderTranscript() {
  const key = JSON.stringify([state.reviewMode, state.table, state.rollHistory]);
  if (key === transcriptKey) return;
  transcriptKey = key;
  const log = $('transcript');
  if (!state.table?.length && !state.rollHistory?.length) {
    log.replaceChildren(
      node(
        'p',
        state.reviewMode === 'setup'
          ? 'The DM will guide you through the adventure, party, and opening scene. Connect to begin.'
          : 'Describe your party or send an action.',
        'conversation-empty',
      ),
    );
    return;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  log.replaceChildren();
  function message(speaker: string, text: string, revision: number, player = false) {
    const article = node('article', undefined, `message${player ? ' player' : ''}`);
    const label = node('div', undefined, 'message-label');
    label.append(node('span', speaker.toUpperCase()), node('small', `r${revision}`));
    const body = markdownMessage(text);
    body.classList.add('message-text');
    article.append(label, body);
    log.append(article);
    return article;
  }
  const items: { revision: number; order: number; render: () => void }[] = [];
  for (const turn of state.table) {
    items.push({
      revision: turn.revision,
      order: 0,
      render: () => message(turn.speaker, turn.text, turn.revision, true),
    });
    for (const m of turn.messages)
      items.push({
        revision: m.revision,
        order: 1,
        render: () => {
          const article = message(
            m.delivery === 'progress' ? 'Dungeon Master · in progress' : 'Dungeon Master',
            m.text,
            m.revision,
          );
          if (state.reviewMode !== 'setup') {
            const ref: NarrationMessage = {
              id: `${turn.id}:${m.revision}`,
              campaignId: state.campaign.id,
              turnId: turn.id,
              revision: m.revision,
              eligible: true,
            };
            const button = node('button', 'Read aloud', 'quiet message-read');
            button.type = 'button';
            button.dataset.messageId = ref.id;
            button.addEventListener('click', () => {
              const current = narration.getState();
              if (
                current.currentId === ref.id &&
                ['preparing', 'reading'].includes(current.activity)
              )
                narration.skip();
              else narration.replay(ref);
            });
            article.append(button);
          }
        },
      });
    if (turn.status === 'interrupted')
      items.push({
        revision: turn.revision,
        order: 2,
        render: () =>
          log.append(
            node('p', 'Turn interrupted · Check saved outcomes before continuing.', 'interrupted'),
          ),
      });
  }
  for (const roll of state.rollHistory ?? [])
    items.push({ revision: roll.revision, order: 3, render: () => log.append(rollCard(roll)) });
  items.sort((a, b) => a.revision - b.revision || a.order - b.order);
  for (const item of items) item.render();
  if (nearBottom) log.scrollTop = log.scrollHeight;
}
function mapDimensions(map?: PlayerView['maps'][number]) {
  const size = $('map-size').value;
  return size === 'auto'
    ? {
        width: Math.min(40, map?.bounds?.width ?? 20),
        height: Math.min(40, map?.bounds?.height ?? 20),
      }
    : { width: Number(size), height: Number(size) };
}
function renderMapLegend(map?: PlayerView['maps'][number]) {
  const key = JSON.stringify([map?.id, map?.legend, members().map((member) => member.id)]);
  if (key === legendKey) return;
  legendKey = key;
  $('map-legend').hidden = !map;
  const items = $('map-legend-items');
  items.replaceChildren();
  if (!map) return;
  const types = $('map-legend-types');
  types.replaceChildren();
  const npc = markerBadge({
    kind: 'npc',
    label: '',
    color: '#64748b',
    shape: 'circle',
    dotted: true,
  });
  const object = markerBadge({
    kind: 'object',
    label: '',
    color: '#64748b',
    shape: 'triangle',
    dotted: false,
  });
  for (const [icon, label] of [
    [npc, 'NPC'],
    [object, 'Objects / landmarks'],
  ] as const) {
    const key = node('span');
    key.append(icon);
    if (icon === object) {
      key.append(
        markerBadge({
          kind: 'object',
          label: '',
          color: '#64748b',
          shape: 'diamond',
          dotted: false,
        }),
      );
    }
    key.append(node('span', label));
    types.append(key);
  }
  if (map.legend.some((entry) => entry.appearance.shape === 'square')) {
    const key = node('span');
    key.append(
      markerBadge({ kind: 'terrain', shape: 'square', dotted: false }),
      node('span', 'Terrain / obstacle'),
    );
    types.append(key);
  }
  const partyIds = new Set(members().map((member) => member.id));
  for (const entry of map.legend) {
    if (entry.kind === 'entity' && partyIds.has(entry.id)) continue;
    const item = node('li');
    item.dataset.markerId = entry.id;
    item.setAttribute(
      'aria-label',
      `${entry.appearance.kind}, ${entry.label}, ${entry.position}${'label' in entry.appearance && entry.appearance.label ? `, marker ${entry.appearance.label}` : ''}`,
    );
    const icon = markerBadge(entry.appearance);
    const label = node('span', undefined, 'legend-label');
    label.append(node('span', entry.label), node('small', entry.position));
    item.append(icon, label);
    items.append(item);
  }
  if (!items.children.length) items.append(node('li', 'No other revealed markers.', 'help'));
}
async function renderMap() {
  const generation = viewGeneration;
  const m = state?.maps?.find((m) => m.id === selectedMap);
  renderMapLegend(m);
  $('map-empty').hidden = !!m;
  $('map-image').hidden = !m;
  for (const id of [
    'pan-left',
    'pan-up',
    'pan-down',
    'pan-right',
    'center-map',
    'map-size',
  ] as const)
    $(id).disabled = !m || m.kind !== 'grid';
  if (!m) {
    $('map-image').removeAttribute('src');
    $('map-status').textContent = '';
    $('map-details').disabled = true;
    return;
  }
  $('center-map').disabled =
    m.kind !== 'grid' ||
    !state.sheets
      .find((s) => s.character.id === selected)
      ?.placements.some((p) => p.mapId === m.id && p.position.x !== undefined);
  $('map-size').options[0].textContent =
    m.bounds && m.bounds.width <= 40 && m.bounds.height <= 40 ? 'Fit map' : 'Auto';
  $('map-details').disabled = !m;
  const input: MapInput = { mapId: m.id, revision: state.revision, details: mapDetails };
  if (m.kind === 'grid')
    input.viewport = {
      ...offset,
      ...mapDimensions(m),
    };
  const key = JSON.stringify(input);
  if (key === mapKey) return;
  mapKey = key;
  $('map-status').textContent = 'Updating map…';
  $('map-image').hidden = true;
  try {
    const result = await api.map(input);
    if (generation !== viewGeneration || key !== mapKey || state.revision !== input.revision)
      return;
    if (result.stale || result.busy) {
      mapKey = '';
      // A temporarily busy map should not wait for the 15-second recovery snapshot.
      if (mapRetryTimer !== undefined) window.clearTimeout(mapRetryTimer);
      mapRetryTimer = window.setTimeout(() => {
        mapRetryTimer = undefined;
        if (generation !== viewGeneration || $('play').hidden) return;
        if (result.stale) scheduleRefresh();
        else void renderMap();
      }, 250);
      return;
    }
    $('map-image').src = result.image;
    $('map-image').hidden = false;
    $('map-status').textContent =
      `r${result.revision}${m.kind === 'grid' ? ` · ${offset.x}, ${offset.y}` : ''}${result.warnings?.length ? ` · ${result.warnings.join(' ')}` : ''}`;
  } catch (e) {
    if (generation !== viewGeneration) return;
    mapKey = '';
    $('map-status').textContent = 'Map unavailable; retrying';
  }
}
function renderElapsed() {
  if (resolvingSince === undefined) return;
  const elapsed = Math.floor((Date.now() - resolvingSince) / 1000);
  $('active-turn-elapsed').textContent =
    `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
}
function renderState() {
  if (!state.campaign) return;
  const resolving = state.stage === 'resolving';
  if (resolving && resolvingSince === undefined) resolvingSince = Date.now();
  if (!resolving) resolvingSince = undefined;
  $('active-turn').hidden = !resolving;
  $('session-status').hidden = resolving && !state.lanHosted;
  if (resolving) {
    $('active-turn-phase').textContent = state.pendingRolls?.length
      ? 'Waiting for player dice'
      : state.activity?.phase || 'The DM is thinking';
    renderElapsed();
  }
  diceFeedback.observe(state.activity?.rolls ?? [], resolving);
  const settingUp = state.reviewMode === 'setup';
  const generating = settingUp && state.stage === 'resolving';
  $('setup-activity').hidden = !generating;
  if (generating) {
    const partySaved = members().length > 0;
    const mapSaved = state.maps.length > 0;
    const openingSaved = !!(state.scene && state.focus?.primaryObjective);
    $('setup-activity-detail').textContent =
      partySaved && mapSaved && openingSaved
        ? 'Your party, map, and opening are saved. The DM is checking the details and preparing your briefing.'
        : partySaved && mapSaved
          ? 'Your party and map are saved. The DM is preparing the opening scene and your first decision.'
          : partySaved
            ? 'Your party is saved. The DM is working on the starting map and opening adventure.'
            : mapSaved
              ? 'The starting map is saved. The DM is working on your characters and their place in the adventure.'
              : 'Turning your ideas into characters, places, and the opening adventure.';
  }
  $('play').classList.toggle('setup-flow', settingUp);
  renderRollPrompt();
  $('setup-guide').hidden = !settingUp;
  $('conversation-label').textContent = settingUp ? 'Campaign creation' : 'Chat';
  $('action').placeholder = settingUp
    ? 'Describe your idea, answer the DM, or ask for suggestions…'
    : 'Describe an action…';
  if (settingUp) {
    $('setup-progress').textContent = [
      members().length ? `Party saved · ${members().length} characters` : 'Party to create',
      state.maps.length ? 'Map saved' : 'Map to create',
      state.scene && state.focus?.primaryObjective ? 'Opening saved' : 'Opening to create',
    ].join('  /  ');
  }
  $('campaign-heading').textContent = state.campaign.name;
  $('revision').textContent = `Saved · r${state.revision}`;
  $('connection').hidden = false;
  $('campaigns').hidden = false;
  $('lan-host').hidden = false;
  $('lan-host').disabled = settingUp;
  $('lan-host').title = settingUp ? 'Finish campaign setup before inviting players.' : '';
  const busy = state.stage === 'connecting' || state.stage === 'resolving';
  $('stop').hidden = state.stage !== 'resolving' && state.stage !== 'ready';
  $('campaigns').disabled = busy;
  $('connection').disabled = busy;
  $('connection').title = state.model
    ? `Current model: ${state.model}`
    : 'Current model: CLI default';
  $('connection').textContent =
    state.stage === 'ready'
      ? 'DM model…'
      : state.stage === 'connecting'
        ? 'Connecting…'
        : 'Connect DM';
  $('send').disabled = state.stage !== 'ready' || submitting || state.lanHosted;
  $('lan-host').textContent = state.lanHosted ? 'LAN game' : 'Host LAN game';
  $('status-text').textContent = state.lanHosted
    ? 'Use LAN game → Open player seat to play.'
    : state.stage === 'ready'
      ? settingUp
        ? 'DM connected · Build your campaign together.'
        : 'DM connected'
      : state.stage === 'disconnected'
        ? 'Connect DM to send an action.'
        : state.detail;
  $('status-text').title = state.detail;
  $('status-dot').className =
    `small-dot${busy ? ' busy' : state.stage === 'attention' ? ' warning' : ''}`;
  $('recovery').hidden = state.stage !== 'attention';
  $('review-mode').textContent =
    state.reviewMode === 'reviewed'
      ? 'Reviewed play'
      : state.reviewMode === 'setup'
        ? 'Campaign setup'
        : 'Legacy play';
  if (shownRevision !== state.revision) {
    shownRevision = state.revision;
    if (selected && !members().some((m) => m.id === selected)) selected = undefined;
    seat(selected);
    renderQuests();
    $('scene-title').textContent = state.scene?.title ?? 'Scene';
    $('scene-summary').textContent = state.scene?.summary ?? '';
    $('scene-details').hidden = !state.scene?.summary;
    if (!state.maps.some((m) => m.id === selectedMap)) {
      selectedMap =
        state.scene?.map && state.maps.some((m) => m.id === state.scene?.map)
          ? state.scene.map
          : (state.maps[0]?.id ?? '');
      offset = { x: 0, y: 0 };
    }
    $('map-select').replaceChildren(
      ...state.maps.map((m) => {
        const option = node('option', m.name);
        option.value = m.id;
        return option;
      }),
    );
    $('map-select').value = selectedMap;
    $('map-select').hidden = !state.maps.length;
    const encounter = $('encounter');
    encounter.replaceChildren();
    if (state.encounter) {
      encounter.append(node('span', `Round ${state.encounter.round}`, 'turn-chip'));
      for (const p of state.encounter.participants)
        encounter.append(
          node(
            'span',
            `${p.name} · ${p.initiative}`,
            `turn-chip${p.id === state.encounter.activeId ? ' active' : ''}`,
          ),
        );
    }
  }
  renderTranscript();
  narration.observe(narrationSnapshot(state));
  renderNarration();
  void renderMap();
}
function renderRollPrompt() {
  const prompts = state.pendingRolls ?? [];
  const prompt = state.lanHosted ? undefined : prompts[0];
  const panel = $('roll-prompt');
  panel.hidden = !prompt;
  if (!prompt) {
    rollSubmission = undefined;
    renderedRollPromptId = undefined;
    return;
  }
  if (renderedRollPromptId !== prompt.id) {
    $('roll-error').hidden = true;
    renderedRollPromptId = prompt.id;
  }
  if (rollSubmission && rollSubmission.id !== prompt.id) rollSubmission = undefined;
  $('roll-prompt-title').textContent = `${prompt.characterName} · ${prompt.label}`;
  $('roll-prompt-detail').textContent = `${prompt.notation} · ${prompt.mode}`;
  const count = prompt.mode === 'normal' ? prompt.dieCount : Math.max(2, prompt.dieCount);
  $('roll-prompt-help').textContent =
    prompt.mode === 'advantage'
      ? `Enter ${count} raw d${prompt.dieSides} face${count === 1 ? '' : 's'}. The highest face is used before the modifier.`
      : prompt.mode === 'disadvantage'
        ? `Enter ${count} raw d${prompt.dieSides} faces. The lowest face is used before the modifier.`
        : `Enter ${prompt.dieCount} raw d${prompt.dieSides} face${prompt.dieCount === 1 ? '' : 's'} before the modifier, or roll digitally.`;
  if (state.stage === 'attention' || state.stage === 'disconnected')
    $('roll-prompt-help').textContent +=
      ' This saved roll can be submitted during recovery; it will not restart the DM.';
  const inputs = $('roll-inputs');
  const prior = manualRollValues.get(prompt.id) ?? [];
  if (inputs.childElementCount !== count || inputs.dataset.promptId !== prompt.id) {
    inputs.replaceChildren();
    inputs.dataset.promptId = prompt.id;
    for (let i = 0; i < count; i++) {
      const label = document.createElement('label');
      label.textContent = `Die ${i + 1} face (1–${prompt.dieSides})`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(prompt.dieSides);
      input.step = '1';
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', `Die ${i + 1} face, from 1 to ${prompt.dieSides}`);
      input.value = prior[i] ?? '';
      input.addEventListener('input', () => {
        const values = [...inputs.querySelectorAll('input')].map(
          (el) => (el as HTMLInputElement).value,
        );
        manualRollValues.set(prompt.id, values);
        $('roll-error').hidden = true;
        $('roll-submit').textContent = values.some(Boolean) ? 'Submit physical dice' : 'Roll dice';
      });
      label.append(input);
      inputs.append(label);
    }
  }
  for (const [i, input] of [...inputs.querySelectorAll('input')].entries()) {
    (input as HTMLInputElement).value = prior[i] ?? '';
    (input as HTMLInputElement).disabled = !!rollSubmission || rollSubmitting;
  }
  $('roll-submit').textContent = rollSubmitting
    ? 'Submitting…'
    : rollSubmission
      ? 'Retry same roll'
      : prior.some(Boolean)
        ? 'Submit physical dice'
        : 'Roll dice';
  $('roll-submit').disabled = rollSubmitting;
}
async function submitRequestedRoll() {
  const prompt = state.pendingRolls?.[0];
  if (!prompt || state.lanHosted || rollSubmitting) return;
  const values = [...$('roll-inputs').querySelectorAll('input')].map((el) =>
    (el as HTMLInputElement).value.trim(),
  );
  const supplied = values.some(Boolean);
  let dice: number[] | undefined;
  if (supplied) {
    if (values.some((v) => !v)) {
      $('roll-error').textContent = 'Enter every die face, or clear all fields to roll digitally.';
      $('roll-error').hidden = false;
      return;
    }
    dice = values.map(Number);
    if (dice.some((n) => !Number.isInteger(n) || n < 1 || n > prompt.dieSides)) {
      $('roll-error').textContent = `Each face must be from 1 to ${prompt.dieSides}.`;
      $('roll-error').hidden = false;
      return;
    }
  }
  rollSubmission ??= { id: prompt.id, ...(dice ? { dice } : {}) };
  rollSubmitting = true;
  renderRollPrompt();
  try {
    await api.submitRoll(rollSubmission);
    manualRollValues.delete(prompt.id);
    rollSubmission = undefined;
    $('roll-error').hidden = true;
    await refresh();
  } catch (e) {
    $('roll-error').textContent = errorMessage(
      e instanceof TypeError
        ? new Error('Connection lost. Retry this exact roll to recover its saved result.')
        : e,
    );
    $('roll-error').hidden = false;
  } finally {
    rollSubmitting = false;
    renderRollPrompt();
  }
}
async function refresh() {
  if (polling) {
    refreshQueued = true;
    return;
  }
  polling = true;
  const view = viewGeneration;
  try {
    const snapshot = await api.snapshot();
    if (view !== viewGeneration || $('play').hidden) return;
    if (snapshot.campaign) {
      if (snapshot.root !== state.root || snapshot.revision < state.revision) return;
      // A snapshot started before a push must not erase newer roll or lifecycle feedback.
      const sequence = snapshot.activitySequence ?? 0;
      state =
        sequence < updateSequence
          ? {
              ...snapshot,
              stage: state.stage,
              detail: state.detail,
              activity: state.activity,
              activitySequence: updateSequence,
            }
          : snapshot;
      updateSequence = Math.max(updateSequence, sequence);
      renderState();
    }
  } catch (e) {
    notice(e);
  } finally {
    polling = false;
    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh();
    }
  }
}
async function connect(fresh = false) {
  await modelSaving;
  if ($('provider').value === 'ollama') await api.configureLocal(localSettings());
  const promise = api.connect(fresh);
  void refresh();
  try {
    await promise;
    await api.beginSetup();
  } finally {
    await refresh();
  }
}
export function showCampaign(snapshot: DesktopSnapshot) {
  if (!snapshot.campaign) throw new Error('No campaign is open');
  ++viewGeneration;
  updateSequence = snapshot.activitySequence ?? 0;
  refreshQueued = false;
  resolvingSince = snapshot.stage === 'resolving' ? Date.now() : undefined;
  diceFeedback.reset(snapshot.activity?.rolls ?? []);
  state = snapshot;
  selected = undefined;
  shownRevision = -1;
  transcriptKey = '';
  mapKey = '';
  selectedMap = '';
  mapDetails = false;
  $('map-details').setAttribute('aria-pressed', 'false');
  $('map-size').value = 'auto';
  pendingSubmission = undefined;
  $('welcome').hidden = true;
  $('play').hidden = false;
  narration.reset(narrationSnapshot(snapshot));
  void checkNarration();
  $('action').value = '';
  $('acting-as').textContent = 'Table';
  $('notice').hidden = true;
  $('transcript').replaceChildren(
    node('p', 'Describe your party or send an action.', 'conversation-empty'),
  );
  renderState();
}
async function enter(snapshot: DesktopSnapshot) {
  showCampaign(snapshot);
  await connect();
}
async function checkProvider(path?: string) {
  $('provider-status').textContent = 'Checking installation…';
  try {
    const found = await api.detect(path);
    $('provider-status').textContent = `Detected · ${found.version}`;
    await loadModels();
  } catch (e) {
    $('provider-status').textContent = 'Not ready · Install or choose the selected CLI below';
    throw e;
  }
}
on('dismiss', () => {
  $('notice').hidden = true;
});
on('speech-settings', showSpeechSetup);
on('speech-close', skipSpeechSetup);
on('speech-install', installSpeech);
on('speech-cancel', cancelSpeechSetup);
on('speech-license-link', () => openSpeechInfo('license'));
on('speech-model-link', () => openSpeechInfo('model'));
on('speech-access-link', () => openSpeechInfo('model'));
on('speech-token-link', () => openSpeechInfo('token'));
$('speech-consent').addEventListener('change', updateSpeechSetupDialog);
$('speech-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  void skipSpeechSetup().catch(notice);
});
$('provider').onchange = () => {
  void (async () => {
    $('provider').disabled = true;
    const provider =
      $('provider').value === 'ollama'
        ? 'ollama'
        : $('provider').value === 'codex'
          ? 'codex'
          : 'antigravity';
    try {
      await modelSaving;
      await api.selectProvider(provider);
      showProvider();
      await checkProvider();
    } finally {
      $('provider').disabled = false;
    }
  })().catch(notice);
};
function localSettings(): LocalSettings {
  return {
    endpoint: $('local-endpoint').value.trim(),
    model: $('local-model').value.trim(),
    contextTokens: Number($('local-context').value),
  };
}
function showProvider() {
  const local = $('provider').value === 'ollama';
  $('local-settings').hidden = !local;
  $('provider-help').hidden = local;
  $('hosted-model-settings').hidden = local;
  $('provider-command').textContent = $('provider').value === 'codex' ? 'codex login' : 'agy';
}
function fillModels(
  select: HTMLSelectElement,
  catalog: ModelCatalog,
  selected?: string,
  local = false,
) {
  select.replaceChildren();
  if (!local) {
    const option = node('option', 'CLI default');
    option.value = '';
    select.append(option);
  }
  for (const model of catalog.models) {
    const option = node('option', model.name);
    option.value = model.id;
    select.append(option);
  }
  if (selected && !catalog.models.some((model) => model.id === selected)) {
    const option = node('option', `${selected} (saved selection)`);
    option.value = selected;
    option.disabled = true;
    select.append(option);
  }
  select.value = selected ?? '';
}
async function loadModels() {
  const request = ++modelRequest;
  const provider = $('provider').value as Provider;
  if (provider === 'ollama') return;
  $('provider-model').disabled = true;
  $('models-status').textContent = 'Loading available models…';
  const prefs = await api.preferences();
  const selected = prefs.models?.[provider];
  fillModels($('provider-model'), { models: [] }, selected);
  try {
    const catalog = await api.models();
    if (request !== modelRequest || $('provider').value !== provider) return;
    fillModels($('provider-model'), catalog, selected);
    $('models-status').textContent =
      selected && !catalog.models.some((model) => model.id === selected)
        ? 'Saved model is unavailable. Choose another model or CLI default.'
        : `${catalog.models.length} models available`;
  } catch {
    if (request !== modelRequest || $('provider').value !== provider) return;
    $('models-status').textContent = 'Could not load models. Check CLI sign-in, then Refresh.';
  } finally {
    if (request === modelRequest) $('provider-model').disabled = false;
  }
}
on('refresh-models', loadModels);
$('provider-model').onchange = () => {
  $('provider-model').disabled = true;
  $('models-status').textContent = 'Saving model choice…';
  modelSaving = (async () => {
    await api.selectModel($('provider-model').value || undefined);
    $('models-status').textContent = 'Model selected for this provider.';
  })()
    .catch(async (error) => {
      notice(error);
      await loadModels();
    })
    .finally(() => {
      $('provider-model').disabled = false;
    });
};
async function showModelDialog() {
  if (modelSwitching || state.stage === 'connecting' || state.stage === 'resolving') return;
  const request = ++dialogRequest;
  $('model-dialog').showModal();
  $('model-dialog-status').textContent = 'Loading available models…';
  $('model-apply').disabled = true;
  $('switch-model').disabled = true;
  $('switch-model').replaceChildren();
  const prefs = await api.preferences();
  const provider = prefs.provider ?? 'antigravity';
  const savedModel = provider === 'ollama' ? prefs.local?.model : prefs.models?.[provider];
  dialogModel = state.provider === provider ? (state.model ?? savedModel) : savedModel;
  $('model-current').textContent = `Current: ${dialogModel ?? 'CLI default'}`;
  try {
    const catalog = await api.models();
    if (request !== dialogRequest || !$('model-dialog').open) return;
    fillModels($('switch-model'), catalog, dialogModel, provider === 'ollama');
    $('switch-model').disabled = false;
    $('model-dialog-status').textContent = 'Choose a model to start fresh DM context.';
  } catch (error) {
    if (request === dialogRequest) $('model-dialog-status').textContent = errorMessage(error);
  }
}
$('switch-model').onchange = () => {
  $('model-apply').disabled =
    modelSwitching || ($('switch-model').value || undefined) === dialogModel;
};
on('model-cancel', () => {
  if (modelSwitching) return;
  ++dialogRequest;
  $('model-dialog').close();
});
$('model-dialog').addEventListener('cancel', (event) => {
  if (modelSwitching) event.preventDefault();
  else ++dialogRequest;
});
on('model-apply', async () => {
  if (modelSwitching) return;
  modelSwitching = true;
  $('model-apply').disabled = true;
  $('model-cancel').disabled = true;
  $('switch-model').disabled = true;
  $('model-dialog-status').textContent = 'Starting fresh DM context with the selected model…';
  try {
    const pending = api.switchModel($('switch-model').value || undefined);
    void refresh();
    await pending;
    await api.beginSetup();
    $('model-dialog').close();
  } catch (error) {
    $('model-dialog-status').textContent = errorMessage(error);
  } finally {
    modelSwitching = false;
    $('model-cancel').disabled = false;
    $('switch-model').disabled = false;
    await refresh();
    $('model-apply').disabled = ($('switch-model').value || undefined) === dialogModel;
  }
});
on('change-model', showModelDialog);
on('local-check', async () => {
  $('local-status').textContent = 'Inspecting local models…';
  const report = await api.localModels(localSettings());
  const h = report.hardware;
  $('local-hardware').textContent =
    `${h.ramGiB} GiB RAM · ${h.gpu ? `${h.gpu} (${h.vramGiB} GiB)` : h.unifiedMemory ? 'Apple unified memory' : 'GPU memory not detected'}`;
  $('local-models').replaceChildren(
    ...report.models.map((m) => {
      const o = node('option', `${m.sizeGiB} GiB download`);
      o.value = m.name;
      return o;
    }),
  );
  $('local-suggestions').replaceChildren(
    ...report.suggestions.map((s) => node('li', `${s.model}: ${s.reason}`)),
  );
  $('local-status').textContent =
    `${report.selected ? `Vision + tools confirmed. Model limit: ${report.selected.maxContext} tokens. ` : ''}${report.warning ?? ''}`;
});
on('local-save', async () => {
  await api.configureLocal(localSettings());
  $('local-status').textContent =
    'Local settings saved. Connect DM to validate and use this model.';
});
on('check-provider', () => checkProvider());
on('choose-cli', async () => {
  const path = await api.chooseExecutable();
  if (path) await checkProvider(path);
});
on('choose-parent', async () => {
  const path = await api.chooseParent();
  if (path) {
    chosenParent = path;
    $('choose-parent').textContent = `Save in ${path} · Change`;
  }
});
on('open-campaign', async () => {
  const path = await api.chooseCampaign();
  if (path) await enter(await api.open(path));
});
on('recent', async () => {
  if (recent) await enter(await api.open(recent));
});
on('campaigns', async () => {
  ++viewGeneration;
  narration.leave();
  diceFeedback.cancel();
  resolvingSince = undefined;
  $('play').hidden = true;
  $('welcome').hidden = false;
  renderNarration();
  await api.stop();
  $('connection').hidden = true;
  $('stop').hidden = true;
  $('campaigns').hidden = true;
  $('campaign-heading').textContent = 'Campaigns';
  $('revision').textContent = '';
  recent = state.root;
  $('recent').hidden = false;
  const prefs = await api.preferences();
  if (prefs.local) {
    $('local-model').value = prefs.local.model;
    $('local-endpoint').value = prefs.local.endpoint;
    $('local-context').value = String(prefs.local.contextTokens);
  }
  await loadModels();
});
on('connection', () => (state?.stage === 'ready' ? showModelDialog() : connect()));
on('reconnect', () => connect());
on('fresh', () => connect(true));
on('stop', async () => {
  await api.stop();
  await refresh();
});
on('table-seat', () => seat(undefined));
on('pass', () => {
  const party = members();
  seat(party[(party.findIndex((p) => p.id === selected) + 1) % party.length]?.id);
  $('action').focus();
});
on('sheet-tab', () => {
  $('sheet').hidden = false;
  $('quests').hidden = true;
  $('sheet-tab').classList.add('active');
  $('quest-tab').classList.remove('active');
});
on('quest-tab', () => {
  $('sheet').hidden = true;
  $('quests').hidden = false;
  $('quest-tab').classList.add('active');
  $('sheet-tab').classList.remove('active');
});
$('name').addEventListener('input', () => {
  $('slug').value = $('name')
    .value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
});
$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('create').disabled = true;
  try {
    const edition = $('edition').value;
    if (edition !== '2014' && edition !== '2024')
      throw new Error('Choose the 2014 or 2024 edition.');
    await enter(
      await api.create({
        parent: chosenParent,
        slug: $('slug').value,
        name: $('name').value,
        edition,
      }),
    );
  } catch (e) {
    notice(e);
  } finally {
    $('create').disabled = false;
  }
});
$('action-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting || state?.stage !== 'ready') return;
  const text = $('action').value.trim();
  if (!text) return;
  // Keep the same request ID if IPC acknowledgement is lost. Never dispatch an uncertain request twice.
  if (
    !pendingSubmission ||
    pendingSubmission.text !== text ||
    pendingSubmission.characterId !== selected
  )
    pendingSubmission = { id: crypto.randomUUID(), characterId: selected, text };
  submitting = true;
  $('send').disabled = true;
  try {
    await api.submit(pendingSubmission);
    pendingSubmission = undefined;
    $('action').value = '';
    await refresh();
    $('transcript').scrollTop = $('transcript').scrollHeight;
  } catch (e) {
    notice(e);
  } finally {
    submitting = false;
    await refresh();
  }
});
$('roll-submit').addEventListener('click', () => void submitRequestedRoll());
$('action').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    $('action-form').requestSubmit();
  }
});
$('map-select').addEventListener('change', () => {
  selectedMap = $('map-select').value;
  offset = { x: 0, y: 0 };
  void renderMap();
});
$('map-size').addEventListener('change', () => {
  if ($('map-size').value === 'auto') offset = { x: 0, y: 0 };
  void renderMap();
});
on('map-details', () => {
  mapDetails = !mapDetails;
  $('map-details').setAttribute('aria-pressed', String(mapDetails));
  return renderMap();
});
for (const [id, dx, dy] of [
  ['pan-left', -5, 0],
  ['pan-right', 5, 0],
  ['pan-up', 0, -5],
  ['pan-down', 0, 5],
] as const)
  on(id, () => {
    offset = { x: Math.max(0, offset.x + dx), y: Math.max(0, offset.y + dy) };
    return renderMap();
  });
on('center-map', () => {
  const place = state.sheets
    .find((s) => s.character.id === selected)
    ?.placements.find((p) => p.mapId === selectedMap);
  if (!place || place.position.x === undefined || place.position.y === undefined) return;
  const dimensions = mapDimensions(state.maps.find((m) => m.id === selectedMap));
  offset = {
    x: Math.max(0, Math.floor(place.position.x - dimensions.width / 2)),
    y: Math.max(0, Math.floor(place.position.y - dimensions.height / 2)),
  };
  return renderMap();
});
async function start() {
  void checkNarration();
  const preferences = await api.preferences();
  recent = preferences.recent;
  $('recent').hidden = !recent;
  $('provider').value = preferences.provider ?? 'antigravity';
  if (preferences.local) {
    $('local-model').value = preferences.local.model;
    $('local-endpoint').value = preferences.local.endpoint;
    $('local-context').value = String(preferences.local.contextTokens);
  }
  showProvider();
  await checkProvider();
}
void start().catch(notice);
on('narration-mute', () => {
  narration.setEnabled(!narration.getState().enabled);
  saveNarration();
});
on('narration-skip', () => narration.skip());
$('narration-voice').addEventListener('change', () => {
  const voice = $('narration-voice').value;
  if (voice !== 'Easton' && voice !== 'Zoey') return;
  narration.setVoice(voice);
  saveNarration();
});
window.addEventListener('beforeunload', () => {
  unsubscribeUpdates();
  if (mapRetryTimer !== undefined) window.clearTimeout(mapRetryTimer);
  if (updateRefreshTimer !== undefined) window.clearTimeout(updateRefreshTimer);
  diceFeedback.cancel();
  narration.leave();
  narrationAudio.close();
});
// The clock is local; tool progress arrives through IPC. Occasional snapshots recover
// missed notifications and changes made outside the desktop-owned tool process.
setInterval(renderElapsed, 1000);
setInterval(() => {
  if (!$('play').hidden && !document.hidden) void refresh();
}, 15000);
window.addEventListener('focus', () => {
  if (!$('play').hidden) scheduleRefresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('play').hidden) scheduleRefresh();
});

let lanInfo: LanStatus | null;
async function showLan() {
  lanInfo = await api.lanStatus();
  if (!lanInfo) {
    $('lan-dialog').close();
    return;
  }
  const previous = $('lan-links').value;
  $('lan-links').replaceChildren(
    ...lanInfo.urls.map((url) => {
      const o = node('option', url);
      o.value = url;
      return o;
    }),
  );
  $('lan-links').value = lanInfo.urls.includes(previous)
    ? previous
    : (lanInfo.urls.find((u) => !u.includes('127.0.0.1')) ?? lanInfo.urls[0]);
  $('lan-qr').src = lanInfo.qrs[lanInfo.urls.indexOf($('lan-links').value)];
  $('lan-players').replaceChildren();
  for (const p of lanInfo.players) {
    const row = node('div', undefined, 'button-row');
    row.append(
      node(
        'span',
        `${p.name} · ${p.characterId ?? 'No character'}${p.connected ? '' : ' · Offline'}`,
      ),
    );
    for (const action of ['release', 'remove'] as const) {
      const b = node('button', action === 'release' ? 'Release seat' : 'Remove player');
      b.onclick = () => api.lanAdmin({ action, clientId: p.id }).then(showLan).catch(notice);
      row.append(b);
    }
    const assignment = node('select');
    assignment.setAttribute('aria-label', `Assign character to ${p.name}`);
    const blank = node('option', 'Assign character…');
    blank.value = '';
    assignment.append(blank);
    for (const member of state.party?.members ?? []) {
      if (lanInfo.players.some((other) => other.id !== p.id && other.characterId === member.id))
        continue;
      const option = node('option', member.name);
      option.value = member.id;
      assignment.append(option);
    }
    assignment.onchange = () => {
      if (assignment.value)
        void api
          .lanAdmin({ action: 'assign', clientId: p.id, characterId: assignment.value })
          .then(showLan)
          .catch(notice);
    };
    row.append(assignment);
    $('lan-players').append(row);
  }
  const snapshot = await api.snapshot();
  if (!snapshot.campaign) return;
  const g = snapshot.gathering;
  const required =
    g?.request?.characterIds ??
    (snapshot.encounter
      ? snapshot.encounter.activeId
        ? [snapshot.encounter.activeId]
        : []
      : (g?.seats ?? []));
  $('lan-required').replaceChildren();
  for (const id of required) {
    const b = node(
      'button',
      `Pass for ${snapshot.party.members.find((p) => p.id === id)?.name ?? id}`,
    );
    b.disabled = snapshot.stage !== 'ready';
    b.onclick = () => api.lanAdmin({ action: 'skip', characterId: id }).then(showLan).catch(notice);
    $('lan-required').append(b);
  }
  $('lan-resolve').disabled = snapshot.stage !== 'ready';
  $('lan-continue').disabled =
    snapshot.stage !== 'ready' ||
    !snapshot.encounter ||
    !!g?.request ||
    snapshot.party.members.some((p) => p.id === snapshot.encounter?.activeId);
}
on('lan-host', async () => {
  await api.startLan();
  await showLan();
  $('lan-dialog').showModal();
});
on('lan-close', () => $('lan-dialog').close());
on('lan-stop', async () => {
  await api.stopLan();
  await showLan();
});
on('lan-copy', () => navigator.clipboard.writeText($('lan-links').value));
on('lan-play', () => {
  if (lanInfo) return api.joinLan(lanInfo.urls[0]);
});
on('lan-rotate', async () => {
  await api.lanAdmin({ action: 'rotate' });
  await showLan();
});
on('lan-resolve', async () => {
  await api.lanAdmin({ action: 'resolve' });
  await showLan();
});
on('lan-continue', async () => {
  await api.lanAdmin({ action: 'continue' });
  await showLan();
});
on('lan-join', () => $('join-dialog').showModal());
on('join-close', () => $('join-dialog').close());
on('join-open', async () => {
  await api.joinLan($('join-link').value);
  $('join-dialog').close();
});
setInterval(() => {
  if ($('lan-dialog').open) void showLan().catch(notice);
}, 3000);

$('lan-links').onchange = () => {
  if (lanInfo) $('lan-qr').src = lanInfo.qrs[lanInfo.urls.indexOf($('lan-links').value)];
};
