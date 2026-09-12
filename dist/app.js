import { Player } from './lib/player.js';

const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./catalog-worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let requestId = 0, catalog = [], filter = 'orchestrion', selected = null, info = null, duration = 0, selection = 0, dragging = false, channelSelection = null, autoVariant = false;
let libraryLabel = '', metadataScanId = 0, trackRows = new Map();
let opening = false, loading = false, decodeQueue = Promise.resolve();
const METADATA_CACHE_KEY = 'xiv-player-track-metadata-v2';
let metadataCache = readMetadataCache(), cacheWriteTimer = null;
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
  clearTimeout(cacheWriteTimer);
  cacheWriteTimer = setTimeout(() => {
    try { localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(metadataCache)); } catch { /* Storage can be disabled or full. */ }
  }, 250);
}
function hydrateMetadataCache() {
  for (const track of catalog) {
    const cached = metadataCache[track.path.toLowerCase()];
    if (!cached) continue;
    track.metadata = { ready: true, ...cached };
    if (cached.codec) track.codec = cached.codec;
  }
}
function trackMetadataLabel(track) {
  if (!track.available) return '不可读取';
  const metadata = track.metadata;
  if (!metadata?.ready) return '正在读取曲目信息…';
  if (metadata.error) return '格式暂不支持';
  const parts = [Number.isFinite(metadata.duration) ? time(metadata.duration) : '时长未知'];
  parts.push(metadata.hasLoop ? '有循环' : '无循环');
  parts.push(metadata.hasVariant ? '有变体' : '无变体');
  return parts.join(' · ');
}
function updateTrackRow(track) {
  const row = trackRows.get(track.id);
  if (row) row.querySelector('.track-meta').textContent = trackMetadataLabel(track);
}
function applyTrackMetadata(path, parsed, error = false) {
  const key = path.toLowerCase();
  const metadata = {
    ready: true,
    error,
    duration: Number.isFinite(parsed.duration) ? parsed.duration : null,
    hasLoop: Boolean(parsed.loop),
    hasVariant: Boolean(parsed.supported && parsed.channels === 6),
    codec: parsed.codec || null,
    channels: parsed.channels || 0,
  };
  metadataCache[key] = { error: metadata.error, duration: metadata.duration, hasLoop: metadata.hasLoop, hasVariant: metadata.hasVariant, codec: metadata.codec, channels: metadata.channels };
  persistMetadataCache();
  for (const track of catalog) {
    if (track.path.toLowerCase() !== key) continue;
    track.metadata = metadata;
    if (parsed.codec) track.codec = parsed.codec;
    updateTrackRow(track);
  }
}
function startMetadataScan(kind = filter) {
  const scan = ++metadataScanId;
  const pendingPaths = [...new Set(catalog
    .filter(track => track.kind === kind && track.available && !track.metadata?.ready)
    .map(track => track.path))];
  if (!pendingPaths.length) return;
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
      if (scan === metadataScanId) status('library-status', `${libraryLabel} · 正在读取曲目详情 ${index + 1}/${pendingPaths.length}…`);
    }
    if (scan === metadataScanId) status('library-status', `${libraryLabel} · 已读取曲库。`);
  })().catch(error => {
    if (scan === metadataScanId) status('library-status', error.message || '曲目详情读取失败。', true);
  });
}
function renderTracks() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = catalog.filter(t => t.kind === filter && `${t.title} ${t.path} ${t.rowId}`.toLocaleLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  trackRows = new Map();
  for (const track of filtered) {
    const button = document.createElement('button');
    button.className = 'track'; button.classList.toggle('selected', selected?.id === track.id);
    button.setAttribute('aria-pressed', String(selected?.id === track.id)); button.disabled = opening || !track.available;
    const number = document.createElement('span'); number.className = 'track-index'; number.textContent = String(track.rowId).padStart(3, '0');
    const content = document.createElement('span'); content.className = 'track-content';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.title;
    const subtitle = document.createElement('span'); subtitle.className = 'track-subtitle'; subtitle.textContent = track.available ? (track.kind === 'orchestrion' ? track.path.split('/').pop().replace('.scd', '') : track.path) : track.unavailableReason;
    const metadata = document.createElement('span'); metadata.className = 'track-meta'; metadata.textContent = trackMetadataLabel(track);
    content.append(name, subtitle, metadata); button.append(number, content);
    if (track.codec || selected?.id === track.id) { const badge = document.createElement('span'); badge.className = 'track-tag'; badge.textContent = track.codec || '已选'; button.append(badge); }
    button.addEventListener('click', () => selectTrack(track)); fragment.append(button); trackRows.set(track.id, button);
  }
  if (!filtered.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = catalog.length ? '没有找到匹配的曲目。' : '曲库将在这里显示。'; fragment.append(p); }
  $('tracks').replaceChildren(fragment);
  $('track-count').textContent = catalog.length ? `${filtered.length} 首 · ${filtered.filter(t => t.available).length} 首可读取` : '尚未载入';
}
async function chooseDirectory() {
  if (opening) return;
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read', id: 'xiv-sqpack' });
    opening = true; $('open-directory').disabled = true;
    metadataScanId++;
    selection++; player.clear(); selected = null; info = null; duration = 0; loading = false;
    resetTrack(); renderTracks();
    const result = await request('open', { directory }, message => status('library-status', message));
    catalog = result.tracks; hydrateMetadataCache(); $('search').disabled = false;
    libraryLabel = `${directory.name} · ${result.repositories.join('、')}`;
    status('library-status', `${libraryLabel} · 已读取曲库。`);
    startMetadataScan(filter);
  } catch (error) {
    if (error.name !== 'AbortError') status('library-status', error.message, true);
  } finally { opening = false; $('open-directory').disabled = !window.showDirectoryPicker; renderTracks(); }
}
function resetTrack() {
  $('title').textContent = selected?.title || '让旋律继续';
  $('description').textContent = selected?.description || (selected ? '来自本地游戏资源' : '选择资源目录，再从左侧选一首曲目。');
  $('track-category').textContent = selected ? (selected.kind === 'orchestrion' ? `管弦乐谱 / ${String(selected.rowId).padStart(3, '0')}` : `游戏配乐 / BGM ${selected.bgmIds.join('、')}`) : 'FINAL FANTASY XIV';
  $('codec').textContent = '本地播放'; $('loop-band').hidden = true; $('marks').replaceChildren();
  $('loop-range').textContent = '选曲后显示'; $('track-details').hidden = true;
  $('play').disabled = true; $('restart').disabled = true; $('seek').disabled = true;
  $('channel-panel').hidden = true; $('channel-presets').replaceChildren(); $('channel-buttons').replaceChildren(); channelSelection = null; autoVariant = false;
  $('variant-toggle').hidden = true; $('variant-toggle').disabled = true; $('variant-status').textContent = '独听会把选中的声道复制到左右声道，方便用耳机检查；默认变体切换会在下一个节点执行。';
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
  finally { if (current === selection) startMetadataScan(filter); }
}
async function loadSelected(track, current) {
  const parsed = await request('track', { path: track.path });
  if (current !== selection) return;
  track.codec = parsed.codec;
  applyTrackMetadata(track.path, parsed);
  if (!parsed.supported) { loading = false; $('codec').textContent = parsed.codec; $('loop-status').textContent = '此资源暂不能播放'; status('player-status', parsed.reason, true); renderTracks(); return; }
  const loaded = await player.load(parsed, () => current === selection);
  if (!loaded || current !== selection) return;
  info = parsed; delete info.ogg; duration = loaded.duration; loading = false;
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
  renderTracks(); await player.play();
}
function channelName(index, count) {
  const names = count === 6 ? ['FL（变体 1 · 左）', 'FR（变体 2 · 左）', 'FC（变体 1 · 右）', 'LFE（过渡 · 左）', 'SL（变体 2 · 右）', 'SR（过渡 · 右）'] : count === 2 ? ['L 左', 'R 右'] : Array.from({ length: count }, (_, i) => `Ch ${i + 1}`);
  return names[index] || `Ch ${index + 1}`;
}
function renderChannels(count) {
  if (count < 2) { $('channel-panel').hidden = true; return; }
  $('channel-panel').hidden = false; $('channel-help').textContent = count === 6 ? '当前资源为 6 声道；预设按三个立体声轨显示，不按 5.1 中置/环绕布局下混。' : `${count} 声道资源`;
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
  const button = $('variant-toggle'); button.hidden = !enabled; button.disabled = !enabled;
  if (!enabled) {
    $('variant-status').textContent = info?.channels === 6 ? '当前为手动试听；重新选择曲目会恢复变体 1 默认播放和节点切换。' : '独听会把选中的声道复制到左右声道，方便用耳机检查。';
    return;
  }
  const variant = Number.isInteger(state.variant) ? state.variant : 0;
  const selected = variant === 0 ? [0, 2] : [1, 4];
  if (channelSelection?.join(',') !== selected.join(',')) { channelSelection = selected; updateChannelSelectionButtons(); }
  button.textContent = `切换到变体 ${variant === 0 ? '2' : '1'}`;
  const pending = Number.isInteger(state.variantPending);
  $('variant-status').textContent = pending ? `已请求切换到变体 ${state.variantPending + 1}；将在下一个节点执行。` : state.variantTransition ? `当前为变体 ${variant + 1}；过渡音播放到下一个节点。` : `当前为变体 ${variant + 1}；点击按钮将在下一个节点切换。`;
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
  $('play').textContent = state.playing ? '暂停' : state.finished ? '重播' : '播放';
  if (!info) $('loop-status').textContent = loading ? '正在读取循环信息…' : '等待选择曲目';
  else if (!info.loop) $('loop-status').textContent = '此曲目无循环区间';
  else if (state.finished) $('loop-status').textContent = '播放结束';
  else if (state.loopExited) $('loop-status').textContent = '循环段已结束，继续尾声';
  else if (state.position < info.loop.start / info.sampleRate) $('loop-status').textContent = '前奏 · 即将进入循环段';
  else $('loop-status').textContent = `循环段第 ${state.pass} 遍 / ${player.limit === Infinity ? '∞' : player.limit} 遍`;
  updateVariantControls(state);
}
function configureLoop(mode, limit) {
  if (!['finite', 'infinite'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 999) throw new Error('循环次数必须是 1～999 的整数。');
  $('loop-mode').value = mode; $('loop-limit').value = String(limit); $('limit-label').hidden = mode === 'infinite';
  player.setLimit(mode === 'infinite' ? Infinity : limit); renderState(player.state);
  try { localStorage.setItem('xiv-player-preferences', JSON.stringify({ mode, limit, volume: player.volume })); } catch { /* Storage can be disabled. */ }
}
$('open-directory').addEventListener('click', chooseDirectory);
$('search').addEventListener('input', renderTracks);
document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  renderTracks(); $('tracks').scrollTop = 0; startMetadataScan(filter);
}));
$('play').addEventListener('click', () => { if (player.state.playing && player.context.state === 'running') player.pause(); else player.play().catch(e => status('player-status', e.message, true)); });
$('restart').addEventListener('click', () => player.restart().catch(e => status('player-status', e.message, true)));
$('seek').addEventListener('input', () => { dragging = true; renderState(player.state); $('played').style.width = `${Number($('seek').value) / duration * 100}%`; });
$('seek').addEventListener('change', () => { dragging = false; player.seek(Number($('seek').value)); });
$('volume').addEventListener('input', () => player.setVolume(Number($('volume').value)));
$('channel-all').addEventListener('click', () => setAudioSelection(null));
$('variant-toggle').addEventListener('click', () => { if (player.requestVariantToggle()) status('player-status', '已请求切换，将在下一个节点切换变体并播放过渡音。'); });
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

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    { name: 'get_player_state', title: '读取播放状态', description: '读取已选择曲目、播放位置和循环设置。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ track: selected?.title || null, ...player.state, loopMode: player.limit === Infinity ? 'infinite' : 'finite', limit: Number.isFinite(player.limit) ? player.limit : null }) },
    { name: 'set_loop_playback', title: '设置循环次数', description: '改变循环模式；有限次数包含循环段首次播放。', inputSchema: { type: 'object', properties: { mode: { enum: ['finite', 'infinite'] }, limit: { type: 'integer', minimum: 1, maximum: 999 } }, required: ['mode', 'limit'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { configureLoop(input.mode, input.limit); return { mode: input.mode, limit: input.limit }; } },
    { name: 'set_audio_channel', title: '选择试听声道', description: '选择完整多声道混音，或独听某一个声道。独听会复制到左右声道。', inputSchema: { type: 'object', properties: { channel: { type: 'integer', minimum: -1, maximum: 7 } }, required: ['channel'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { setAudioSelection(input.channel < 0 ? null : [input.channel]); return { channel: input.channel, mode: input.channel < 0 ? 'all' : 'solo' }; } },
    { name: 'set_audio_variant', title: '选择游戏变体', description: '在六声道资源中选择已识别的游戏变体立体声轨：变体 1 为 FL+FC，变体 2 为 FR+SL，过渡强音为 LFE+SR。每组第一个源声道送左声道，第二个送右声道，只输出这一组立体声。', inputSchema: { type: 'object', properties: { variant: { enum: ['all', 'one', 'two', 'transition'] } }, required: ['variant'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => { const groups = { all: null, one: [0, 2], two: [1, 4], transition: [3, 5] }; if (groups[input.variant] && (!info || info.channels !== 6)) throw new Error('当前曲目不是六声道资源。'); setAudioSelection(groups[input.variant], input.variant, 'pair'); return { variant: input.variant, channels: groups[input.variant] }; } },
  ];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional API. */ } }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
