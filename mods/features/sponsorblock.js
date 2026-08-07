import sha256 from '../tiny-sha256.js';
import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/da1a535de784540ee10166a75a3eb8537073838c/src/config.ts#L113-L134
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: t('sponsorblock.segments.sponsor') || 'sponsored segment'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: t('sponsorblock.segments.intro') || 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: t('sponsorblock.segments.outro') || 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: t('sponsorblock.segments.interaction') || 'interaction reminder'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: t('sponsorblock.segments.selfpromo') || 'self-promotion'
  },
  preview: {
    color: '#008fd6',
    opacity: '0.7',
    name: t('sponsorblock.segments.preview') || 'recap or preview'
  },
  filler: {
    color: "#7300FF",
    opacity: "0.9",
    name: t('sponsorblock.segments.filler') || 'tangents'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: t('sponsorblock.segments.music_offtopic') || 'non-music part'
  },
  poi_highlight: {
    color: '#9b044c',
    opacity: '0.7',
    name: t('sponsorblock.segments.poi_highlight') || 'highlight'
  }
};

// Paints segment colors as a linear-gradient onto the native
// [idomkey="cue-ranges"] element instead of creating a separate overlay
// div. That element already sits in the correct DOM position on the
// progress bar - below the pointer, above the watched-progress fill -
// confirmed empty/inert on both a normal video and a live stream via
// devtools, so repainting its background doesn't fight for stacking
// order the way a new inserted element did.
function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function buildSegmentsGradient(segments, videoDuration) {
  if (!videoDuration || !segments || !segments.length) return 'none';

  // One gradient layer per segment, stacked via CSS's multiple-background
  // support, rather than merging every segment into one gradient's stop
  // list. Overlapping segments (real data has this - e.g. an intro and a
  // music_offtopic segment both starting at 0s) would otherwise produce
  // out-of-order stop positions, which browsers clamp unpredictably.
  // Separate layers composite via ordinary alpha blending instead, the
  // same way the old separately-positioned divs did.
  return segments.map((segment) => {
    const [start, end] = segment.segment;
    const barType = barTypes[segment.category] || { color: '#0000ff', opacity: 0.7 };
    const rgba = hexToRgba(barType.color, barType.opacity);

    const startPercent = Math.max(0, Math.min(100, (100 * start) / videoDuration));
    // poi_highlight segments are a single point in time (start === end) -
    // give them a minimum visible width, same as the old 1%-wide dot did.
    const endPercent = segment.category === 'poi_highlight'
      ? Math.min(100, startPercent + 1)
      : Math.max(0, Math.min(100, (100 * end) / videoDuration));

    const stops = [];
    if (startPercent > 0) stops.push(`transparent 0%`, `transparent ${startPercent}%`);
    stops.push(`${rgba} ${startPercent}%`, `${rgba} ${endPercent}%`);
    if (endPercent < 100) stops.push(`transparent ${endPercent}%`, 'transparent 100%');

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }).join(', ');
}

const sponsorblockAPI = 'https://sponsor.ajay.app/api';

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  nextSkipTimeout = null;

  cueRangesEl = null;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  skippedCategories = new Map();

  constructor(videoID) {
    this.videoID = videoID;
  }

  async init() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const categories = [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'preview',
      'filler',
      'music_offtopic',
      'poi_highlight'
    ];
    const resp = await fetch(
      `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );
    const results = await resp.json();

    const result = results.find((v) => v.videoID === this.videoID);
    console.info(this.videoID, 'Got it:', result);

    if (!result || !result.segments || !result.segments.length) {
      console.info(this.videoID, 'No segments found.');
      return;
    }

    this.segments = result.segments;
    this.manualSkippableCategories = configRead('sponsorBlockManualSkips');
    this.skippableCategories = this.getSkippableCategories();

    this.scheduleSkipHandler = () => {
      // Reapplies on every tick as a safety net in case native code ever
      // resets this element's background - cheap (a single style write,
      // no DOM creation/removal) so doing it defensively here is fine.
      this.applySegmentsGradient();
      this.scheduleSkip();
    }
    this.durationChangeHandler = () => this.buildOverlay();

    this.attachVideo();
    this.buildOverlay();
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockPreview')) {
      skippableCategories.push('preview');
    }
    if (configRead('enableSponsorBlockFiller')) {
      skippableCategories.push('filler');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      console.info(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      return;
    }

    console.info(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);
  }

  buildOverlay() {
    if (this.cueRangesEl) {
      console.info('Overlay already built');
      return;
    }

    if (!this.video || !this.video.duration) {
      console.info('No video duration yet');
      return;
    }

    const cueRangesEl = document.querySelector('ytlr-progress-bar [idomkey="cue-ranges"]');
    if (!cueRangesEl) return setTimeout(() => this.buildOverlay(), 100);

    this.cueRangesEl = cueRangesEl;
    this.applySegmentsGradient();
  }

  applySegmentsGradient() {
    if (!this.cueRangesEl || !this.video) return;
    const gradient = buildSegmentsGradient(this.segments, this.video.duration);
    this.cueRangesEl.style.setProperty('background-image', gradient, 'important');
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active) {
      console.info(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (this.video.paused) {
      console.info(this.videoID, 'Currently paused, ignoring...');
      return;
    }

    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    console.info(
      this.videoID,
      'Scheduling skip of',
      segment,
      'in',
      start - this.video.currentTime
    );

    this.nextSkipTimeout = setTimeout(() => {
      if (this.video.paused) {
        console.info(this.videoID, 'Currently paused, ignoring...');
        return;
      }
      if (!this.skippableCategories.includes(segment.category)) {
        console.info(
          this.videoID,
          'Segment',
          segment.category,
          'is not skippable, ignoring...'
        );
        return;
      }

      const skipName = barTypes[segment.category]?.name || segment.category;
      console.info(this.videoID, 'Skipping', segment);
      if (!this.manualSkippableCategories.includes(segment.category)) {
        const wasSkippedBefore = this.skippedCategories.get(segment.UUID)
        if (wasSkippedBefore) {
          wasSkippedBefore.count++;
          wasSkippedBefore.lastSkipped = Date.now();
          this.skippedCategories.set(segment.UUID, wasSkippedBefore);

          if (wasSkippedBefore.lastSkipped - wasSkippedBefore.firstSkipped < 1000) {
            if (!wasSkippedBefore.hasShownToast) {
              if (configRead('enableSponsorBlockToasts')) {
                showToast('SponsorBlock', t('sponsorblock.toasts.notSkipping', { segment: skipName, count: wasSkippedBefore.count }));
              }
              wasSkippedBefore.hasShownToast = true;
              this.skippedCategories.set(segment.UUID, wasSkippedBefore);
            }
            return;
          }
        } else {
          this.skippedCategories.set(segment.UUID, {
            count: 1,
            firstSkipped: Date.now(),
            lastSkipped: Date.now(),
            hasShownToast: false
          });
        }
        if (configRead('enableSponsorBlockToasts')) {
          showToast('SponsorBlock', t('sponsorblock.toasts.skipping', { segment: skipName }));
        }
        if (this.video.duration - end < 1) {
          this.video.currentTime = end - 1;
        } else this.video.currentTime = end;
        this.scheduleSkip();
      }
    }, (start - this.video.currentTime) * 1000);
  }

  destroy() {
    console.info(this.videoID, 'Destroying');

    this.active = false;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = null;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = null;
    }

    if (this.cueRangesEl) {
      this.cueRangesEl.style.removeProperty('background-image');
      this.cueRangesEl = null;
    }

    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }

    this.skippedCategories.clear();
  }
}

// When this global variable was declared using let and two consecutive hashchange
// events were fired (due to bubbling? not sure...) the second call handled below
// would not see the value change from first call, and that would cause multiple
// SponsorBlockHandler initializations... This has been noticed on Chromium 38.
// This either reveals some bug in chromium/webpack/babel scope handling, or
// shows my lack of understanding of javascript. (or both)
window.sponsorblock = null;

window.addEventListener(
  'hashchange',
  () => {
    const newURL = new URL(location.hash.substring(1), location.href);
    // A hack, but it works, so...
    const videoID = newURL.search.replace('?v=', '').split('&')[0];
    const needsReload =
      videoID &&
      (!window.sponsorblock || window.sponsorblock.videoID != videoID);

    console.info(
      'hashchange',
      videoID,
      window.sponsorblock,
      window.sponsorblock ? window.sponsorblock.videoID : null,
      needsReload
    );

    if (needsReload) {
      if (window.sponsorblock) {
        try {
          window.sponsorblock.destroy();
        } catch (err) {
          console.warn('window.sponsorblock.destroy() failed!', err);
        }
        window.sponsorblock = null;
      }

      if (configRead('enableSponsorBlock')) {
        window.sponsorblock = new SponsorBlockHandler(videoID);
        window.sponsorblock.init();
      } else {
        console.info('SponsorBlock disabled, not loading');
      }
    }
  },
  false
);
