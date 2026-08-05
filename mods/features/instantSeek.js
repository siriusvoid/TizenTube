import { configRead } from '../config.js';

// The YouTube TV player's seek bar (<ytlr-progress-bar>) normally moves a
// highlighted scrub position on left/right and only commits the seek once
// OK/Enter is pressed. This debounces that: every left/right press resets
// a short timer, and the commit (a synthetic OK press) only fires once
// movement actually pauses. That's what lets rapid or held-down seeking
// keep moving freely - each step no longer waits on a round trip through
// the native commit handler before the next one can register.
//
// We deliberately don't reimplement seeking ourselves - letting YouTube's
// own handler move the highlight and commit it keeps all of its native
// bounds-checking and seek logic intact.

const SEEK_COMMIT_DELAY_MS = 500;

let pendingTimer = null;
let pendingTarget = null;

function isOnProgressBar() {
    return document.activeElement && document.activeElement.tagName === 'YTLR-PROGRESS-BAR';
}

function commitSeek(target) {
    const down = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true });
    // keyCode is deprecated and read-only on the constructed event, so it
    // has to be overridden this way to match what a real OK press sends.
    Object.defineProperty(down, 'keyCode', { get: () => 13 });
    Object.defineProperty(up, 'keyCode', { get: () => 13 });
    target.dispatchEvent(down);
    target.dispatchEvent(up);
}

function cancelPending() {
    if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }
    pendingTarget = null;
}

function scheduleCommit(target) {
    cancelPending();
    pendingTarget = target;
    pendingTimer = setTimeout(() => {
        const t = pendingTarget;
        pendingTimer = null;
        pendingTarget = null;
        if (document.activeElement === t) {
            commitSeek(t);
        }
    }, SEEK_COMMIT_DELAY_MS);
}

document.addEventListener('keydown', (evt) => {
    if (!configRead('enableInstantSeek')) return;

    if (evt.keyCode === 37 || evt.keyCode === 39) {
        if (!isOnProgressBar()) {
            cancelPending();
            return;
        }
        scheduleCommit(document.activeElement);
    } else if (evt.keyCode === 13 || evt.keyCode === 38) {
        // A real OK press, or moving up into the chapters strip, means any
        // pending auto-commit is no longer wanted - a real OK already
        // committed things, and auto-firing one into the chapters strip
        // would interfere with browsing/opening a chapter there.
        cancelPending();
    }
}, true);

// If focus moves off the progress bar entirely, don't leave a stale
// commit waiting to fire against whatever ends up focused next.
document.addEventListener('focusout', (evt) => {
    if (pendingTarget && evt.target === pendingTarget) {
        cancelPending();
    }
}, true);
