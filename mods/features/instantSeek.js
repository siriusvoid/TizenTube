import { configRead } from '../config.js';

// The YouTube TV player's seek bar (<ytlr-progress-bar>) normally moves a
// highlighted scrub position on left/right and only commits the seek once
// OK/Enter is pressed. This makes the seek commit immediately after each
// left/right press, by auto-dispatching a synthetic OK press right behind
// it. We deliberately don't reimplement seeking ourselves - letting
// YouTube's own handler move the highlight and commit it keeps all of its
// native bounds-checking and seek logic intact.

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

document.addEventListener('keydown', (evt) => {
    if (!configRead('enableInstantSeek')) return;
    if (evt.keyCode !== 37 && evt.keyCode !== 39) return;
    if (!isOnProgressBar()) return;

    const target = document.activeElement;
    // Let YouTube's own handler move the scrub highlight first, then
    // confirm right behind it on the next tick.
    setTimeout(() => {
        if (document.activeElement === target) {
            commitSeek(target);
        }
    }, 0);
}, true);
