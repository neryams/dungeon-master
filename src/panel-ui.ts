export const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Campaign dashboard</title>
    <link rel="stylesheet" href="/panel.css" />
    <script src="/panel.js" defer></script>
  </head>
  <body>
    <header>
      <div>
        <small>PLAYER DASHBOARD · READ ONLY</small>
        <h1 id="title">Campaign dashboard</h1>
        <p id="status" role="status">Connecting…</p>
      </div>
      <button id="refresh">Refresh</button>
    </header>
    <main>
      <section>
        <h2>The party</h2>
        <div id="party"></div>
      </section>
      <section>
        <h2>Character sheet</h2>
        <label
          >Character
          <select id="character"></select
        ></label>
        <div id="sheet"></div>
      </section>
      <section>
        <h2>Current story</h2>
        <div id="story"></div>
      </section>
      <section>
        <h2>Encounter</h2>
        <div id="encounter"></div>
      </section>
      <section class="maps">
        <h2>Maps</h2>
        <div class="controls">
          <label
            >Map
            <select id="map"></select></label
          ><label>X <input id="x" type="number" value="0" step="1" /></label
          ><label>Y <input id="y" type="number" value="0" step="1" /></label
          ><label
            >Width
            <input
              id="width"
              type="number"
              value="20"
              min="1"
              max="40" /></label
          ><label
            >Height
            <input
              id="height"
              type="number"
              value="20"
              min="1"
              max="40" /></label
          ><button id="view">View</button
          ><button id="center">Center on character</button>
        </div>
        <p id="map-status" role="status">No map loaded</p>
        <div class="map-scroll">
          <img id="image" alt="Saved player map" hidden />
        </div>
      </section>
    </main>
  </body>
</html>
`;
export const css = `
:root {
  font-family: system-ui, sans-serif;
  color: #e6edf3;
  background: #111b24;
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
}
header {
  padding: 28px max(20px, calc((100vw - 1400px) / 2));
  background: #1b2b38;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
h1 {
  margin: 8px 0;
  font-family: Georgia, serif;
  font-size: 32px;
}
small {
  color: #9dd6c5;
  letter-spacing: 0.12em;
}
p {
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
main {
  max-width: 1440px;
  margin: auto;
  padding: 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
section {
  min-width: 0;
  background: #1b2b38;
  border: 1px solid #354956;
  border-radius: 12px;
  padding: 22px;
}
h2 {
  margin-top: 0;
  font-size: 20px;
}
h3 {
  font-size: 17px;
  color: #a9e0cf;
}
button,
select,
input {
  font: inherit;
  padding: 9px;
  border: 1px solid #58717e;
  border-radius: 6px;
  background: #14232d;
  color: #fff;
}
button {
  cursor: pointer;
}
button:hover {
  background: #315347;
}
button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 3px solid #8ad9bd;
}
input {
  width: 80px;
}
select {
  max-width: 100%;
}
label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.maps {
  grid-column: 1/-1;
}
.map-scroll {
  overflow: auto;
}
img {
  max-width: 100%;
  height: auto;
  background: #fff;
}
article {
  border-top: 1px solid #354956;
  padding: 12px 0;
}
article:first-child {
  border: 0;
}
.muted {
  color: #afc0cc;
}
li {
  margin: 6px 0;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  main {
    grid-template-columns: 1fr;
    padding: 12px;
  }
  header {
    padding: 20px;
  }
  h1 {
    font-size: 26px;
  }
  section {
    padding: 16px;
  }
  .maps {
    grid-column: auto;
  }
  img {
    max-width: none;
    width: 820px;
  }
}
`;
export const script = String.raw`
const $ = (id) => document.getElementById(id);
let token =
  location.hash.slice(1) || sessionStorage.getItem('panel-token') || '';
if (location.hash) {
  sessionStorage.setItem('panel-token', token);
  history.replaceState(null, '', location.pathname);
}
let data,
  busy = false,
  imageUrl,
  imageRequest = 0,
  imageKey = '';
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
function para(parent, text) {
  parent.append(el('p', text));
}
function list(parent, values) {
  if (!values?.length) return;
  const ul = el('ul');
  for (const v of values) ul.append(el('li', v));
  parent.append(ul);
}
function options(select, entries) {
  const old = select.value;
  select.replaceChildren();
  for (const [id, name] of entries) {
    const o = el('option', name);
    o.value = id;
    select.append(o);
  }
  if (entries.some((e) => e[0] === old)) select.value = old;
}
const placements = (s) =>
  s.placements.map(
    (p) =>
      p.mapName +
      ' · ' +
      p.level +
      ': ' +
      (p.nodeLabel ?? '(' + p.position.x + ', ' + p.position.y + ')'),
  );
function sheet() {
  const target = $('sheet');
  target.replaceChildren();
  const s = data?.sheets.find((s) => s.character.id === $('character').value);
  if (!s) {
    para(target, 'No visible character selected.');
    return;
  }
  const c = s.character.character;
  para(target, s.character.description);
  para(
    target,
    'HP ' +
      c.hp +
      ' / ' +
      c.maxHp +
      ' · Temporary HP ' +
      c.tempHp +
      ' · AC ' +
      c.ac,
  );
  para(
    target,
    'Conditions: ' +
      (c.conditions
        .map((c) => c.name + (c.duration ? ' (' + c.duration + ')' : ''))
        .join(', ') || 'None'),
  );
  para(
    target,
    'Proficiency +' +
      c.proficiency +
      ' · Death saves ' +
      c.deathSaves.successes +
      ' successes / ' +
      c.deathSaves.failures +
      ' failures',
  );
  for (const [label, values] of [
    ['Abilities', c.abilities],
    ['Saves', c.saves],
    ['Skills', c.skills],
  ]) {
    if (Object.keys(values).length) {
      target.append(el('h3', label));
      list(
        target,
        Object.entries(values).map(([k, v]) => k + ': ' + v),
      );
    }
  }
  list(
    target,
    Object.entries(c.resources).map(
      ([k, v]) => k + ': ' + v.current + ' / ' + v.max,
    ),
  );
  list(target, placements(s));
  if (!s.placements.length) para(target, 'No visible saved placement.');
  target.append(el('h3', 'Inventory'));
  list(
    target,
    s.inventory.map(
      (i) =>
        i.name +
        ' × ' +
        i.item.quantity +
        (i.item.equipped ? ' · equipped' : '') +
        (i.item.charges
          ? ' · charges ' + i.item.charges.current + '/' + i.item.charges.max
          : '') +
        (i.description ? ' — ' + i.description : ''),
    ),
  );
  if (!s.inventory.length) para(target, 'No visible inventory.');
}
function render() {
  $('title').textContent = data.campaign.name;
  options(
    $('character'),
    data.sheets.map((s) => [s.character.id, s.character.name]),
  );
  sheet();
  const party = $('party');
  party.replaceChildren();
  for (const m of data.party.members) {
    const a = el('article');
    a.append(el('h3', m.name));
    para(
      a,
      'HP ' +
        m.hp +
        '/' +
        m.maxHp +
        ' · Temporary ' +
        m.tempHp +
        ' · AC ' +
        m.ac,
    );
    list(a, placements(m));
    party.append(a);
  }
  if (!data.party.members.length) para(party, 'No party members saved.');
  const story = $('story');
  story.replaceChildren();
  para(story, data.focus?.primaryObjective || 'No objective saved.');
  if (data.scene) {
    story.append(el('h3', data.scene.title));
    para(story, data.scene.summary);
    para(story, data.scene.centralQuestion || '');
    list(story, data.scene.progress);
    para(story, data.scene.pendingDecision || '');
    list(story, data.scene.unresolved);
  }
  for (const q of data.quests) {
    story.append(el('h3', q.name));
    para(story, q.quest.objective);
    para(story, q.quest.stakes);
    list(story, q.quest.progress);
    list(story, q.quest.leads);
    list(story, q.quest.completionConditions);
  }
  const enc = $('encounter');
  enc.replaceChildren();
  if (data.encounter) {
    para(enc, 'Round ' + data.encounter.round);
    list(
      enc,
      data.encounter.participants.map(
        (p) =>
          (p.id === data.encounter.activeId ? '▶ ' : '') +
          p.name +
          ' · ' +
          p.initiative,
      ),
    );
    if (!data.encounter.activeId) para(enc, 'No visible active participant.');
  } else para(enc, 'No visible encounter.');
  options(
    $('map'),
    data.maps.map((m) => [m.id, m.name]),
  );
}
async function request(path) {
  return fetch(path, {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
}
function clearImage() {
  imageRequest++;
  imageKey = '';
  $('image').hidden = true;
  if (imageUrl) {
    URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
  }
}
async function map() {
  if (!data || !$('map').value) {
    clearImage();
    $('map-status').textContent = 'No visible maps.';
    return;
  }
  const rev = data.revision;
  const params = new URLSearchParams({ mapId: $('map').value, revision: rev });
  for (const k of ['x', 'y', 'width', 'height']) params.set(k, $(k).value);
  const key = params.toString();
  if (imageKey === key) return;
  clearImage();
  const seq = imageRequest;
  $('map-status').textContent = 'Rendering revision ' + rev + '…';
  try {
    const r = await request('/api/map?' + key);
    if (seq !== imageRequest || data.revision !== rev) return;
    if (r.status === 409) {
      $('map-status').textContent = 'Map changed; refreshing…';
      setTimeout(refresh, 0);
      return;
    }
    if (!r.ok) throw Error((await r.json()).error);
    const blob = await r.blob();
    if (seq !== imageRequest || data.revision !== rev) return;
    imageUrl = URL.createObjectURL(blob);
    $('image').src = imageUrl;
    await $('image').decode();
    if (seq !== imageRequest || data.revision !== rev) return;
    $('image').hidden = false;
    imageKey = key;
    $('map-status').textContent = 'Saved revision ' + rev + ' · Player view';
  } catch (e) {
    if (seq === imageRequest)
      $('map-status').textContent = 'Map unavailable: ' + e.message;
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const r = await request('/api/state');
    if (!r.ok) throw Error((await r.json()).error);
    const next = await r.json();
    if (!data || next.revision !== data.revision) {
      clearImage();
      data = next;
      render();
    }
    $('status').textContent =
      'Connected · Revision ' +
      data.revision +
      ' · Checked ' +
      new Date().toLocaleTimeString();
    await map();
  } catch (e) {
    $('status').textContent =
      'Disconnected — ' +
      e.message +
      (data ? ' · Showing saved revision ' + data.revision : '');
  } finally {
    busy = false;
  }
}
$('refresh').onclick = refresh;
$('character').onchange = sheet;
$('view').onclick = map;
$('map').onchange = () => {
  for (const k of ['x', 'y']) $(k).value = 0;
  map();
};
$('center').onclick = () => {
  const s = data?.sheets.find((s) => s.character.id === $('character').value);
  const p = s?.placements.find(
    (p) => p.mapId === $('map').value && p.position.x !== undefined,
  );
  if (!p) {
    $('map-status').textContent =
      'Select a grid map with a visible saved position for this character.';
    return;
  }
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
  ])
    $(axis).value = Math.max(
      0,
      p.position[axis] - Math.floor(Number($(size).value) / 2),
    );
  map();
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden) refresh();
}, 2000);
refresh();
`;
