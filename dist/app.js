import { Player } from './lib/player.js';
import { cleanTitle, summarizeMetadata, setIcon } from './lib/presentation.js';
import { directoryPermission, loadDirectoryHandle, saveDirectoryHandle } from './lib/directory-store.js';

const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./catalog-worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let requestId = 0, catalog = [], filter = 'orchestrion', featureFilters = new Set(), selected = null, info = null, duration = 0, selection = 0, dragging = false, channelSelection = null, autoVariant = false;
let libraryLabel = '', metadataScanId = 0, trackRows = new Map(), lastDirectoryHandle = null;
let opening = false, loading = false, decodeQueue = Promise.resolve();
const METADATA_CACHE_KEY = 'xiv-player-track-metadata-v2';
let metadataCache = readMetadataCache(), cacheWriteTimer = null;
const POSITION_CACHE_KEY = 'xiv-player-playback-positions-v1';
let positionCache = readPositionCache(), positionWriteTimer = null;
let lastVariant = null, filteredRenderTimer = null;
const presetReady = fetch(new URL('./data/track-metadata.json', import.meta.url))
  .then(response => { if (!response.ok) throw new Error('Metadata unavailable'); return response.json(); })
  .then(data => data.schemaVersion === 1 ? data.tracks : {}).catch(() => ({}));
let presetMetadata = {};
const player = new Player(renderState, message => status('player-status', message, true));

worker.onmessage = ({ data }) => {
  const entry = pending.get(data.id);
  if (!entry) return;
  if (data.type === 'progress') { entry.progress?.(data.message); return; }
  pending.delete(data.id);
  if (data.type === 'error') entry.reject(new Error(data.message)); else entry.resolve(data.result);
};
worker.onerror = () => {
  for (const entry of pending.values()) entry.reject(new Error('资源读取程序异常，请刷新网页重试。'));
  pending.clear(); status('library-status', '资源读取程序异常，请刷新网页重试。', true);
};
function request(type, payload = {}, progress) {
  return new Promise((resolve, reject) => {
    const id = ++requestId; pending.set(id, { resolve, reject, progress });
    worker.postMessage({ id, type, ...payload });
  });
}
function status(id, message, error = false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
function syncLoading() {
  $('timeline').classList.toggle('is-loading', loading);
  $('timeline').setAttribute('aria-busy', String(loading));
  $('playback-label').textContent = loading ? '正在载入…' : '播放进度';
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
function readPositionCache() {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_CACHE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function persistPositionCache() {
  if (positionWriteTimer) return;
  positionWriteTimer = setTimeout(() => {
    positionWriteTimer = null;
    try { localStorage.setItem(POSITION_CACHE_KEY, JSON.stringify(positionCache)); } catch { /* Storage can be disabled or full. */ }
  }, 400);
}
function savePlaybackPosition() {
  if (!selected || !info || loading || !Number.isFinite(player.state.position) || player.state.position <= 0) return;
  positionCache[selected.path.toLowerCase()] = { position: player.state.position, pass: player.state.pass };
  persistPositionCache();
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
    track.coverTextureId = preset?.coverTextureId ?? null;
    track.coverTexturePath = preset?.coverTexturePath ?? null;
    if (!cached) continue;
    track.metadata = { ready: true, ...cached };
    if (cached.codec) track.codec = cached.codec;
  }
}
function trackFormat(track) {
  if (!track.available) return '不可用';
  if (!track.metadata?.ready) return '读取中…';
  if (track.metadata.error) return track.metadata.codec || '不可用';
  return track.metadata.codec || track.codec || '未知格式';
}
function trackDuration(track) {
  return track.metadata?.ready && Number.isFinite(track.metadata.duration) ? time(track.metadata.duration) : '--:--';
}
function buildTrackMetadata(track) {
  const metadata = document.createElement('span'); metadata.className = 'track-meta';
  const format = document.createElement('span'); format.className = 'track-format'; format.textContent = trackFormat(track); metadata.append(format);
  const ready = Boolean(track.metadata?.ready && !track.metadata.error);
  const loop = document.createElement('span'); loop.className = 'track-icon loop-icon'; loop.textContent = '↻'; loop.title = ready ? (track.metadata.hasLoop ? '有循环' : '无循环') : '循环信息读取中'; loop.setAttribute('role', 'img'); loop.setAttribute('aria-label', loop.title); loop.classList.toggle('active', Boolean(ready && track.metadata.hasLoop)); metadata.append(loop);
  const variant = document.createElement('span'); variant.className = 'track-icon variant-icon'; variant.textContent = '♬'; variant.title = ready ? (track.metadata.hasVariant ? '有变体' : '无变体') : '变体信息读取中'; variant.setAttribute('role', 'img'); variant.setAttribute('aria-label', variant.title); variant.classList.toggle('active', Boolean(ready && track.metadata.hasVariant)); metadata.append(variant);
  return metadata;
}
function updateTrackRow(track) {
  const row = trackRows.get(track.id);
  if (!row) return;
  row.querySelector('.track-meta')?.replaceWith(buildTrackMetadata(track));
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
  if (featureFilters.size && !filteredRenderTimer) filteredRenderTimer = setTimeout(() => { filteredRenderTimer = null; renderTracks(); }, 120);
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
      if (scan === metadataScanId) status('library-status', `正在补充曲目信息 ${index + 1}/${pendingPaths.length}…`);
    }
    if (scan === metadataScanId) status('library-status', '');
  })().catch(error => {
    if (scan === metadataScanId) status('library-status', error.message || '曲目详情读取失败。', true);
  });
}
function renderTracks() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = catalog.filter(t => t.kind === filter && [...featureFilters].every(feature => t.metadata?.[`has${feature[0].toUpperCase()}${feature.slice(1)}`]) && `${t.title} ${t.path} ${t.rowId}`.toLocaleLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  trackRows = new Map();
  for (const track of filtered) {
    const button = document.createElement('button');
    button.className = 'track'; button.classList.toggle('selected', selected?.id === track.id);
    button.setAttribute('aria-pressed', String(selected?.id === track.id)); button.disabled = opening || !track.available;
    const number = document.createElement('span'); number.className = 'track-index debug-only'; number.textContent = String(track.rowId).padStart(3, '0');
    const content = document.createElement('span'); content.className = 'track-content';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.title; name.title = track.title;
    const subtitle = document.createElement('span'); subtitle.className = 'track-subtitle'; subtitle.textContent = track.available ? (track.kind === 'orchestrion' ? track.path.split('/').pop().replace('.scd', '') : track.path) : track.unavailableReason;
    const resourceSubtitle = subtitle.textContent;
    if (!$('show-debug').checked && track.available) subtitle.textContent = track.kind === 'orchestrion' ? '管弦乐谱' : '游戏配乐';
    subtitle.title = $('show-debug').checked ? resourceSubtitle : subtitle.textContent;
    const metadata = buildTrackMetadata(track);
    content.append(name, subtitle);
    const summary = document.createElement('span'); summary.className = 'track-summary';
    const badge = document.createElement('span'); badge.className = 'track-tag track-duration'; badge.textContent = trackDuration(track);
    summary.append(badge, metadata); button.append(number, content, summary);
    button.addEventListener('click', () => selectTrack(track)); fragment.append(button); trackRows.set(track.id, button);
  }
  if (!filtered.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = catalog.length ? '没有找到匹配的曲目。' : '曲库将在这里显示。'; fragment.append(p); }
  $('tracks').replaceChildren(fragment);
  $('track-count').textContent = catalog.length ? `${filtered.length} 首` : '尚未载入';
}
async function openDirectory(directory) {
  opening = true; $('open-directory').disabled = true;
  metadataScanId++;
  selection++; player.clear(); selected = null; info = null; duration = 0; loading = false;
  resetTrack(); renderTracks();
  const result = await request('open', { directory }, message => status('library-status', message));
  presetMetadata = await presetReady;
  catalog = result.tracks.map(track => ({ ...track, title: cleanTitle(track.title) })); hydrateMetadataCache(); $('search').disabled = false;
  libraryLabel = `${directory.name} · ${result.repositories.join('、')}`;
  $('open-directory').textContent = '重新选择目录';
  status('library-status', '');
  startMetadataScan(filter);
}
async function chooseDirectory() {
  if (opening) return;
  try {
    let directory = lastDirectoryHandle;
    if (!directory || await directoryPermission(directory, true) !== 'granted') directory = await window.showDirectoryPicker({ mode: 'read', id: 'xiv-sqpack' });
    lastDirectoryHandle = directory;
    try { await saveDirectoryHandle(directory); } catch { /* IndexedDB can be unavailable in private browsing. */ }
    await openDirectory(directory);
  } catch (error) {
    if (error.name !== 'AbortError') status('library-status', error.message, true);
  } finally { opening = false; $('open-directory').disabled = !window.showDirectoryPicker; renderTracks(); }
}
function resetTrack() {
  lastVariant = null;
  $('cover').dataset.textureId = String(selected?.coverTextureId ?? '');
  $('cover').dataset.texturePath = selected?.coverTexturePath ?? '';
  $('cover').setAttribute('aria-label', selected ? selected.title + ' · 默认封面' : '默认音乐封面');
  syncLoading();
  $('title').textContent = selected?.title || '让旋律继续';
  $('description').textContent = selected?.description || (selected ? '' : '从曲库选择一首音乐');
  $('track-category').textContent = selected ? (selected.kind === 'orchestrion' ? '管弦乐谱' : '游戏配乐') : 'FINAL FANTASY XIV';
  $('codec').textContent = '本地播放'; $('loop-band').hidden = true; $('marks').replaceChildren();
  $('loop-range').textContent = '选曲后显示'; $('track-details').hidden = true;
  $('play').disabled = true; $('restart').disabled = true; $('seek').disabled = true;
  $('channel-panel').hidden = true; $('channel-presets').replaceChildren(); $('channel-buttons').replaceChildren(); channelSelection = null; autoVariant = false;
  $('variant-toggle').hidden = false; $('variant-toggle').disabled = true; $('variant-status').textContent = '独听会把选中的声道复制到左右声道，方便用耳机检查；默认变体切换会在下一个节点执行。';
  renderState({ position: 0, pass: 1, playing: false, finished: false });
}
async function selectTrack(track) {
  if (opening || !track.available) return;
  const current = ++selection;
  metadataScanId++;
  player.clear(); selected = track; info = null; duration = 0; loading = true;
  resetTrack(); renderTracks(); status('player-status', '正在读取并解码音乐…');
  // Resume must be requested while the original click has user activation.
  const activated = player.activate();
  activated.catch(() => {});
  const task = decodeQueue.then(async () => {
    await activated;
    if (current === selection) await loadSelected(track, current);
  });
  decodeQueue = task.catch(() => {});
  try { await task; }
  catch (error) { if (current === selection) { loading = false; status('player-status', error.message, true); } }
  finally { if (current === selection) { syncLoading(); renderState(player.state); startMetadataScan(filter); } }
}
async function loadSelected(track, current) {
  const parsed = await request('track', { path: track.path });
  if (current !== selection) return;
  track.codec = parsed.codec;
  applyTrackMetadata(track.path, parsed);
  if (!parsed.supported) { loading = false; $('codec').textContent = parsed.codec; $('loop-status').textContent = '此资源暂不能播放'; status('player-status', parsed.reason, true); renderTracks(); return; }
  const loaded = await player.load(parsed, () => current === selection);
  if (!loaded || current !== selection) return;
  info = parsed; delete info.ogg; delete info.hca; delete info.pcmChannels; delete info.hcaHeader; duration = loaded.duration; loading = false; syncLoading();
  $('codec').textContent = `${parsed.codec} · ${parsed.channels} 声道`;
  $('seek').max = String(duration); $('seek').disabled = false; $('play').disabled = false; $('restart').disabled = false;
  renderChannels(info.channels);
  autoVariant = info.channels === 6 && player.variantMode;
  channelSelection = autoVariant ? [0, 2] : null; updateChannelSelectionButtons(); updateVariantControls(player.state);
  if (info.loop) {
    const start = info.loop.start / info.sampleRate, end = info.loop.end / info.sampleRate;
    $('loop-band').hidden = false; $('loop-band').style.left = `${start / duration * 100}%`; $('loop-band').style.width = `${(end - start) / duration * 100}%`;
    $('loop-range').textContent = `${time(start, true)} — ${time(end, true)}`;
  } else $('loop-range').textContent = '无循环区间';
  const marks = document.createDocumentFragment();
  for (const sample of info.marks) { const mark = document.createElement('span'); mark.className = 'mark'; mark.style.left = `${Math.min(100, sample / info.sampleRate / duration * 100)}%`; marks.append(mark); }
  $('marks').replaceChildren(marks);
  const metadata = [['路径', track.path], ['声道', `${info.channels} 声道${info.channels === 6 ? '（3 个立体声轨）' : ''}`], ['采样率', `${info.sampleRate.toLocaleString()} Hz`], ['循环来源', info.loopSource || '无'], ['循环采样点', info.loop ? `${info.loop.start} — ${info.loop.end}` : '无'], ['标记数', String(info.marks.length)]];
  const fragment = document.createDocumentFragment();
  for (const [key, value] of metadata) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; fragment.append(dt, dd); }
  $('metadata').replaceChildren(fragment); $('track-details').hidden = false;
  status('player-status', autoVariant ? '默认播放变体 1；点击“切换变体”会在下一个节点切换，并播放过渡音。' : info.loop ? '金色区域为原始循环区间。拖动可跳转；从头播放会重新计数。' : '这首曲目没有有效循环区间，将完整播放一次。');
  status('player-status', ''); applySettings();
  const saved = positionCache[track.path.toLowerCase()];
  if (saved && Number.isFinite(saved.position) && saved.position > 0 && saved.position < duration - 0.25) player.seek(saved.position, Number.isInteger(saved.pass) ? saved.pass : 1);
  renderState(player.state); await player.play();
}
function channelName(index, count) {
  const names = count === 6 ? ['FL（变体 1 · 左）', 'FR（变体 2 · 左）', 'FC（变体 1 · 右）', 'LFE（过渡 · 左）', 'SL（变体 2 · 右）', 'SR（过渡 · 右）'] : count === 2 ? ['L 左', 'R 右'] : Array.from({ length: count }, (_, i) => `Ch ${i + 1}`);
  return names[index] || `Ch ${index + 1}`;
}
function renderChannels(count) {
  if (count < 2) { $('channel-panel').hidden = true; return; }
  $('channel-panel').hidden = !$('show-channels').checked; $('channel-help').textContent = count === 6 ? '当前资源为 6 声道；预设按三个立体声轨显示，不按 5.1 中置/环绕布局下混。' : `${count} 声道资源`;
  const presets = document.createDocumentFragment();
  if (count === 6) {
    const definitions = [
      ['变体 1 · FL + FC', [0, 2]],
      ['变体 2 · FR + SL', [1, 4]],
      ['过渡强音 · LFE + SR', [3, 5]],
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
    $('variant-badge').textContent = '';
    button.title = '此曲目没有启用变体切换'; lastVariant = null;
    return;
  }
  const variant = Number.isInteger(state.variant) ? state.variant : 0;
  const selected = variant === 0 ? [0, 2] : [1, 4];
  if (channelSelection?.join(',') !== selected.join(',')) { channelSelection = selected; updateChannelSelectionButtons(); }
  button.title = `切换到变体 ${variant === 0 ? '2' : '1'}`;
  button.setAttribute('aria-label', button.title);
  $('variant-badge').textContent = String(variant + 1);
  if (lastVariant !== null && lastVariant !== variant && !loading && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('timeline').querySelector('.switch-flash').animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }], { duration: 600 });
  }
  lastVariant = variant;
  const pending = Number.isInteger(state.variantPending);
  $('variant-status').textContent = pending ? `等待切换 · 变体 ${state.variantPending + 1}` : state.variantTransition ? `变体 ${variant + 1} · 过渡中` : `变体 ${variant + 1}`;
}
function setAudioSelection(channels, label = '', mode = 'mono') {
  if (!info) throw new Error('请先选择曲目。');
  const normalized = channels === null ? null : [...new Set(channels)].filter(channel => Number.isInteger(channel));
  if (normalized && (!normalized.length || normalized.some(channel => channel < 0 || channel >= info.channels))) throw new Error('无效的声道组合。');
  autoVariant = false; channelSelection = normalized; player.setChannelSelection(normalized, mode); updateChannelSelectionButtons(); updateVariantControls();
  status('player-status', normalized ? `${mode === 'pair' ? '正在按立体声轨试听' : '正在独听'} ${label || normalized.map(channel => channelName(channel, info.channels)).join(' + ')}。` : '正在播放完整多声道混音。');
}
function renderState(state) {
  if (!dragging) { $('seek').value = String(state.position); $('played').style.width = `${duration ? Math.min(100, state.position / duration * 100) : 0}%`; }
  $('position-label').textContent = `${time(dragging ? Number($('seek').value) : state.position)} / ${time(duration)}`;
  const playLabel = state.playing ? '暂停' : state.finished ? '重播' : '播放';
  $('play').title = playLabel; $('play').setAttribute('aria-label', playLabel);
  setIcon($('play'), state.playing ? 'pause' : 'play');
  $('loop-toggle').disabled = !info?.loop || loading;
  const looping = Boolean(info?.loop && player.limit !== 1);
  $('loop-toggle').classList.toggle('active', looping);
  $('loop-badge').textContent = looping ? (player.limit === Infinity ? '∞' : String(player.limit)) : '';
  syncLoading();
  if (!info) $('loop-status').textContent = loading ? '正在读取循环信息…' : '等待选择曲目';
  else if (!info.loop) $('loop-status').textContent = '此曲目无循环区间';
  else if (state.finished) $('loop-status').textContent = '播放结束';
  else if (state.loopExited) $('loop-status').textContent = '循环段已结束，继续尾声';
  else if (state.position < info.loop.start / info.sampleRate) $('loop-status').textContent = '前奏 · 即将进入循环段';
  else $('loop-status').textContent = `循环段第 ${state.pass} 遍 / ${player.limit === Infinity ? '∞' : player.limit} 遍`;
  if (!info || !info.loop) $('loop-status').textContent = '';
  else if (player.limit === 1) $('loop-status').textContent = '循环关闭';
  updateVariantControls(state);
  savePlaybackPosition();
}
function configureLoop(mode, limit) {
  if (!['off', 'finite', 'infinite'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 999) throw new Error('循环次数必须是 1～999 的整数。');
  $('loop-mode').value = mode; $('loop-limit').value = String(limit); $('limit-label').hidden = mode !== 'finite';
  player.setLimit(mode === 'off' ? 1 : mode === 'infinite' ? Infinity : limit); renderState(player.state);
  try { localStorage.setItem('xiv-player-preferences', JSON.stringify({ mode, limit, volume: player.volume })); } catch { /* Storage can be disabled. */ }
}
document.querySelectorAll('[data-icon]').forEach(element => setIcon(element, element.dataset.icon));
$('settings-open').addEventListener('click', () => $('settings-menu').showModal());
$('settings-close').addEventListener('click', () => $('settings-menu').close());
$('settings-menu').addEventListener('click', event => { if (event.target === $('settings-menu')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
for (const id of ['show-channels', 'show-debug']) $(id).addEventListener('change', applySettings);
try { const saved = JSON.parse(localStorage.getItem('xiv-player-display')); $('show-channels').checked = Boolean(saved?.channels); $('show-debug').checked = Boolean(saved?.debug); } catch {}
document.body.classList.toggle('show-debug', $('show-debug').checked);
$('open-directory').addEventListener('click', chooseDirectory);
$('search').addEventListener('input', renderTracks);
document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  renderTracks(); $('tracks').scrollTop = 0; startMetadataScan(filter);
}));
document.querySelectorAll('[data-feature]').forEach(button => button.addEventListener('click', () => {
  const feature = button.dataset.feature;
  if (featureFilters.has(feature)) featureFilters.delete(feature); else featureFilters.add(feature);
  button.classList.toggle('active', featureFilters.has(feature)); button.setAttribute('aria-pressed', String(featureFilters.has(feature)));
  renderTracks(); $('tracks').scrollTop = 0;
}));
$('play').addEventListener('click', () => { if (player.state.playing && player.context.state === 'running') player.pause(); else player.play().catch(e => status('player-status', e.message, true)); });
$('restart').addEventListener('click', () => player.restart().catch(e => status('player-status', e.message, true)));
$('seek').addEventListener('input', () => { dragging = true; renderState(player.state); $('played').style.width = `${Number($('seek').value) / duration * 100}%`; });
$('seek').addEventListener('change', () => { dragging = false; player.seek(Number($('seek').value)); });
$('volume').addEventListener('input', () => player.setVolume(Number($('volume').value)));
$('channel-all').addEventListener('click', () => setAudioSelection(null));
$('variant-toggle').addEventListener('click', () => { if (player.requestVariantToggle()) $('variant-status').textContent = '等待下一个切换节点…'; });
for (const id of ['loop-mode', 'loop-limit']) $(id).addEventListener('change', () => {
  if (!$('loop-limit').checkValidity()) { $('loop-limit').reportValidity(); return; }
  configureLoop($('loop-mode').value, Number($('loop-limit').value));
});
try {
  const saved = JSON.parse(localStorage.getItem('xiv-player-preferences'));
  if (saved) {
    if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) { player.setVolume(saved.volume); $('volume').value = String(saved.volume); }
    configureLoop(saved.mode, saved.limit);
  }
} catch { /* Invalid preferences leave defaults intact. */ }
if (!window.showDirectoryPicker || !window.isSecureContext) { $('open-directory').disabled = true; status('library-status', '请在新版 Chrome / Edge 中通过 HTTPS 或 localhost 打开此页面。', true); }
renderTracks();
async function restoreDirectory() {
  if (!window.showDirectoryPicker || !window.isSecureContext) return;
  try {
    const handle = await loadDirectoryHandle();
    if (!handle) return;
    lastDirectoryHandle = handle;
    if (await directoryPermission(handle) === 'granted') {
      await openDirectory(handle);
    } else {
      $('open-directory').textContent = '恢复上次目录';
      status('library-status', `已记住上次目录“${handle.name}”，点击按钮恢复访问。`);
    }
  } catch { /* A stale handle is harmless; the next explicit directory choice replaces it. */ }
  finally { opening = false; $('open-directory').disabled = !window.showDirectoryPicker; renderTracks(); }
}
void restoreDirectory();

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    { name: 'get_player_state', title: '读取播放状态', description: '读取已选择曲目、播放位置和循环设置。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ track: selected?.title || null, ...player.state, loopMode: player.limit === Infinity ? 'infinite' : 'finite', limit: Number.isFinite(player.limit) ? player.limit : null }) },
    { name: 'set_loop_playback', title: '设置循环次数', description: '改变循环模式；有限次数包含循环段首次播放。', inputSchema: { type: 'object', properties: { mode: { enum: ['off', 'finite', 'infinite'] }, limit: { type: 'integer', minimum: 1, maximum: 999 } }, required: ['mode', 'limit'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { configureLoop(input.mode, input.limit); return { mode: input.mode, limit: input.limit }; } },
    { name: 'set_audio_channel', title: '选择试听声道', description: '选择完整多声道混音，或独听某一个声道。独听会复制到左右声道。', inputSchema: { type: 'object', properties: { channel: { type: 'integer', minimum: -1, maximum: 7 } }, required: ['channel'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { setAudioSelection(input.channel < 0 ? null : [input.channel]); return { channel: input.channel, mode: input.channel < 0 ? 'all' : 'solo' }; } },
    { name: 'set_audio_variant', title: '选择游戏变体', description: '在六声道资源中选择已识别的游戏变体立体声轨：变体 1 为 FL+FC，变体 2 为 FR+SL，过渡强音为 LFE+SR。每组第一个源声道送左声道，第二个送右声道，只输出这一组立体声。', inputSchema: { type: 'object', properties: { variant: { enum: ['all', 'one', 'two', 'transition'] } }, required: ['variant'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { const groups = { all: null, one: [0, 2], two: [1, 4], transition: [3, 5] }; if (groups[input.variant] && (!info || info.channels !== 6)) throw new Error('当前曲目不是六声道资源。'); setAudioSelection(groups[input.variant], input.variant, 'pair'); return { variant: input.variant, channels: groups[input.variant] }; } },
  ];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional API. */ } }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
