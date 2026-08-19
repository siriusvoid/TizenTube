import { configRead } from '../config.js';

// Overrides the player's native duration text ([idomkey="duration"], inside
// [idomkey="time-label"] next to [idomkey="elapsedTime"]) to count down
// instead of showing the fixed total, when Settings > Misc > Show Remaining
// Time is on. Confirmed via CDP against a real device - the visually
// similar duration text on recommendation shelf items uses a different
// element entirely (<yt-formatted-string>, no idomkey) and is never
// touched here.
//
// Two separate things reset this text away from us, both confirmed via
// CDP:
// 1. The native app rewrites the SAME element's text back to the total
//    roughly once a second during ordinary playback.
// 2. Seeking on the timeline tears the element down entirely and
//    recreates it as a brand new node a moment later (confirmed: the
//    element goes briefly unfindable, then reappears as a different node
//    holding the plain, unmodified total).
// A guard bound to a single captured element reference survives (1) but
// not (2) - once the node is replaced, writes to the old reference are
// invisible and the observer watching it goes quiet. Observing the
// progress-bar container instead (confirmed via the same CDP capture to
// survive both the periodic reset and the seek-triggered rebuild) and
// re-querying the duration element fresh on every check, rather than
// trusting a cached reference, survives both.
//
// Re-attaches on every 'hashchange', the same signal features/sponsorblock.js
// uses for detecting a new video, since the player element is torn down and
// recreated across navigation.

let video = null;
let desiredText = null;
let attachRetryTimeout = null;
let guardObserver = null;

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function findDurationEl() {
    return document.querySelector('[idomkey="time-label"] [idomkey="duration"]');
}

function findGuardContainer() {
    // Confirmed via CDP to survive both the periodic native text reset and
    // the node replacement that happens on seek - unlike time-label or the
    // duration element itself, which get torn down and recreated on seek.
    return document.querySelector('ytlr-progress-bar[idomkey="progress-bar"]');
}

function computeDesiredText() {
    if (!video || !video.duration || !isFinite(video.duration)) return null;

    if (!configRead('enableRemainingTime')) {
        return formatTime(video.duration);
    }

    return `-${formatTime(video.duration - video.currentTime)}`;
}

function apply() {
    if (!video) return;
    const el = findDurationEl();
    if (!el) return;
    const next = computeDesiredText();
    if (next === null) return;
    desiredText = next;
    if (el.textContent !== desiredText) {
        el.textContent = desiredText;
    }
}

function attach() {
    clearTimeout(attachRetryTimeout);
    attachRetryTimeout = null;
    if (guardObserver) {
        guardObserver.disconnect();
        guardObserver = null;
    }

    video = document.querySelector('video');
    const container = findGuardContainer();

    if (!video || !container || !findDurationEl()) {
        attachRetryTimeout = setTimeout(attach, 100);
        return;
    }

    desiredText = null;

    video.addEventListener('timeupdate', apply);
    video.addEventListener('durationchange', apply);
    video.addEventListener('seeking', apply);
    video.addEventListener('seeked', apply);

    guardObserver = new MutationObserver(() => {
        if (desiredText === null) return;
        const el = findDurationEl();
        if (el && el.textContent !== desiredText) {
            el.textContent = desiredText;
        }
    });
    guardObserver.observe(container, { characterData: true, childList: true, subtree: true });

    apply();
}

window.addEventListener('hashchange', attach, false);
attach();
