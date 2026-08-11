import { configRead } from '../config.js';

// On the true last video of a real YouTube playlist, the innertube /next
// response's contents.singleColumnWatchNextResults.autoplay.autoplay.sets
// (NORMAL mode) falls back to an unrelated recommended video - that's what
// produced the original "random video" behavior.
//
// Investigation notes (see project reference for context):
// - contents.autoplay.autoplay.sets drives silent auto-navigation only -
//   it does NOT control anything visible. Playlist transitions in this app
//   are always silent cuts regardless, confirmed by testing.
// - A normal, non-playlist video reaching its end DOES show a real native
//   "Up Next" overlay (confirmed by testing) - driven by a *separate*,
//   server-authored object at playerOverlays.playerOverlayRenderer.autoplay
//   .playerOverlayAutoplayRenderer. In the true end-of-playlist case the
//   server never includes this key at all (the app wasn't designed for
//   "nothing left to play"), so nothing renders - a black screen.
// - An earlier attempt synthesized playerOverlays.playerOverlayRenderer
//   .replay instead of .autoplay - that key does not correspond to a
//   working rendered component in this app and caused the player to exit
//   back to the playlist list.
//
// Fix: remove the NORMAL set's autoplayVideoRenderer (the actual silent
// auto-navigation trigger) so nothing auto-transitions, and synthesize a
// real playerOverlayAutoplayRenderer - the same shape already proven to
// render for standalone video endings - pointed at the current video via
// replayVideoRenderer.pivotVideoRenderer, which is present in every /next
// response regardless of playlist state.
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
                    // 1. Remove the silent auto-navigation trigger for the
                    // NORMAL set so nothing transitions on its own.
                    for (const set of sets) {
                        if (set.mode === 'NORMAL') {
                            delete set.autoplayVideoRenderer;
                        }
                    }

                    // 2. Synthesize the real "Up Next" overlay - same shape
                    // proven to render for standalone video endings -
                    // pointed at the current video instead of a
                    // recommendation.
                    if (overlayRenderer) {
                        const byline = pivot.shortBylineText?.runs?.[0]?.text
                            ? { simpleText: pivot.shortBylineText.runs[0].text }
                            : pivot.shortBylineText;

                        overlayRenderer.autoplay = {
                            playerOverlayAutoplayRenderer: {
                                title: { simpleText: 'Up next' },
                                videoTitle: pivot.title,
                                byline,
                                cancelText: { simpleText: 'Cancel' },
                                pauseText: { simpleText: 'Auto-play is paused' },
                                background: pivot.thumbnail,
                                countDownSecs: 5,
                                nextButton: {
                                    buttonRenderer: {
                                        isDisabled: false,
                                        icon: { iconType: 'PLAYING' },
                                        navigationEndpoint: pivot.navigationEndpoint,
                                        accessibility: { label: 'Play next video' },
                                        trackingParams: pivot.trackingParams ?? ''
                                    }
                                },
                                trackingParams: pivot.trackingParams ?? '',
                                preferImmediateRedirect: false,
                                videoId: pivot.videoId,
                                countDownSecsForFullscreen: 5
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
