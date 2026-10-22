const $ = (id) => document.getElementById(id);
const key = `dm-lan:${location.host}`;
let invitation = location.hash.slice(1);
history.replaceState(null, '', '/');
let token = sessionStorage.getItem(key),
  state,
  busy = false,
  polling = false,
  dirty = false,
  pending,
  mapKey = '',
  selectedMap = '',
  inspectedCharacter,
  viewport;
try {
  pending = JSON.parse(sessionStorage.getItem(key + ':pending') ?? 'null') ?? undefined;
} catch {}
if (pending) {
  $('text').value = pending.text;
  dirty = true;
}
function clearPending() {
  pending = undefined;
  sessionStorage.removeItem(key + ':pending');
}
// getRandomValues works on LAN HTTP; randomUUID is restricted to secure contexts.
function uuid() {
  const a = crypto.getRandomValues(new Uint8Array(16));
  a[6] = (a[6] & 15) | 64;
  a[8] = (a[8] & 63) | 128;
  return [...a]
    .map((b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'))
    .join('');
}
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
function error(e) {
  $('notice').textContent = e.message;
  $('notice').hidden = false;
}
async function api(path, data) {
  const r = await fetch(`/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      token = undefined;
      clearPending();
      sessionStorage.removeItem(key);
      $('join').hidden = false;
      $('game').hidden = true;
    }
    throw new Error(result.error);
  }
  return result;
}
$('join').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('join', { invitation, name: $('name').value });
    token = r.token;
    sessionStorage.setItem(key, token);
    await refresh();
  } catch (e) {
    error(e);
  }
});
const nameOf = (id) => state.party.members.find((p) => p.id === id)?.name ?? id;
function render() {
  $('join').hidden = true;
  $('game').hidden = false;
  $('title').textContent = state.campaign.name;
  $('status').textContent =
    state.stage === 'ready'
      ? 'DM ready'
      : state.stage === 'resolving'
        ? 'DM responding…'
        : 'Waiting for host to connect DM';
  const own = state.self.characterId,
    g = state.gathering;
  $('characters').replaceChildren();
  for (const p of state.party.members) {
    const owner = state.players.find((c) => c.characterId === p.id);
    const b = el(
      'button',
      `${p.name}${owner ? ` · ${owner.name}${owner.connected ? '' : ' (offline)'}` : ''}`,
    );
    b.disabled = !!owner || !!own;
    b.setAttribute('aria-pressed', String(own === p.id));
    b.onclick = () => api('claim', { characterId: p.id }).then(refresh).catch(error);
    $('characters').append(b);
  }
  $('turn').textContent = g?.request
    ? `${g.request.kind === 'reaction' ? 'Reaction' : 'Decision'}: ${g.request.prompt}\nWaiting for ${state.required.map(nameOf).join(', ')}`
    : state.encounter
      ? `Combat · round ${state.encounter.round} · ${state.required.length ? `${state.required.map(nameOf).join(', ')} to act` : 'Waiting for host to continue the NPC turn'}`
      : `Group submission · waiting for ${
          state.required
            .filter((id) => !g?.actions[id]?.confirmed)
            .map(nameOf)
            .join(', ') || 'players to claim characters'
        }`;
  const transcript = $('transcript');
  const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 50;
  transcript.replaceChildren();
  for (const t of state.table) {
    const a = el('article');
    a.append(
      el(
        'small',
        { pending: 'DM responding…', completed: 'Resolved', interrupted: 'Interrupted' }[t.status],
      ),
    );
    if (t.actions)
      for (const x of t.actions)
        a.append(el('strong', nameOf(x.characterId)), el('p', x.pass ? 'Pass' : x.text));
    else a.append(el('strong', t.speaker), el('p', t.text));
    for (const m of t.messages) a.append(el('strong', 'Dungeon Master'), el('p', m.text));
    transcript.append(a);
  }
  if (atBottom) transcript.scrollTop = transcript.scrollHeight;
  $('intentions').replaceChildren();
  for (const id of g?.seats ?? []) {
    const a = g.actions[id];
    const row = el('div');
    row.className = 'intent';
    row.append(
      el('strong', nameOf(id)),
      el('small', a?.confirmed ? ' · Confirmed' : ' · Draft'),
      el('p', a?.pass ? 'Pass' : a?.text || '—'),
    );
    $('intentions').append(row);
  }
  if (!dirty && !pending) $('text').value = g?.actions[own]?.text ?? '';
  const allowed = !!own && (!g?.request || state.required.includes(own));
  $('text').disabled = !allowed || !!pending;
  $('retry').hidden = !pending;
  $('retry').disabled = busy;
  $('acting').textContent = own ? `Playing as ${nameOf(own)}` : 'Claim a character to play';
  for (const id of ['save', 'withdraw']) $(id).disabled = !allowed || busy || !!pending;
  for (const id of ['confirm', 'pass'])
    $(id).disabled =
      !allowed || busy || !!pending || state.stage !== 'ready' || !state.required.includes(own);
  $('now').disabled = $('confirm').disabled || !!g?.request;
  const maps = $('maps');
  if (
    JSON.stringify([...maps.options].map((o) => o.value)) !==
    JSON.stringify(state.maps.map((m) => m.id))
  ) {
    maps.replaceChildren(
      ...state.maps.map((m) => {
        const o = el('option', m.name);
        o.value = m.id;
        return o;
      }),
    );
  }
  if (!state.maps.some((m) => m.id === selectedMap)) {
    selectedMap = state.maps.some((m) => m.id === state.scene?.map)
      ? state.scene.map
      : (state.maps[0]?.id ?? '');
    viewport = undefined;
  }
  maps.value = selectedMap;
  if (!state.sheets.some((s) => s.character.id === inspectedCharacter))
    inspectedCharacter = own ?? state.sheets[0]?.character.id;
  $('sheet-select').replaceChildren(
    ...state.sheets.map((s) => {
      const o = el('option', s.character.name);
      o.value = s.character.id;
      return o;
    }),
  );
  $('sheet-select').value = inspectedCharacter ?? '';
  const sheet = state.sheets.find((s) => s.character.id === inspectedCharacter);
  $('sheet-content').replaceChildren();
  if (sheet) {
    $('sheet-content').append(el('h2', sheet.character.name));
    const c = sheet.character.character;
    function section(title, entries) {
      $('sheet-content').append(el('h2', title));
      const dl = el('dl');
      for (const [label, value] of entries) dl.append(el('dt', label), el('dd', String(value)));
      $('sheet-content').append(entries.length ? dl : el('p', 'None recorded'));
    }
    section('Vitals', [
      ['HP', `${c.hp} / ${c.maxHp}`],
      ['Temporary HP', c.tempHp],
      ['Armor class', c.ac],
      ['Proficiency', c.proficiency],
      ['Death saves', `${c.deathSaves.successes} successes · ${c.deathSaves.failures} failures`],
    ]);
    section(
      'Abilities',
      Object.entries(c.abilities).map(([k, v]) => [k.toUpperCase(), v]),
    );
    section('Saving throws', Object.entries(c.saves));
    section('Skills', Object.entries(c.skills));
    section(
      'Conditions',
      c.conditions.map((c) => [c.name, c.duration ?? 'Active']),
    );
    section(
      'Resources',
      Object.entries(c.resources).map(([k, v]) => [k, `${v.current} / ${v.max}`]),
    );
    section(
      'Inventory',
      sheet.inventory.map((i) => [
        i.name,
        `×${i.item.quantity}${i.item.equipped ? ' · equipped' : ''}`,
      ]),
    );
    section(
      'Positions',
      sheet.placements.map((p) => [p.mapName, p.nodeLabel ?? `${p.position.x}, ${p.position.y}`]),
    );
  }
  $('journal').replaceChildren(el('p', state.scene?.summary ?? ''));
  for (const q of state.quests) $('journal').append(el('h2', q.name), el('p', q.description ?? ''));
}
async function refresh() {
  if (!token || polling) return;
  polling = true;
  try {
    state = await api('state');
    render();
    if (!$('map').hidden) await map();
  } catch (e) {
    error(e);
  } finally {
    polling = false;
  }
}
async function send(confirmed, pass = false, sendNow = false, withdraw = false) {
  if (busy) return;
  busy = true;
  render();
  try {
    const payload = {
      id: uuid(),
      epoch: state.gathering?.epoch ?? 0,
      text: withdraw ? '' : $('text').value,
      confirmed,
      pass,
      sendNow,
    };
    // Preserve the exact operation on uncertain network failure. Changed input requires refresh/new confirmation.
    pending ??= payload;
    sessionStorage.setItem(key + ':pending', JSON.stringify(pending));
    await api('intent', pending);
    clearPending();
    dirty = false;
    $('notice').hidden = true;
  } catch (e) {
    if (e instanceof TypeError)
      error(new Error('Connection lost. Retry the same action to recover its saved result.'));
    else {
      clearPending();
      error(e);
    }
  } finally {
    busy = false;
    await refresh();
  }
}
$('text').oninput = () => {
  dirty = true;
};
$('compose').onsubmit = (e) => {
  e.preventDefault();
  void send(true);
};
$('retry').onclick = () => send(false);
$('save').onclick = () => send(false);
$('pass').onclick = () => send(true, true);
$('now').onclick = () => send(true, false, true);
$('withdraw').onclick = () => send(false, false, false, true);
for (const b of document.querySelectorAll('[data-tab]'))
  b.onclick = () => {
    for (const v of ['table', 'map', 'sheet']) $(v).hidden = v !== b.dataset.tab;
    for (const n of document.querySelectorAll('[data-tab]'))
      n.setAttribute('aria-pressed', String(n === b));
    void refresh();
  };
$('maps').onchange = () => {
  selectedMap = $('maps').value;
  viewport = undefined;
  void map().catch(error);
};
function fit() {
  const b = state.maps.find((m) => m.id === selectedMap)?.bounds;
  return b
    ? { x: 0, y: 0, width: Math.min(40, b.width), height: Math.min(40, b.height) }
    : { x: 0, y: 0, width: 20, height: 20 };
}
async function map() {
  if (!selectedMap) {
    $('map-image').removeAttribute('src');
    return;
  }
  viewport ??= fit();
  const request = { mapId: selectedMap, revision: state.revision, viewport, details: false };
  const k = JSON.stringify(request);
  if (k === mapKey) return;
  const r = await api('map', request);
  if (
    r.stale ||
    r.busy ||
    request.revision !== state.revision ||
    request.mapId !== selectedMap ||
    JSON.stringify(request.viewport) !== JSON.stringify(viewport)
  )
    return;
  mapKey = k;
  $('map-image').src = r.image;
  $('map-notice').textContent = (r.warnings ?? []).join(' ');
}
for (const [id, x, y] of [
  ['left', -5, 0],
  ['right', 5, 0],
  ['up', 0, -5],
  ['down', 0, 5],
])
  $(id).onclick = () => {
    viewport ??= fit();
    viewport = { ...viewport, x: viewport.x + x, y: viewport.y + y };
    void map().catch(error);
  };
$('fit').onclick = () => {
  viewport = fit();
  void map().catch(error);
};
setInterval(() => {
  if (!document.hidden) void refresh();
}, 2000);
void refresh();

$('map-size').onchange = () => {
  viewport ??= fit();
  const size = Number($('map-size').value);
  viewport = { ...viewport, width: size, height: size };
  void map().catch(error);
};

$('sheet-select').onchange = () => {
  inspectedCharacter = $('sheet-select').value;
  render();
};
