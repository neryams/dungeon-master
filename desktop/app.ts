import type {
  CampaignSnapshot,
  DesktopSnapshot,
  SubmitInput,
  MapInput,
  PlayerView,
  LanStatus,
  LocalSettings,
} from '#desktop/contracts';
import { elements, node, errorMessage } from './dom.js';
const tags = {
  'campaign-heading': 'div',
  revision: 'span',
  'lan-host': 'button',
  'lan-join': 'button',
  campaigns: 'button',
  connection: 'button',
  stop: 'button',
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
  'session-status': 'div',
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
let state: CampaignSnapshot,
  selected: string | undefined,
  chosenParent: string | undefined,
  recent: string | undefined,
  shownRevision = -1,
  transcriptKey = '',
  mapKey = '',
  selectedMap = '',
  mapDetails = false,
  offset = { x: 0, y: 0 },
  polling = false,
  submitting = false,
  pendingSubmission: SubmitInput | undefined;
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
  selected = id;
  renderParty();
  renderSheet();
  $('acting-as').textContent = selected
    ? `Playing as ${members().find((p) => p.id === selected)?.name ?? 'character'}`
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
    const avatar = node('span', p.name.slice(0, 1).toUpperCase(), 'party-avatar');
    avatar.setAttribute('aria-hidden', 'true');
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
  const key = JSON.stringify(state.table);
  if (key === transcriptKey) return;
  transcriptKey = key;
  if (!state.table?.length) return;
  const log = $('transcript');
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  log.replaceChildren();
  function message(speaker: string, text: string, revision: number, player = false) {
    const article = node('article', undefined, `message${player ? ' player' : ''}`);
    const label = node('div', undefined, 'message-label');
    label.append(node('span', speaker.toUpperCase()), node('small', `r${revision}`));
    article.append(label, node('div', text, 'message-text'));
    log.append(article);
    return article;
  }
  for (const turn of state.table) {
    message(turn.speaker, turn.text, turn.revision, true);
    for (const m of turn.messages) message('Dungeon Master', m.text, m.revision);
    if (turn.status === 'interrupted')
      log.append(
        node('p', 'Turn interrupted · Check saved outcomes before continuing.', 'interrupted'),
      );
  }
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
async function renderMap() {
  const m = state?.maps?.find((m) => m.id === selectedMap);
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
    if (key !== mapKey || state.revision !== input.revision) return;
    if (result.stale || result.busy) {
      mapKey = '';
      return;
    }
    $('map-image').src = result.image;
    $('map-image').hidden = false;
    $('map-status').textContent =
      `r${result.revision}${m.kind === 'grid' ? ` · ${offset.x}, ${offset.y}` : ''}${result.warnings?.length ? ` · ${result.warnings.join(' ')}` : ''}`;
  } catch (e) {
    mapKey = '';
    $('map-status').textContent = 'Map unavailable; retrying';
  }
}
function renderState() {
  if (!state.campaign) return;
  $('campaign-heading').textContent = state.campaign.name;
  $('revision').textContent = `Saved · r${state.revision}`;
  $('connection').hidden = false;
  $('campaigns').hidden = false;
  $('lan-host').hidden = false;
  const busy = state.stage === 'connecting' || state.stage === 'resolving';
  $('stop').hidden = state.stage !== 'resolving' && state.stage !== 'ready';
  $('campaigns').disabled = busy;
  $('connection').disabled = busy || state.stage === 'ready';
  $('connection').textContent =
    state.stage === 'ready'
      ? 'DM connected'
      : state.stage === 'connecting'
        ? 'Connecting…'
        : 'Connect DM';
  $('send').disabled = state.stage !== 'ready' || submitting || state.lanHosted;
  $('lan-host').textContent = state.lanHosted ? 'LAN game' : 'Host LAN game';
  $('status-text').textContent = state.lanHosted
    ? 'Use LAN game → Open player seat to play.'
    : state.stage === 'ready'
      ? 'DM connected'
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
  void renderMap();
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const snapshot = await api.snapshot();
    if (snapshot.campaign) {
      state = snapshot;
      renderState();
    }
  } catch (e) {
    notice(e);
  } finally {
    polling = false;
  }
}
async function connect(fresh = false) {
  if ($('provider').value === 'ollama') await api.configureLocal(localSettings());
  const promise = api.connect(fresh);
  void refresh();
  try {
    await promise;
  } finally {
    await refresh();
  }
}
export function showCampaign(snapshot: DesktopSnapshot) {
  if (!snapshot.campaign) throw new Error('No campaign is open');
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
  $('action').value = '';
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
  } catch (e) {
    $('provider-status').textContent = 'Not ready · Install or choose the selected CLI below';
    throw e;
  }
}
on('dismiss', () => {
  $('notice').hidden = true;
});
$('provider').onchange = () => {
  void (async () => {
    const provider =
      $('provider').value === 'ollama'
        ? 'ollama'
        : $('provider').value === 'codex'
          ? 'codex'
          : 'antigravity';
    await api.selectProvider(provider);
    showProvider();
    await checkProvider();
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
  $('provider-command').textContent = $('provider').value === 'codex' ? 'codex login' : 'agy';
}
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
  await api.stop();
  $('play').hidden = true;
  $('welcome').hidden = false;
  $('connection').hidden = true;
  $('stop').hidden = true;
  $('campaigns').hidden = true;
  $('campaign-heading').textContent = 'Campaigns';
  $('revision').textContent = '';
  recent = state.root;
  $('recent').hidden = false;
});
on('connection', () => connect());
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
setInterval(() => {
  if (!$('play').hidden) void refresh();
}, 1000);

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
