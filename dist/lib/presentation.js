import { bgmLocations } from './bgm-location-i18n.js';
import { normalizeLoop } from './scd.js?v=20260913-22';

export function cleanTitle(value = '') {
  return value.split(' / ').map(part => part.replace(/\*+\s*$/, '').trim()).join(' / ');
}
const USAGE_FIELDS = ['uses', 'dungeons', 'maps', 'seasonalEvents', 'events'];
export function trackUsage(track, locale = 'zh') {
  const source = track && typeof track === 'object' ? track : {};
  const curated = bgmLocations(source.bgmIds, locale);
  const localized = Array.isArray(source.usageByLocale?.[locale]) ? source.usageByLocale[locale] : [];
  const values = (curated.length ? curated : localized.length ? localized : USAGE_FIELDS.flatMap(field => Array.isArray(source[field]) ? source[field] : []))
    .map(value => String(value).trim()).filter(Boolean);
  return [...new Set(values)].join('、') || '-';
}
export function summarizeMetadata(parsed) {
  const loop = parsed.loop && Number.isFinite(parsed.totalSamples) && Number.isFinite(parsed.sampleRate)
    ? normalizeLoop(parsed.loop, parsed.totalSamples, parsed.sampleRate)
    : parsed.loop;
  return { ready: true, duration: Number.isFinite(parsed.duration) ? parsed.duration : null,
    hasLoop: Boolean(loop), hasVariant: Boolean(parsed.supported && parsed.channels === 6),
    codec: parsed.codec || null, channels: parsed.channels || 0 };
}
const paths = {
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M5 5v14M19 5 7 12l12 7Z"/>',
  previous: '<path d="M6 5v14M18 6 9 12l9 6Z"/>',
  next: '<path d="M18 5v14M6 6l9 6-9 6Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7.5v.5"/>',
  order: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
  repeatOne: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3M12 10v6m-2-4 2-2"/>',
  shuffle: '<path d="M4 7h3c4 0 6 10 10 10h3m0 0-3-3m3 3-3 3M4 17h3c1.7 0 3-1.8 4.1-4M20 7h-3c-1.1 0-2.1.8-3 2m6-2-3-3m3 3-3 3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  variant: '<path d="M3 6h5c6 0 2 12 8 12h5m-4-4 4 4-4 4M3 18h5c2 0 3-2 4-6s2-6 4-6h5m-4-4 4 4-4 4"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  music: '<path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="15" rx="3" ry="3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export function setIcon(element, name) {
  element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.music) + '</svg>';
}
