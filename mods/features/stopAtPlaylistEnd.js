import { configRead } from '../config.js';

// On the true last video of a real YouTube playlist, the innertube /next
// response's contents.singleColumnWatchNextResults.autoplay.autoplay.sets
// (NORMAL mode) falls back to an unrelated recommended video - that's what
// produced the original "random video" behavior.
//
// Important distinction found via CDP + on-device testing: that `sets`
// data only controls what native code silently navigates *to* once
// playback ends - it does NOT control what's visually shown. The visible
// "Up Next"/"Replay" screen is a *separate*, server-authored object at
// playerOverlays.playerOverlayRenderer (.autoplay or .replay). In the true
// end-of-playlist case, the server includes neither key at all - the app
// was apparently never designed to reach a "nothing left to play" state,
// so nothing renders (confirmed via CDP: no endscreen/overlay component
// gets created - a black screen). A first attempt that repointed `sets`
// at the current video did stop the "random video" jump, but caused an
// instant, invisible auto-replay with no visible screen at all, since
// `sets` alone drives navigation independent of any UI.
//
// Fix: remove the NORMAL set entirely so nothing auto-navigates, and
// synthesize a playerOverlayReplayRenderer ourselves - reusing the same
// shape already used elsewhere in real captured responses for a genuine
// "Replay" screen - built from replayVideoRenderer.pivotVideoRenderer
// data, which is present in every /next response regardless of playlist
// state.
//
// Uses the same global JSON.parse monkeypatch technique already used
// elsewhere in this codebase (see adblock.js) rather than an XHR getter
// override - simpler, and doesn't care whether the response was read via
// fetch or XHR.
const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    try {
        if (configRead('enableStopAtPlaylistEnd')) {
            const results = r?.contents?.singleColumnWatchNextResults;
            const playlist = results?.playlist?.playlist;
            const sets = results?.autoplay?.autoplay?.sets;
            const pivot = results?.autoplay?.autoplay?.replayVideoRenderer?.pivotVideoRenderer;
            const overlayRenderer = r?.playerOverlays?.playerOverlayRenderer;

            if (playlist && sets && pivot?.navigationEndpoint?.watchEndpoint) {
                const isLastVideo = playlist.currentIndex === playlist.totalVideos - 1;
                if (isLastVideo) {
                    // 1. Remove the NORMAL autoplay set entirely so there is
                    // nothing left for native code to silently navigate to.
                    const normalIndex = sets.findIndex((s) => s.mode === 'NORMAL');
                    if (normalIndex !== -1) sets.splice(normalIndex, 1);

                    // 2. Synthesize the visible replay overlay, since the
                    // server doesn't provide one in this scenario.
                    if (overlayRenderer) {
                        overlayRenderer.replay = {
                            playerOverlayReplayRenderer: {
                                background: pivot.thumbnail,
                                trackingParams: pivot.trackingParams ?? '',
                                overlayIcon: pivot.overlayIcon ?? { iconType: 'REPLAY' },
                                overlayLabel: pivot.overlayLabel ?? { simpleText: 'Replay' },
                                navigationEndpoint: pivot.navigationEndpoint,
                                shortBylineText: pivot.shortBylineText,
                                title: pivot.title
                            }
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.error('[TizenTube] stopAtPlaylistEnd: failed to process response', e);
    }
    return r;
};
