import { configRead } from '../config.js';

// Patches the innertube /next response's watchNext data: when on the true
// last video of a real YouTube playlist, the NORMAL-mode autoplay set's
// target normally falls back to an unrelated recommended video (no
// playlistId - this is what produced the "random video" behavior).
//
// Rather than stripping that target (confirmed via CDP to leave native
// code with a malformed object, which renders nothing at all - a black
// screen, not even the native endscreen component gets created), this
// repoints the same target at the current video itself, reusing the
// replayVideoRenderer.pivotVideoRenderer data already present in every
// /next response. Native code then gets a complete, well-formed object to
// render its normal "Up Next"-style overlay - just offering to replay the
// video (with a visible Replay label/thumbnail) instead of autoplaying
// something unrelated.
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

            if (playlist && sets && pivot?.navigationEndpoint?.watchEndpoint) {
                const isLastVideo = playlist.currentIndex === playlist.totalVideos - 1;
                if (isLastVideo) {
                    for (const set of sets) {
                        if (set.mode !== 'NORMAL') continue; // leave LOOP/SHUFFLE/LOOP_ONE alone

                        const avr = set.autoplayVideoRenderer;
                        if (!avr) continue;

                        const targetEndpoint = pivot.navigationEndpoint;
                        const rendererKey = avr.autonavEndpointRenderer ? 'autonavEndpointRenderer' : 'autoplayEndpointRenderer';
                        if (avr[rendererKey]?.endpoint) {
                            avr[rendererKey].endpoint = targetEndpoint;
                        }

                        const nextRenderer = set.nextVideoRenderer?.autoplayEndpointRenderer
                            ?? set.nextVideoRenderer?.maybeHistoryEndpointRenderer;
                        if (nextRenderer?.endpoint) {
                            nextRenderer.endpoint = targetEndpoint;
                            // useNextHistoryItem tells native code to navigate based on
                            // actual browser history instead of `endpoint` - clear it so
                            // our injected replay target actually gets used.
                            delete nextRenderer.useNextHistoryItem;
                        }

                        const preview = nextRenderer?.item?.previewButtonRenderer;
                        if (preview) {
                            preview.title = pivot.title;
                            preview.thumbnail = pivot.thumbnail;
                            preview.byline = pivot.shortBylineText;
                            preview.subtitle = { simpleText: 'Replay' };
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('[TizenTube] stopAtPlaylistEnd: failed to process response', e);
    }
    return r;
};
