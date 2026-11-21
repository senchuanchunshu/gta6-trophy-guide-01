// Leonida Trophy Guide — tracker logic. Static data only: it fetches app/data/trophies.json
// from the same server and stores progress in localStorage. No network at run time.
const KEY = 'gta6-trophy-guide-v1';
const listEl = document.getElementById('trophyList');
const detailEl = document.getElementById('detail');
const detailBody = document.getElementById('detailBody');
const noteEl = document.getElementById('listNote');
const emptyEl = document.getElementById('emptyNote');
const searchEl = document.getElementById('search');
const gradeEl = document.getElementById('grade');
const spoilerEl = document.getElementById('spoiler');
const params = new URLSearchParams(location.search);

const store = loadStore();
let data = null;
let trophies = [];
let sources = {};
let kind = params.get('filter') || 'all';
let selectedId = null;

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      earned: new Set(Array.isArray(raw.earned) ? raw.earned : []),
      spoiler: typeof raw.spoiler === 'boolean' ? raw.spoiler : params.get('spoiler') === 'on',
    };
  } catch {
    return { earned: new Set(), spoiler: params.get('spoiler') === 'on' };
  }
}

function saveStore() {
  localStorage.setItem(KEY, JSON.stringify({ earned: [...store.earned], spoiler: store.spoiler }));
}

const KIND_LABELS = {
  story: 'Story', missable: 'Missable', collectibles: 'Collectibles',
  activities: 'Activities', milestone: 'Milestone', online: 'Online',
};
const GRADE_LABELS = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

function isHidden(t) { return t.hidden === true; }
function isMissable(t) { return t.missable === true; }
function isSpoilered(t) { return store.spoiler && isHidden(t) && !store.earned.has(t.id); }

function matchesKind(t) {
  if (kind === 'all') return true;
  if (kind === 'missable') return isMissable(t);
  if (kind === 'online') return false; // all 55 trophies are offline
  return t.kind === kind;
}

function matchesGrade(t) { return gradeEl.value === 'all' || t.grade === gradeEl.value; }

function matchesSearch(t) {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return true;
  const hay = [t.name, t.description, t.guide, t.kind, t.grade].join(' ').toLowerCase();
  return hay.includes(q);
}

function visibleTrophies() {
  return trophies.filter((t) => matchesKind(t) && matchesGrade(t) && matchesSearch(t));
}

function renderProgress() {
  const total = trophies.length;
  const n = store.earned.size;
  const pct = total ? Math.round((n / total) * 100) : 0;
  document.getElementById('progressText').textContent = `${n} of ${total} earned`;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
  const byGrade = {};
  for (const t of trophies) {
    byGrade[t.grade] = byGrade[t.grade] || [0, 0];
    byGrade[t.grade][1] += 1;
    if (store.earned.has(t.id)) byGrade[t.grade][0] += 1;
  }
  document.getElementById('gradeCounts').innerHTML = ['platinum', 'gold', 'silver', 'bronze']
    .map((g) => {
      const [got, all] = byGrade[g] || [0, 0];
      return `<span>${GRADE_LABELS[g]} <b>${got}/${all}</b></span>`;
    }).join('');
}

function tagHtml(t) {
  const tags = [`<span class="tag kind-tag">${KIND_LABELS[t.kind] || t.kind}</span>`];
  if (isHidden(t)) tags.push('<span class="tag hidden-tag">Hidden</span>');
  if (isMissable(t)) tags.push('<span class="tag missable-tag">Possibly missable</span>');
  return tags.join('');
}

function renderList() {
  const shown = visibleTrophies();
  listEl.replaceChildren();
  for (const t of shown) {
    const li = document.createElement('li');
    li.className = 'trophy' + (store.earned.has(t.id) ? ' earned' : '') + (selectedId === t.id ? ' selected' : '');
    li.dataset.id = String(t.id);

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = store.earned.has(t.id);
    box.setAttribute('aria-label', `Mark ${t.name} as earned`);
    box.addEventListener('change', (event) => {
      event.stopPropagation();
      toggleEarned(t.id, box.checked);
    });
    box.addEventListener('click', (event) => event.stopPropagation());

    const mid = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'trophy-name';
    name.textContent = isSpoilered(t) ? 'Hidden trophy — earn it to reveal' : t.name;
    const desc = document.createElement('div');
    desc.className = 'trophy-desc';
    desc.textContent = isSpoilered(t) ? 'This trophy is hidden on PlayStation until earned.' : t.description;
    const preview = document.createElement('div');
    preview.className = 'trophy-guide-preview';
    preview.textContent = isSpoilered(t) ? '' : t.guide.split('. ')[0] + '.';
    const tags = document.createElement('div');
    tags.className = 'tags';
    tags.innerHTML = tagHtml(t);
    mid.append(name, desc, preview, tags);

    const right = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = `grade-badge grade-${t.grade}`;
    badge.textContent = t.grade;
    right.append(badge);
    if (t.count) {
      const count = document.createElement('span');
      count.className = 'count-badge';
      count.textContent = `Count: ${t.count}`;
      right.append(count);
    }

    li.append(box, mid, right);
    li.addEventListener('click', () => selectTrophy(t.id));
    listEl.append(li);
  }
  const shownCount = shown.length;
  noteEl.textContent = kind === 'online'
    ? 'Online filter: no trophies — all 55 are offline, single-player trophies.'
    : `Showing ${shownCount} of ${trophies.length} trophies` +
      (kind !== 'all' ? ` · ${KIND_LABELS[kind] || kind}` : '') +
      (gradeEl.value !== 'all' ? ` · ${GRADE_LABELS[gradeEl.value]}` : '') +
      (searchEl.value.trim() ? ` · matching “${searchEl.value.trim()}”` : '');
  emptyEl.hidden = shownCount !== 0;
}

function renderSources() {
  const ul = document.getElementById('sourceList');
  ul.replaceChildren();
  for (const [key, s] of Object.entries(sources)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.textContent = s.label;
    a.rel = 'noopener';
    li.append(a);
    if (key === 'official') {
      li.append(document.createTextNode(' — the official names, descriptions and grades, as reported 18 Nov 2026.'));
    }
    ul.append(li);
  }
}

function sourceLinks(t) {
  return (t.sources || []).map((key) => sources[key]).filter(Boolean);
}

function selectTrophy(id) {
  selectedId = id;
  const t = trophies.find((x) => x.id === id);
  if (!t) return;
  const earned = store.earned.has(id);
  detailBody.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = isSpoilered(t) ? 'Hidden trophy' : t.name;
  const official = document.createElement('p');
  official.className = 'official';
  official.innerHTML = '';
  const gradeLine = document.createElement('p');
  gradeLine.className = 'official';
  gradeLine.innerHTML = `<b>Grade:</b> ${GRADE_LABELS[t.grade]} &nbsp; <b>Kind:</b> ${KIND_LABELS[t.kind] || t.kind}` +
    (isHidden(t) ? ' &nbsp; <b>Hidden on PlayStation</b>' : '') +
    (isMissable(t) ? ' &nbsp; <b>Possibly missable</b>' : '') +
    (t.count ? ` &nbsp; <b>Count:</b> ${t.count}` : '');
  const descTitle = document.createElement('h4');
  descTitle.textContent = 'Official description';
  const desc = document.createElement('p');
  desc.textContent = isSpoilered(t) ? 'Hidden until earned.' : t.description;
  const guideTitle = document.createElement('h4');
  guideTitle.textContent = 'Guide';
  const guide = document.createElement('p');
  guide.className = 'guide-text';
  guide.textContent = isSpoilered(t)
    ? 'Turn off “Hide story spoilers” or earn this trophy to read its guide.'
    : t.guide;
  const srcTitle = document.createElement('h4');
  srcTitle.textContent = 'Sources for this guide';
  const srcList = document.createElement('ul');
  for (const s of sourceLinks(t)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.textContent = s.label;
    a.rel = 'noopener';
    li.append(a);
    srcList.append(li);
  }
  if (!srcList.children.length) {
    const li = document.createElement('li');
    li.textContent = 'Official trophy list (Exophase / PSNProfiles).';
    srcList.append(li);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'earn-btn' + (earned ? ' earned-btn' : '');
  btn.textContent = earned ? '✓ Earned — click to unmark' : 'Mark as earned';
  btn.addEventListener('click', () => toggleEarned(id, !store.earned.has(id)));
  detailBody.append(h, gradeLine, descTitle, desc, guideTitle, guide, srcTitle, srcList, btn);
  detailEl.hidden = false;
  renderList();
}

function toggleEarned(id, on) {
  if (on) store.earned.add(id); else store.earned.delete(id);
  saveStore();
  renderProgress();
  renderList();
  if (selectedId === id) selectTrophy(id);
}

function setKind(next) {
  kind = next;
  for (const chip of document.querySelectorAll('#kindChips .chip')) {
    chip.classList.toggle('active', chip.dataset.kind === next);
  }
  renderList();
}

// Toolbar wiring
for (const chip of document.querySelectorAll('#kindChips .chip')) {
  chip.addEventListener('click', () => setKind(chip.dataset.kind));
}
gradeEl.addEventListener('change', renderList);
searchEl.addEventListener('input', renderList);
spoilerEl.addEventListener('change', () => {
  store.spoiler = spoilerEl.checked;
  saveStore();
  renderList();
  if (selectedId !== null) selectTrophy(selectedId);
});
document.getElementById('detailClose').addEventListener('click', () => {
  detailEl.hidden = true;
  selectedId = null;
  renderList();
});
document.getElementById('export').addEventListener('click', () => {
  const payload = {
    game: 'Grand Theft Auto VI',
    exportedAt: new Date().toISOString(),
    earned: [...store.earned].sort((a, b) => a - b),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = 'gta6-trophy-progress.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('import').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const ids = Array.isArray(raw) ? raw : raw.earned;
    if (!Array.isArray(ids)) throw new Error('no earned list');
    const valid = new Set(trophies.map((t) => t.id));
    store.earned = new Set(ids.filter((n) => valid.has(n)));
    saveStore();
    renderProgress();
    renderList();
    noteEl.textContent = `Imported ${store.earned.size} earned trophies from ${file.name}.`;
  } catch {
    noteEl.textContent = `Could not import ${file.name}: not a progress file from this guide.`;
  }
  event.target.value = '';
});
document.getElementById('reset').addEventListener('click', () => {
  if (!store.earned.size && !store.spoiler) return;
  store.earned.clear();
  saveStore();
  renderProgress();
  renderList();
});

// Boot: load the trophy data, then honour deep-link parameters (?filter, ?grade, ?spoiler, ?q, ?open).
const doc = await (await fetch('data/trophies.json')).json();
trophies = doc.trophies;
sources = doc.sources || {};
if (params.get('grade')) gradeEl.value = params.get('grade');
if (params.get('q')) searchEl.value = params.get('q');
spoilerEl.checked = store.spoiler;
const VALID_KINDS = ['all', 'story', 'missable', 'collectibles', 'activities', 'milestone', 'online'];
if (!VALID_KINDS.includes(kind)) kind = 'all';
setKind(kind);
renderSources();
renderProgress();
renderList();
const openId = Number(params.get('open'));
if (openId) selectTrophy(openId);
if (params.get('view') === 'roadmap') {
  document.getElementById('roadmap').scrollIntoView();
}
