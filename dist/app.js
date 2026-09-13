import { Player } from './lib/player.js?v=20260913-23';
import { cleanTitle, summarizeMetadata, setIcon, trackTitle, trackUsage } from './lib/presentation.js?v=20260913-30';
import { iconTexturePaths } from './lib/tex.js?v=20260913-22';
import { applyStaticTranslations, getLanguage, setLanguage, t } from './lib/i18n.js?v=20260913-33';
import { directoryPermission, loadDirectoryHandle, saveDirectoryHandle } from './lib/directory-store.js';

const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./catalog-worker.js?v=20260913-24', import.meta.url), { type: 'module' });
const pending = new Map();
let requestId = 0, catalog = [], filter = 'bgm', featureFilters = new Set(), selected = null, info = null, duration = 0, selection = 0, dragging = false, channelSelection = null, autoVariant = false;
let libraryLabel = '', libraryStatusMessage = '', libraryStatusError = false, metadataScanId = 0, trackRows = new Map(), lastDirectoryHandle = null;
let opening = false, loading = false, decodeQueue = Promise.resolve();
let coverObjectUrl = null, coverRequestId = 0, playerTransitionToken = 0, lastRenderStateKey = '';
const METADATA_CACHE_KEY = 'xiv-player-track-metadata-v2';
const LAST_TRACK_KEY = 'xiv-player-last-track-v1';
let metadataCache = readMetadataCache(), cacheWriteTimer = null;
const PLAYBACK_ORDERS = [
  { mode: 'sequential', label: 'playback.sequential', icon: 'order' },
  { mode: 'repeat-all', label: 'playback.repeatAll', icon: 'repeat' },
  { mode: 'repeat-one', label: 'playback.repeatOne', icon: 'repeatOne' },
  { mode: 'shuffle', label: 'playback.shuffle', icon: 'shuffle' },
];
const BGM_GROUPS = [
  { key: 'base', start: 1, label: 'library.versionBase' },
  { key: 'ex1', start: 267, label: 'library.version3' },
  { key: 'ex2', start: 424, label: 'library.version4' },
  { key: 'ex3', start: 630, label: 'library.version5' },
  { key: 'ex4', start: 810, label: 'library.version6' },
  { key: 'ex5', start: 1003, label: 'library.version7' },
];
const collapsedBgmGroups = new Set();
let lastVariant = null, filteredRenderTimer = null, playbackMode = 'sequential', finishHandledTrackId = null;
let shuffleQueue = [], shufflePosition = -1;
let restoreLastTrackOnOpen = true;
const presetReady = fetch(new URL('./data/track-metadata.json', import.meta.url))
  .then(response => { if (!response.ok) throw new Error('Metadata unavailable'); return response.json(); })
  .then(data => data.schemaVersion === 1 ? data.tracks : {}).catch(() => ({}));
let presetMetadata = {};
const player = new Player(handlePlayerState, message => status('player-status', message, true));

worker.onmessage = ({ data }) => {
  const entry = pending.get(data.id);
  if (!entry) return;
  if (data.type === 'progress') { entry.progress?.(data.message); return; }
  pending.delete(data.id);
  if (data.type === 'error') entry.reject(new Error(data.message)); else entry.resolve(data.result);
};
worker.onerror = () => {
  for (const entry of pending.values()) entry.reject(new Error(t('status.workerError')));
  pending.clear(); status('library-status', t('status.workerError'), true);
};
function request(type, payload = {}, progress) {
  return new Promise((resolve, reject) => {
    const id = ++requestId; pending.set(id, { resolve, reject, progress });
    worker.postMessage({ id, type, ...payload });
  });
}
function status(id, message, error = false) {
  $(id).textContent = message; $(id).classList.toggle('error', error);
  if (id === 'library-status') { libraryStatusMessage = message; libraryStatusError = error; }
}
function beginTrackTransition() {
  const title = document.querySelector('.track-title');
  if (!title) return Promise.resolve(0);
  const token = ++playerTransitionToken;
  title.classList.remove('is-switching');
  void title.offsetWidth;
  title.classList.add('is-switching');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve(token);
  return new Promise(resolve => setTimeout(() => resolve(token), 380));
}
function finishTrackTransition(token) {
  if (token !== playerTransitionToken) return;
  requestAnimationFrame(() => document.querySelector('.track-title')?.classList.remove('is-switching'));
}
function finishCoverTransition() {
  requestAnimationFrame(() => $('cover').classList.remove('is-changing'));
}
function scrollSelectedTrackIntoView() {
  const row = trackRows.get(selected?.id);
  if (!row) return;
  const list = $('tracks'), rowBox = row.getBoundingClientRect(), listBox = list.getBoundingClientRect();
  if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom || rowBox.left < listBox.left || rowBox.right > listBox.right) row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
function currentPlaybackOrder() { return PLAYBACK_ORDERS.find(order => order.mode === playbackMode) || PLAYBACK_ORDERS[0]; }
function orderLabel(order = currentPlaybackOrder()) { return t(order.label); }
function languageSeparator() { return t('directory.separator'); }
function trackCategory(track) { return track?.kind === 'orchestrion' ? t('library.orchestrion') : t('library.bgm'); }
function cleanTrackTitles(track) {
  const titleByLocale = track.titleByLocale ? Object.fromEntries(Object.entries(track.titleByLocale).map(([locale, value]) => [locale, cleanTitle(value)])) : null;
  return { ...track, title: cleanTitle(track.title), ...(titleByLocale ? { titleByLocale } : {}) };
}
function updateLanguageMenu() {
  const language = getLanguage();
  document.querySelectorAll('#language-menu [data-language]').forEach(button => {
    const active = button.dataset.language === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function updateFilterToggle() {
  const button = $('filter-toggle');
  const active = featureFilters.size > 0;
  const label = t(active ? 'library.filterActive' : 'library.filter');
  button.classList.toggle('active', active);
  button.title = label;
  button.setAttribute('aria-label', label);
}
function applyLanguage() {
  const libraryStatus = libraryStatusMessage, libraryError = libraryStatusError;
  applyStaticTranslations();
  updateLanguageMenu();
  updateFilterToggle();
  updatePlaybackOrder();
  updateVolumeControl();
  renderTracks();
  renderTrackInfo();
  renderPlayerDetail();
  $('title').textContent = selected ? trackTitle(selected, getLanguage()) : t('player.continue');
  if (catalog.length || libraryStatus) status('library-status', libraryStatus, libraryError);
  if (info) renderChannels(info.channels);
  renderState(player.state);
  document.documentElement.classList.remove('i18n-pending');
}
function persistPreferences() {
  try {
    localStorage.setItem('xiv-player-preferences', JSON.stringify({
      mode: $('loop-mode').value,
      limit: Number($('loop-limit').value),
      volume: player.volume,
      playbackMode,
    }));
  } catch { /* Storage can be disabled. */ }
}
function updatePlaybackOrder() {
  const order = currentPlaybackOrder();
  const button = $('playback-order');
  const label = orderLabel(order);
  button.title = t('playback.orderTitle', { mode: label });
  button.setAttribute('aria-label', t('playback.orderTitle', { mode: label }));
  button.classList.toggle('active', order.mode !== 'sequential');
  setIcon($('playback-order-icon'), order.icon);
}
function volumeIconName(value = player.volume) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return normalized <= 0.001 ? 'volumeMute' : normalized < 0.5 ? 'volumeLow' : 'volume';
}
function updateVolumeControl() {
  const value = Math.max(0, Math.min(1, Number(player.volume) || 0));
  const label = t('player.volumeValue', { value: Math.round(value * 100) });
  setIcon($('volume-icon'), volumeIconName(value));
  $('volume-toggle').title = label;
  $('volume-toggle').setAttribute('aria-label', label);
}
function shuffleIds(playlist, avoidFirstId = null) {
  const ids = playlist.map(track => track.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  if (avoidFirstId && ids.length > 1 && ids[0] === avoidFirstId) {
    const swap = 1 + Math.floor(Math.random() * (ids.length - 1));
    [ids[0], ids[swap]] = [ids[swap], ids[0]];
  }
  return ids;
}
function resetShuffleQueue(track = null, playlist = playlistTracks()) {
  if (!track) { shuffleQueue = []; shufflePosition = -1; return; }
  shuffleQueue = [track.id, ...shuffleIds(playlist.filter(candidate => candidate.id !== track.id))];
  shufflePosition = 0;
}
function syncShuffleQueue() {
  if (playbackMode !== 'shuffle' || !selected) return;
  if (shuffleQueue[shufflePosition] === selected.id) return;
  const existing = shuffleQueue.lastIndexOf(selected.id);
  if (existing >= 0) { shufflePosition = existing; return; }
  resetShuffleQueue(selected);
}
function recordShuffleSelection(track) {
  if (playbackMode !== 'shuffle' || !track || shuffleQueue[shufflePosition] === track.id) return;
  shuffleQueue = shuffleQueue.slice(0, shufflePosition + 1);
  shuffleQueue.push(track.id); shufflePosition = shuffleQueue.length - 1;
}
function setPlaybackMode(mode, announce = true) {
  if (!PLAYBACK_ORDERS.some(order => order.mode === mode)) return;
  const changed = playbackMode !== mode;
  playbackMode = mode;
  if (changed) resetShuffleQueue(mode === 'shuffle' ? selected : null);
  updatePlaybackOrder();
  persistPreferences();
  if (announce) status('player-status', t('status.orderChanged', { mode: orderLabel() }));
  if (player.state.finished && selected && info && mode !== 'sequential') {
    finishHandledTrackId = null;
    handlePlayerState(player.state);
  }
}
function visibleTracks() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const tracks = catalog.filter(track => {
    if (track.kind !== filter || (!$('show-debug').checked && isEmptyAudioTrack(track))) return false;
    if (![...featureFilters].every(feature => track.metadata?.[`has${feature[0].toUpperCase()}${feature.slice(1)}`])) return false;
    const usage = trackUsage(track, getLanguage());
    const usageValues = [
      usage === '-' ? '' : usage,
      ...Object.values(track.usageByLocale || {}).flatMap(values => Array.isArray(values) ? values : []),
      ...(Array.isArray(track.uses) ? track.uses : []),
      ...(Array.isArray(track.dungeons) ? track.dungeons : []),
      ...(Array.isArray(track.maps) ? track.maps : []),
      ...(Array.isArray(track.seasonalEvents) ? track.seasonalEvents : []),
      ...(Array.isArray(track.events) ? track.events : []),
    ];
    const searchable = [track.title, ...Object.values(track.titleByLocale || {}), track.path, track.rowId, ...usageValues].join(' ');
    return searchable.toLocaleLowerCase().includes(query);
  });
  return tracks;
}
function bgmOrderMap() {
  const positions = new Map();
  let position = 0;
  for (const track of catalog) {
    if (track.kind !== 'bgm') continue;
    positions.set(track.id, ++position);
  }
  return positions;
}
function bgmGroupAt(position) {
  let group = BGM_GROUPS[0];
  for (const candidate of BGM_GROUPS) {
    if (position < candidate.start) break;
    group = candidate;
  }
  return group;
}
function isEmptyAudioTrack(track) {
  if (!track?.available) return true;
  if (!track.metadata?.ready) return false;
  return Boolean(track.metadata.error || track.metadata.codec === '空资源');
}
function playlistTracks() { return visibleTracks().filter(track => track.available); }
function previousShuffleTrack(playlist) {
  syncShuffleQueue();
  for (let index = shufflePosition - 1; index >= 0; index--) {
    const track = playlist.find(candidate => candidate.id === shuffleQueue[index]);
    if (track) { shufflePosition = index; return track; }
  }
  return null;
}
function nextShuffleTrack(playlist) {
  syncShuffleQueue();
  for (let index = shufflePosition + 1; index < shuffleQueue.length; index++) {
    const track = playlist.find(candidate => candidate.id === shuffleQueue[index]);
    if (track) { shufflePosition = index; return track; }
  }
  shuffleQueue = shuffleQueue.slice(0, shufflePosition + 1);
  shuffleQueue.push(...shuffleIds(playlist, selected?.id));
  for (let index = shufflePosition + 1; index < shuffleQueue.length; index++) {
    const track = playlist.find(candidate => candidate.id === shuffleQueue[index]);
    if (track) { shufflePosition = index; return track; }
  }
  return selected || playlist[0] || null;
}
function hasShufflePrevious(playlist) {
  for (let index = shufflePosition - 1; index >= 0; index--) {
    if (playlist.some(track => track.id === shuffleQueue[index])) return true;
  }
  return false;
}
function adjacentTrack(direction = 1, automatic = false) {
  const playlist = playlistTracks();
  const index = playlist.findIndex(track => track.id === selected?.id);
  if (index < 0 || !playlist.length) return null;
  if (automatic) {
    if (playbackMode === 'repeat-one') return selected;
    if (playbackMode === 'shuffle') return nextShuffleTrack(playlist);
    if (index + 1 < playlist.length) return playlist[index + 1];
    return playbackMode === 'repeat-all' ? playlist[0] : null;
  }
  if (playbackMode === 'shuffle') {
    return direction < 0 ? previousShuffleTrack(playlist) : nextShuffleTrack(playlist);
  }
  const target = index + direction;
  if (target >= 0 && target < playlist.length) return playlist[target];
  return playbackMode === 'repeat-all' ? playlist[(target + playlist.length) % playlist.length] : null;
}
function updateNavigationControls() {
  const playlist = playlistTracks();
  const index = playlist.findIndex(track => track.id === selected?.id);
  const usable = !opening && !loading && index >= 0 && playlist.length > 1;
  const wraps = playbackMode === 'repeat-all' || playbackMode === 'shuffle';
  $('previous').disabled = !usable || (playbackMode === 'shuffle' ? !hasShufflePrevious(playlist) : (!wraps && index === 0));
  $('next').disabled = !usable || (!wraps && index === playlist.length - 1);
}
function handlePlayerState(state) {
  renderState(state);
  if (!state.finished) {
    finishHandledTrackId = null;
    return;
  }
  if (!selected || !info || loading || finishHandledTrackId === selected.id) return;
  finishHandledTrackId = selected.id;
  if (playbackMode === 'repeat-one') {
    player.restart().catch(error => status('player-status', error.message, true));
    return;
  }
  const next = adjacentTrack(1, true);
  if (next) void selectTrack(next);
}
function syncLoading() {
  $('timeline').classList.toggle('is-loading', loading);
  $('timeline').setAttribute('aria-busy', String(loading));
}
function applySettings() {
  document.body.classList.toggle('show-debug', $('show-debug').checked);
  $('channel-panel').hidden = !$('show-channels').checked || !info || info.channels < 2;
  try { localStorage.setItem('xiv-player-display', JSON.stringify({ channels: $('show-channels').checked, debug: $('show-debug').checked })); } catch {}
  renderTracks();
}
function time(seconds, precise = false) {
  if (!Number.isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60), secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${precise ? '.' + String(Math.floor((seconds % 1) * 100)).padStart(2, '0') : ''}`;
}
function readMetadataCache() {
  try {
    const value = JSON.parse(localStorage.getItem(METADATA_CACHE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function persistMetadataCache() {
  if (cacheWriteTimer) return;
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null;
    try { localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(metadataCache)); } catch { /* Storage can be disabled or full. */ }
  }, 500);
}
function hydrateMetadataCache() {
  for (const track of catalog) {
    const path = track.path.toLowerCase();
    const preset = presetMetadata[path];
    const local = metadataCache[path];
    const cached = local && !local.error ? local : (preset ? summarizeMetadata(preset) : null);
    const coverIds = Array.isArray(preset?.coverTextureIds) ? preset.coverTextureIds : preset?.coverTextureId ? [preset.coverTextureId] : [];
    const coverPaths = Array.isArray(preset?.coverTexturePaths) ? preset.coverTexturePaths : preset?.coverTexturePath ? [preset.coverTexturePath] : coverIds.flatMap(iconTexturePaths);
    track.coverTextureIds = coverIds;
    track.coverTexturePaths = coverPaths;
    track.coverTextureId = coverIds[0] ?? null;
    track.coverTexturePath = coverPaths[0] ?? null;
    track.dungeons = Array.isArray(preset?.dungeons) ? preset.dungeons : [];
    track.uses = Array.isArray(preset?.uses) ? preset.uses : [];
    track.usageByLocale = preset?.usageByLocale && typeof preset.usageByLocale === 'object' ? preset.usageByLocale : {};
    if (!cached) continue;
    track.metadata = { ready: true, ...cached };
    if (cached.codec) track.codec = cached.codec;
  }
}
function readLastTrack() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_TRACK_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
function persistLastTrack(track) {
  if (!track) return;
  try { localStorage.setItem(LAST_TRACK_KEY, JSON.stringify({ id: track.id, kind: track.kind, path: track.path })); } catch {}
}
function findLastTrack() {
  const saved = readLastTrack();
  if (!saved) return null;
  const path = String(saved.path || '').toLowerCase();
  return catalog.find(track => track.available && (!saved.kind || track.kind === saved.kind) && path && track.path.toLowerCase() === path)
    || catalog.find(track => track.available && track.id === saved.id)
    || null;
}
function trackFormat(track) {
  if (!track.available) return t('track.unavailable');
  if (!track.metadata?.ready) return t('track.loading');
  if (track.metadata.error) return track.metadata.codec || t('track.unavailable');
  return track.metadata.codec || track.codec || t('track.unknownFormat');
}
function trackDuration(track) {
  return track.metadata?.ready && Number.isFinite(track.metadata.duration) ? time(track.metadata.duration) : '--:--';
}
function trackResourceSubtitle(track) {
  return track.available ? track.path.split('/').pop().replace('.scd', '') : track.unavailableReason || '-';
}
function trackSubtitle(track) {
  return track.available && !$('show-debug').checked ? trackDisplayDetail(track) : trackResourceSubtitle(track);
}
function trackDisplayDetail(track) {
  if (track?.kind === 'orchestrion') return String(track.description || '').trim() || '-';
  return trackUsage(track, getLanguage());
}
function trackDungeons(track) {
  return [...new Set((Array.isArray(track?.dungeons) ? track.dungeons : [])
    .map(value => String(value).trim()).filter(Boolean))];
}
function renderPlayerDetail() {
  $('description').textContent = selected ? trackDisplayDetail(selected) : t('player.selectTrack');
}
function buildTrackMetadata(track) {
  const metadata = document.createElement('span'); metadata.className = 'track-meta';
  const format = document.createElement('span'); format.className = 'track-format'; format.textContent = trackFormat(track); metadata.append(format);
  const ready = Boolean(track.metadata?.ready && !track.metadata.error);
  const loop = document.createElement('span'); loop.className = 'track-icon loop-icon'; loop.textContent = '↻'; loop.title = ready ? (track.metadata.hasLoop ? t('track.hasLoop') : t('track.noLoop')) : t('track.loopLoading'); loop.setAttribute('role', 'img'); loop.setAttribute('aria-label', loop.title); loop.classList.toggle('active', Boolean(ready && track.metadata.hasLoop)); metadata.append(loop);
  const variant = document.createElement('span'); variant.className = 'track-icon variant-icon'; setIcon(variant, 'variant'); variant.title = ready ? (track.metadata.hasVariant ? t('track.hasVariant') : t('track.noVariant')) : t('track.variantLoading'); variant.setAttribute('role', 'img'); variant.setAttribute('aria-label', variant.title); variant.classList.toggle('active', Boolean(ready && track.metadata.hasVariant)); metadata.append(variant);
  return metadata;
}
function updateTrackRow(track) {
  const row = trackRows.get(track.id);
  if (!row) return;
  row.querySelector('.track-meta')?.replaceWith(buildTrackMetadata(track));
  const subtitle = row.querySelector('.track-subtitle');
  if (subtitle) {
    const value = trackSubtitle(track);
    subtitle.textContent = value;
    subtitle.title = value;
  }
  const duration = row.querySelector('.track-duration');
  if (duration) duration.textContent = trackDuration(track);
}
function applyTrackMetadata(path, parsed, error = false) {
  const key = path.toLowerCase();
  const metadata = { ...summarizeMetadata(parsed), error };
  if (!error) metadataCache[key] = { error: metadata.error, duration: metadata.duration, hasLoop: metadata.hasLoop, hasVariant: metadata.hasVariant, codec: metadata.codec, channels: metadata.channels };
  persistMetadataCache();
  for (const track of catalog) {
    if (track.path.toLowerCase() !== key) continue;
    track.metadata = metadata;
    if (parsed.codec) track.codec = parsed.codec;
    updateTrackRow(track);
  }
  if (!filteredRenderTimer && (featureFilters.size || (!$('show-debug').checked && (metadata.error || metadata.codec === '空资源')))) filteredRenderTimer = setTimeout(() => { filteredRenderTimer = null; renderTracks(); }, 120);
}
function startMetadataScan(kind = filter) {
  if (loading) return;
  const scan = ++metadataScanId;
  const pendingPaths = [...new Set(catalog
    .filter(track => track.available && !track.metadata?.ready)
    .sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind))
    .map(track => track.path))];
  if (!pendingPaths.length) { status('library-status', ''); return; }
  (async () => {
    for (let index = 0; index < pendingPaths.length; index++) {
      if (scan !== metadataScanId) return;
      const path = pendingPaths[index];
      try {
        const parsed = await request('metadata', { path });
        if (scan !== metadataScanId) return;
        applyTrackMetadata(path, parsed);
      } catch {
        if (scan !== metadataScanId) return;
        applyTrackMetadata(path, {}, true);
      }
      if (scan === metadataScanId) status('library-status', t('library.scanning', { current: index + 1, total: pendingPaths.length }));
    }
    if (scan === metadataScanId) status('library-status', '');
  })().catch(error => {
    if (scan === metadataScanId) status('library-status', error.message || t('library.scanError'), true);
  });
}
function renderTracks() {
  const filtered = visibleTracks();
  const fragment = document.createDocumentFragment();
  trackRows = new Map();
  const bgmPositions = filter === 'bgm' ? bgmOrderMap() : null;
  let previousGroup = null;
  for (const [index, track] of filtered.entries()) {
    let group = null;
    if (filter === 'bgm') {
      group = bgmGroupAt(bgmPositions.get(track.id) || index + 1);
      if (group.key !== previousGroup) {
        const heading = document.createElement('h2');
        heading.className = 'track-group-heading';
        const toggle = document.createElement('button');
        const collapsed = collapsedBgmGroups.has(group.key);
        const label = t(group.label);
        toggle.type = 'button'; toggle.className = 'track-group-toggle';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? t('library.expandGroup', { label }) : t('library.collapseGroup', { label }));
        toggle.title = toggle.getAttribute('aria-label');
        const text = document.createElement('span'); text.textContent = label;
        const caret = document.createElement('span'); caret.className = 'track-group-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = collapsed ? '▸' : '▾';
        toggle.append(text, caret);
        toggle.addEventListener('click', () => { if (collapsedBgmGroups.has(group.key)) collapsedBgmGroups.delete(group.key); else collapsedBgmGroups.add(group.key); renderTracks(); });
        heading.append(toggle); fragment.append(heading);
        previousGroup = group.key;
      }
      if (collapsedBgmGroups.has(group.key)) continue;
    }
    const button = document.createElement('button');
    button.className = 'track'; button.classList.toggle('selected', selected?.id === track.id);
    button.setAttribute('aria-pressed', String(selected?.id === track.id)); button.disabled = opening || !track.available;
    const number = document.createElement('span'); number.className = 'track-index'; number.textContent = String(index + 1);
    const content = document.createElement('span'); content.className = 'track-content';
    const displayTitle = trackTitle(track, getLanguage());
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = displayTitle; name.title = displayTitle;
    const subtitle = document.createElement('span'); subtitle.className = 'track-subtitle';
    subtitle.textContent = trackSubtitle(track);
    subtitle.title = subtitle.textContent;
    const metadata = buildTrackMetadata(track);
    content.append(name, subtitle);
    const summary = document.createElement('span'); summary.className = 'track-summary';
    const badge = document.createElement('span'); badge.className = 'track-tag track-duration'; badge.textContent = trackDuration(track);
    summary.append(badge, metadata); button.append(number, content, summary);
    button.addEventListener('click', () => selectTrack(track)); fragment.append(button); trackRows.set(track.id, button);
  }
  if (!filtered.length) {
    const empty = document.createElement('div'); empty.className = 'empty library-empty';
    const message = document.createElement('p'); message.textContent = catalog.length ? t('library.noMatch') : t('library.empty'); empty.append(message);
    if (!catalog.length) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button library-empty-action'; button.textContent = t('library.chooseDirectory'); button.title = t('library.chooseDirectory'); button.disabled = opening || !window.showDirectoryPicker || !window.isSecureContext;
      button.addEventListener('click', chooseDirectory); empty.append(button);
    }
    fragment.append(empty);
  }
  $('tracks').replaceChildren(fragment);
  $('track-count').textContent = catalog.length ? t('library.trackCount', { count: filtered.length }) : t('library.notLoaded');
  updateNavigationControls();
}
async function openDirectory(directory) {
  opening = true; $('directory-select').disabled = true;
  metadataScanId++;
  selection++; player.clear(); selected = null; info = null; duration = 0; loading = false; resetShuffleQueue();
  resetTrack(); renderTracks();
  const result = await request('open', { directory }, message => status('library-status', message));
  presetMetadata = await presetReady;
  catalog = result.tracks.map(cleanTrackTitles); hydrateMetadataCache(); $('search').disabled = false;
  const restoredTrack = restoreLastTrackOnOpen ? findLastTrack() : null;
  restoreLastTrackOnOpen = false;
  libraryLabel = `${directory.name} · ${result.repositories.join(languageSeparator())}`;
  $('directory-path').textContent = libraryLabel;
  $('directory-path').title = t('directory.selectedTitle', { label: libraryLabel });
  status('library-status', '');
  startMetadataScan(filter);
  return restoredTrack;
}
async function openDirectoryAndRestore(directory) {
  const restoredTrack = await openDirectory(directory);
  if (!restoredTrack) return;
  if (filter !== restoredTrack.kind) {
    filter = restoredTrack.kind;
    document.querySelectorAll('[data-kind]').forEach(button => {
      const active = button.dataset.kind === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateFilterToggle();
    renderTracks();
    $('tracks').scrollTop = 0;
    startMetadataScan(filter);
  }
  await selectTrack(restoredTrack, true, false);
}
async function chooseDirectory() {
  if (opening) return;
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read', id: 'xiv-sqpack' });
    lastDirectoryHandle = directory;
    try { await saveDirectoryHandle(directory); } catch { /* IndexedDB can be unavailable in private browsing. */ }
    await openDirectoryAndRestore(directory);
  } catch (error) {
    if (error.name !== 'AbortError') status('library-status', error.message, true);
  } finally { opening = false; $('directory-select').disabled = !window.showDirectoryPicker; renderTracks(); }
}
function renderTrackInfo() {
  const track = selected;
  const hasInfo = Boolean(track && info);
  $('info-category').textContent = track ? trackCategory(track) : 'FINAL FANTASY XIV';
  $('info-title').textContent = track ? trackTitle(track, getLanguage()) : t('info.title');
  $('info-description').textContent = track?.description || (hasInfo ? t('player.localResource') : t('info.description'));
  const rows = hasInfo ? [
    [t('info.duration'), time(duration)],
    [t('info.format'), info.codec || track.codec || t('track.unknownFormat')],
    [t('info.channelLabel'), t('info.channels', { count: info.channels }) + (info.channels === 6 ? t('info.stereoTracks') : '')],
    [t('info.loop'), info.loop ? `${time(info.loop.start / info.sampleRate, true)} — ${time(info.loop.end / info.sampleRate, true)}` : t('info.loopNone')],
    [t('info.variant'), info.channels === 6 ? t('info.variantSupported') : t('info.loopNone')],
  ] : [];
  const usage = trackUsage(track, getLanguage());
  const dungeons = trackDungeons(track);
  if (hasInfo && usage !== '-') rows.push([t('info.usage'), usage]);
  if (hasInfo && dungeons.length) rows.push([t('info.dungeons'), dungeons.join(languageSeparator())]);
  const fragment = document.createDocumentFragment();
  for (const [key, value] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; fragment.append(dt, dd); }
  $('info-summary').replaceChildren(fragment);
}
function updateInfoToggle() {
  const panel = $('track-info-panel');
  $('info-toggle').setAttribute('aria-expanded', String(!panel.hidden));
}
function setInfoPanelOpen(open) {
  $('track-info-panel').hidden = !open || !selected;
  updateInfoToggle();
}
function resetTrack() {
  lastVariant = null;
  coverRequestId++;
  $('cover').classList.toggle('is-changing', Boolean(selected));
  if (coverObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(coverObjectUrl);
  coverObjectUrl = null; $('cover').style.removeProperty('background-image'); $('cover').classList.remove('has-image');
  if (!selected) setInfoPanelOpen(false);
  $('cover').dataset.textureId = String(selected?.coverTextureId ?? '');
  $('cover').dataset.texturePath = selected?.coverTexturePath ?? '';
  $('cover').setAttribute('aria-label', selected ? t('cover.track', { title: trackTitle(selected, getLanguage()) }) : t('cover.default'));
  syncLoading();
  $('title').textContent = selected ? trackTitle(selected, getLanguage()) : t('player.continue');
  renderPlayerDetail();
  $('codec').textContent = t('info.localPlayback'); $('loop-band').hidden = true; $('marks').replaceChildren();
  $('loop-range').textContent = t('loop.rangeSelect'); $('track-details').hidden = true;
  $('play').disabled = true; $('info-toggle').disabled = true; $('seek').disabled = true;
  $('channel-panel').hidden = true; $('channel-presets').replaceChildren(); $('channel-buttons').replaceChildren(); channelSelection = null; autoVariant = false;
  $('variant-toggle').hidden = false; $('variant-toggle').disabled = true; $('variant-status').textContent = '';
  renderTrackInfo(); updateNavigationControls();
  renderState({ position: 0, pass: 1, playing: false, finished: false });
}
async function selectTrack(track, allowWhileOpening = false, autoplay = true) {
  if ((opening && !allowWhileOpening) || !track.available) return;
  persistLastTrack(track);
  recordShuffleSelection(track);
  const current = ++selection;
  metadataScanId++;
  finishHandledTrackId = null;
  const titleTransition = beginTrackTransition();
  $('cover').classList.add('is-changing');
  player.clear(); selected = track; info = null; duration = 0; loading = true;
  syncLoading();
  renderTracks(); scrollSelectedTrackIntoView(); status('player-status', t('status.decode'));
  // Resume must be requested while the original click has user activation.
  const activated = player.activate();
  activated.catch(() => {});
  const transitionToken = await titleTransition;
  if (current !== selection) return;
  resetTrack(); finishTrackTransition(transitionToken);
  const task = decodeQueue.then(async () => {
    await activated;
    if (current === selection) await loadSelected(track, current, autoplay);
  });
  decodeQueue = task.catch(() => {});
  try { await task; }
  catch (error) { if (current === selection) { loading = false; finishCoverTransition(); status('player-status', error.message, true); } }
  finally { if (current === selection) { syncLoading(); renderState(player.state); startMetadataScan(filter); } }
}
async function loadSelected(track, current, autoplay = true) {
  const parsed = await request('track', { path: track.path });
  if (current !== selection) return;
  track.codec = parsed.codec;
  applyTrackMetadata(track.path, parsed);
  if (!parsed.supported) { loading = false; finishCoverTransition(); $('codec').textContent = parsed.codec; $('loop-status').textContent = t('status.unsupported'); status('player-status', parsed.reason, true); renderTracks(); return; }
  const loaded = await player.load(parsed, () => current === selection);
  if (!loaded || current !== selection) return;
  info = parsed; delete info.ogg; delete info.hca; delete info.pcmChannels; delete info.hcaHeader; duration = loaded.duration; loading = false; syncLoading(); renderTrackInfo();
  $('codec').textContent = `${parsed.codec} · ${t('info.channels', { count: parsed.channels })}`;
  $('seek').max = String(duration); $('seek').disabled = false; $('play').disabled = false; $('info-toggle').disabled = false;
  renderChannels(info.channels);
  autoVariant = info.channels === 6 && player.variantMode;
  channelSelection = autoVariant ? [0, 2] : null; updateChannelSelectionButtons(); updateVariantControls(player.state);
  if (info.loop) {
    const start = info.loop.start / info.sampleRate, end = info.loop.end / info.sampleRate;
    $('loop-band').hidden = false; $('loop-band').style.left = `${start / duration * 100}%`; $('loop-band').style.width = `${(end - start) / duration * 100}%`;
    $('loop-range').textContent = `${time(start, true)} — ${time(end, true)}`;
  } else $('loop-range').textContent = t('loop.rangeNone');
  const marks = document.createDocumentFragment();
  for (const sample of info.marks) { const mark = document.createElement('span'); mark.className = 'mark'; mark.style.left = `${Math.min(100, sample / info.sampleRate / duration * 100)}%`; marks.append(mark); }
  $('marks').replaceChildren(marks);
  const metadata = [[t('info.path'), track.path], [t('info.channelLabel'), `${t('info.channels', { count: info.channels })}${info.channels === 6 ? t('info.stereoTracks') : ''}`], [t('info.sampleRate'), `${info.sampleRate.toLocaleString()} Hz`], [t('info.loopSource'), info.loopSource || t('info.loopNone')], [t('info.loopPoints'), info.loop ? `${info.loop.start} — ${info.loop.end}` : t('info.loopNone')], [t('info.markCount'), String(info.marks.length)]];
  const fragment = document.createDocumentFragment();
  for (const [key, value] of metadata) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; fragment.append(dt, dd); }
  $('metadata').replaceChildren(fragment); $('track-details').hidden = false;
  status('player-status', autoVariant ? t('info.variantStatus') : info.loop ? t('info.loopStatus') : t('info.noLoopStatus'));
  status('player-status', ''); applySettings();
  renderState(player.state);
  if (autoplay) await player.play();
  void loadCover(track, current);
}
async function loadCover(track, current) {
  const requestToken = ++coverRequestId;
  const paths = [...new Set((track.coverTexturePaths?.length ? track.coverTexturePaths : (track.coverTextureIds || []).flatMap(iconTexturePaths)).filter(Boolean))];
  for (const path of paths) {
    try {
      const image = await request('texture', { path });
      if (current !== selection || requestToken !== coverRequestId || selected !== track) return;
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (current !== selection || requestToken !== coverRequestId || selected !== track) return;
      const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
      if (coverObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = url; $('cover').style.backgroundImage = `url("${url}")`; $('cover').classList.add('has-image'); $('cover').setAttribute('aria-label', t('cover.dungeon', { title: trackTitle(track, getLanguage()) })); finishCoverTransition();
      return;
    } catch { /* Missing or unsupported textures fall back to the built-in cover. */ }
  }
  finishCoverTransition();
}
function channelName(index, count) {
  const names = count === 6 ? [t('channel.variantOneLeft'), t('channel.variantTwoLeft'), t('channel.variantOneRight'), t('channel.transitionLeft'), t('channel.variantTwoRight'), t('channel.transitionRight')] : count === 2 ? [t('channel.left'), t('channel.right')] : Array.from({ length: count }, (_, i) => t('channel.number', { number: i + 1 }));
  return names[index] || t('channel.number', { number: index + 1 });
}
function renderChannels(count) {
  if (count < 2) { $('channel-panel').hidden = true; return; }
  $('channel-panel').hidden = !$('show-channels').checked; $('channel-help').textContent = count === 6 ? t('channel.helpSix') : t('channel.helpMany', { count });
  const presets = document.createDocumentFragment();
  if (count === 6) {
    const definitions = [
      [t('channel.variantOne'), [0, 2]],
      [t('channel.variantTwo'), [1, 4]],
      [t('channel.transition'), [3, 5]],
    ];
    for (const [label, channels] of definitions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'channel-button'; button.textContent = label; button.dataset.channels = channels.join(','); button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => setAudioSelection(channels, label, 'pair')); presets.append(button);
    }
  }
  $('channel-presets').replaceChildren(presets);
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index++) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'channel-button'; button.textContent = channelName(index, count); button.dataset.channels = String(index); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setAudioSelection([index], channelName(index, count))); fragment.append(button);
  }
  $('channel-buttons').replaceChildren(fragment); updateChannelSelectionButtons();
}
function updateChannelSelectionButtons() {
  const selected = channelSelection?.join(',') || '';
  $('channel-all').classList.toggle('active', !channelSelection); $('channel-all').setAttribute('aria-pressed', String(!channelSelection));
  document.querySelectorAll('[data-channels]').forEach(button => { const active = button.dataset.channels === selected; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function updateVariantControls(state = player.state) {
  const enabled = Boolean(autoVariant && info?.channels === 6 && player.variantMode);
  const button = $('variant-toggle'); button.hidden = false; button.disabled = !enabled || loading;
  button.classList.toggle('pending', enabled && Number.isInteger(state.variantPending));
  if (!enabled) {
    $('variant-status').textContent = '';
    button.title = t('variant.disabled'); button.setAttribute('aria-label', t('variant.switch')); lastVariant = null;
    return;
  }
  const variant = Number.isInteger(state.variant) ? state.variant : 0;
  const selected = variant === 0 ? [0, 2] : [1, 4];
  if (channelSelection?.join(',') !== selected.join(',')) { channelSelection = selected; updateChannelSelectionButtons(); }
  button.title = t('variant.to', { variant: variant === 0 ? 2 : 1 });
  button.setAttribute('aria-label', button.title);
  if (lastVariant !== null && lastVariant !== variant && !loading && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('timeline').querySelector('.switch-flash').animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }], { duration: 600 });
  }
  lastVariant = variant;
  const pending = Number.isInteger(state.variantPending);
  $('variant-status').textContent = pending ? t('variant.pending', { variant: variant + 1 }) : state.variantTransition ? t('variant.transition', { variant: variant + 1 }) : t('variant.label', { variant: variant + 1 });
}
function setAudioSelection(channels, label = '', mode = 'mono') {
  if (!info) throw new Error(t('status.selectTrack'));
  const normalized = channels === null ? null : [...new Set(channels)].filter(channel => Number.isInteger(channel));
  if (normalized && (!normalized.length || normalized.some(channel => channel < 0 || channel >= info.channels))) throw new Error(t('status.invalidChannels'));
  autoVariant = false; channelSelection = normalized; player.setChannelSelection(normalized, mode); updateChannelSelectionButtons(); updateVariantControls();
  const value = label || normalized?.map(channel => channelName(channel, info.channels)).join(' + ');
  status('player-status', normalized ? t(mode === 'pair' ? 'status.pairListening' : 'status.soloListening', { label: value }) : t('status.fullMix'));
}
function renderState(state) {
  const stateKey = JSON.stringify([state.position, state.pass, state.playing, state.finished, state.loopExited, state.variant, state.variantPending, state.variantTransition, duration, loading, player.limit, info?.codec, info?.channels, info?.sampleRate, info?.loop?.start, info?.loop?.end, autoVariant, player.variantMode, selected?.id, playbackMode, opening, getLanguage()]);
  if (stateKey === lastRenderStateKey) return;
  lastRenderStateKey = stateKey;
  if (!dragging) { $('seek').value = String(state.position); $('played').style.width = `${duration ? Math.min(100, state.position / duration * 100) : 0}%`; }
  $('position-current').textContent = time(dragging ? Number($('seek').value) : state.position);
  $('position-total').textContent = time(duration);
  const playable = Boolean(info && !loading);
  $('play').disabled = !playable; $('info-toggle').disabled = !playable; updateInfoToggle();
  const playLabel = state.playing ? t('player.pause') : state.finished ? t('player.replay') : t('player.play');
  $('play').title = playLabel; $('play').setAttribute('aria-label', playLabel);
  setIcon($('play'), state.playing ? 'pause' : 'play');
  $('loop-toggle').disabled = !info?.loop || loading;
  const looping = Boolean(info?.loop && player.limit !== 1);
  $('loop-toggle').classList.toggle('active', looping);
  const loopValue = player.limit === Infinity ? t('loop.infinite') : player.limit === 1 ? t('loop.off') : `${player.limit} ${t('loop.limitSuffix')}`;
  $('loop-toggle').title = info?.loop ? t('loop.toggle', { value: loopValue }) : t('loop.unavailable');
  syncLoading();
  if (!info) $('loop-status').textContent = loading ? t('loop.loading') : t('loop.waiting');
  else if (!info.loop) $('loop-status').textContent = t('loop.none');
  else if (state.finished) $('loop-status').textContent = t('loop.finished');
  else if (state.loopExited) $('loop-status').textContent = t('loop.exited');
  else if (state.position < info.loop.start / info.sampleRate) $('loop-status').textContent = t('loop.before');
  else $('loop-status').textContent = t('loop.pass', { pass: state.pass, limit: player.limit === Infinity ? '∞' : player.limit });
  if (!info || !info.loop) $('loop-status').textContent = '';
  else if (player.limit === 1) $('loop-status').textContent = t('loop.closed');
  updateVariantControls(state);
  updateNavigationControls();
}
function configureLoop(mode, limit) {
  if (!['off', 'finite', 'infinite'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 999) throw new Error(t('loop.limitError'));
  $('loop-mode').value = mode; $('loop-limit').value = String(limit); $('limit-label').hidden = mode !== 'finite';
  player.setLimit(mode === 'off' ? 1 : mode === 'infinite' ? Infinity : limit); renderState(player.state); persistPreferences();
}
document.querySelectorAll('[data-icon]').forEach(element => setIcon(element, element.dataset.icon));
updatePlaybackOrder();
document.querySelectorAll('#language-menu [data-language]').forEach(button => button.addEventListener('click', () => { setLanguage(button.dataset.language); applyLanguage(); $('language-menu').hidePopover?.(); }));
$('settings-open').addEventListener('click', () => $('settings-menu').showModal());
$('settings-close').addEventListener('click', () => $('settings-menu').close());
$('settings-menu').addEventListener('click', event => { if (event.target === $('settings-menu')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('info-toggle').addEventListener('click', () => { if (!info || loading) return; setInfoPanelOpen($('track-info-panel').hidden); renderTrackInfo(); });
for (const id of ['show-channels', 'show-debug']) $(id).addEventListener('change', applySettings);
try { const saved = JSON.parse(localStorage.getItem('xiv-player-display')); $('show-channels').checked = Boolean(saved?.channels); $('show-debug').checked = Boolean(saved?.debug); } catch {}
document.body.classList.toggle('show-debug', $('show-debug').checked);
$('directory-select').addEventListener('click', chooseDirectory);
function setDragActive(active) { document.body.classList.toggle('drag-active', active); }
async function handleDirectoryDrop(event) {
  event.preventDefault(); setDragActive(false);
  const item = [...(event.dataTransfer?.items || [])].find(entry => entry.kind === 'file');
  if (!item) return;
  let handle = null;
  try { if (item.getAsFileSystemHandle) handle = await item.getAsFileSystemHandle(); } catch { /* The browser may reject a dropped handle. */ }
  if (handle?.kind !== 'directory') {
    const file = item.getAsFile?.();
    const name = file?.name?.toLowerCase() || '';
    status('library-status', name.endsWith('.lnk') || name.endsWith('.url') ? t('status.noShortcutPermission') : t('status.dropFolder'), true);
    return;
  }
  try {
    if (handle.requestPermission && await handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error(t('status.permissionDenied'));
    lastDirectoryHandle = handle;
    try { await saveDirectoryHandle(handle); } catch { /* IndexedDB can be unavailable in private browsing. */ }
    await openDirectoryAndRestore(handle);
  } catch (error) { status('library-status', error.message, true); }
  finally { opening = false; $('directory-select').disabled = !window.showDirectoryPicker; renderTracks(); }
}
document.addEventListener('dragover', event => {
  if ([...(event.dataTransfer?.items || [])].some(item => item.kind === 'file')) { event.preventDefault(); setDragActive(true); }
});
document.addEventListener('dragleave', event => { if (event.relatedTarget === null) setDragActive(false); });
document.addEventListener('drop', event => { void handleDirectoryDrop(event); });
$('search').addEventListener('input', renderTracks);
document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  updateFilterToggle(); renderTracks(); $('tracks').scrollTop = 0; startMetadataScan(filter);
}));
document.querySelectorAll('[data-feature]').forEach(button => button.addEventListener('click', () => {
  const feature = button.dataset.feature;
  if (featureFilters.has(feature)) featureFilters.delete(feature); else featureFilters.add(feature);
  button.classList.toggle('active', featureFilters.has(feature)); button.setAttribute('aria-pressed', String(featureFilters.has(feature)));
  updateFilterToggle(); renderTracks(); $('tracks').scrollTop = 0;
}));
function positionFilterMenu() {
  const button = $('filter-toggle'), menu = $('filter-menu');
  const box = button.getBoundingClientRect();
  const width = Math.min(menu.getBoundingClientRect().width || 150, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, box.right - width));
  menu.style.left = `${left}px`;
  menu.style.top = `${box.bottom + 8}px`;
}
$('filter-toggle').addEventListener('click', () => requestAnimationFrame(positionFilterMenu));
$('filter-menu').addEventListener('toggle', event => {
  $('filter-toggle').setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'open') requestAnimationFrame(positionFilterMenu);
});
window.addEventListener('resize', () => { if ($('filter-menu').matches(':popover-open')) positionFilterMenu(); });
$('play').addEventListener('click', () => { player.togglePlayback().catch(e => status('player-status', e.message, true)); });
$('previous').addEventListener('click', () => { const track = adjacentTrack(-1); if (track) void selectTrack(track); });
$('next').addEventListener('click', () => { const track = adjacentTrack(1); if (track) void selectTrack(track); });
$('playback-order').addEventListener('click', () => {
  const index = PLAYBACK_ORDERS.findIndex(order => order.mode === playbackMode);
  setPlaybackMode(PLAYBACK_ORDERS[(index + 1) % PLAYBACK_ORDERS.length].mode);
});
$('seek').addEventListener('input', () => { dragging = true; renderState(player.state); $('played').style.width = `${Number($('seek').value) / duration * 100}%`; });
$('seek').addEventListener('change', () => { dragging = false; player.seek(Number($('seek').value)); });
$('volume').addEventListener('input', () => { player.setVolume(Number($('volume').value)); updateVolumeControl(); persistPreferences(); });
$('channel-all').addEventListener('click', () => setAudioSelection(null));
$('variant-toggle').addEventListener('click', () => {
  if (!player.requestVariantToggle()) return;
  const currentVariant = Number.isInteger(player.state.variant) ? player.state.variant + 1 : 1;
  $('variant-status').textContent = t('variant.waiting', { variant: currentVariant });
});
for (const id of ['loop-mode', 'loop-limit']) $(id).addEventListener('change', () => {
  if (!$('loop-limit').checkValidity()) { $('loop-limit').reportValidity(); return; }
  configureLoop($('loop-mode').value, Number($('loop-limit').value));
});
try {
  const saved = JSON.parse(localStorage.getItem('xiv-player-preferences'));
  if (saved) {
    if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) { player.setVolume(saved.volume); $('volume').value = String(saved.volume); }
    if (['off', 'finite', 'infinite'].includes(saved.mode) && Number.isInteger(saved.limit) && saved.limit >= 1 && saved.limit <= 999) configureLoop(saved.mode, saved.limit);
    if (PLAYBACK_ORDERS.some(order => order.mode === saved.playbackMode)) { playbackMode = saved.playbackMode; updatePlaybackOrder(); }
  }
} catch { /* Invalid preferences leave defaults intact. */ }
$('volume').value = String(player.volume);
try { localStorage.removeItem('xiv-player-playback-positions-v1'); } catch {}
if (!window.showDirectoryPicker || !window.isSecureContext) { $('directory-select').disabled = true; status('library-status', t('status.secureContext'), true); }
applyLanguage();
async function restoreDirectory() {
  if (!window.showDirectoryPicker || !window.isSecureContext) return;
  try {
    const handle = await loadDirectoryHandle();
    if (!handle) return;
    lastDirectoryHandle = handle;
    if (await directoryPermission(handle) === 'granted') {
      await openDirectoryAndRestore(handle);
    } else {
      $('directory-path').textContent = t('settings.needsPermission', { name: handle.name });
      $('directory-path').title = t('settings.permissionHint');
      status('library-status', t('settings.remembered', { name: handle.name }));
    }
  } catch { /* A stale handle is harmless; the next explicit directory choice replaces it. */ }
  finally { opening = false; $('directory-select').disabled = !window.showDirectoryPicker; renderTracks(); }
}
void restoreDirectory();

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    { name: 'get_player_state', title: t('mcp.readState'), description: t('mcp.readStateDescription'), inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ track: selected?.title || null, ...player.state, loopMode: player.limit === Infinity ? 'infinite' : 'finite', limit: Number.isFinite(player.limit) ? player.limit : null }) },
    { name: 'set_loop_playback', title: t('mcp.setLoop'), description: t('mcp.setLoopDescription'), inputSchema: { type: 'object', properties: { mode: { enum: ['off', 'finite', 'infinite'] }, limit: { type: 'integer', minimum: 1, maximum: 999 } }, required: ['mode', 'limit'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { configureLoop(input.mode, input.limit); return { mode: input.mode, limit: input.limit }; } },
    { name: 'set_audio_channel', title: t('mcp.setChannel'), description: t('mcp.setChannelDescription'), inputSchema: { type: 'object', properties: { channel: { type: 'integer', minimum: -1, maximum: 7 } }, required: ['channel'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { setAudioSelection(input.channel < 0 ? null : [input.channel]); return { channel: input.channel, mode: input.channel < 0 ? 'all' : 'solo' }; } },
    { name: 'set_audio_variant', title: t('mcp.setVariant'), description: t('mcp.setVariantDescription'), inputSchema: { type: 'object', properties: { variant: { enum: ['all', 'one', 'two', 'transition'] } }, required: ['variant'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { const groups = { all: null, one: [0, 2], two: [1, 4], transition: [3, 5] }; if (groups[input.variant] && (!info || info.channels !== 6)) throw new Error(t('status.variantSixOnly')); setAudioSelection(groups[input.variant], input.variant, 'pair'); return { variant: input.variant, channels: groups[input.variant] }; } },
  ];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional API. */ } }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
