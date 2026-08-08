import { configRead } from '../config.js';

// Intercepts the innertube /next response and, when it detects we're on the
// last video of a real YouTube playlist, strips the playlistId from the
// NORMAL-mode autoplay target so native autonav can't continue into an
// unrelated recommended video.
//
// Confirmed via device testing that this app fetches /next via
// XMLHttpRequest (not fetch), so we intercept at the responseText/response
// getter level - this works regardless of when/how the native code reads
// the response, since XHR doesn't offer a clean "replace the response"
// hook the way fetch's Response object does.
function neutralizeEndOfPlaylistAutonav(json) {
    try {
        const results = json?.contents?.singleColumnWatchNextResults;
        const playlist = results?.playlist?.playlist;
        if (!playlist) return json; // not a playlist video at all

        const isLastVideo = playlist.currentIndex === playlist.totalVideos - 1;
        if (!isLastVideo) return json;

        const sets = results?.autoplay?.autoplay?.sets;
        if (!sets) return json;

        for (const set of sets) {
            if (set.mode !== 'NORMAL') continue; // leave LOOP/SHUFFLE/LOOP_ONE alone
            const endpoint = set.autoplayVideoRenderer?.autonavEndpointRenderer?.endpoint
                ?? set.autoplayVideoRenderer?.autoplayEndpointRenderer?.endpoint;
            if (endpoint?.watchEndpoint && !endpoint.watchEndpoint.playlistId) {
                // Confirmed fallback-to-recommendation case - remove the set
                // entirely so there's nothing for native autonav to act on.
                set.autoplayVideoRenderer = undefined;
            }
        }
    } catch (e) {
        console.error('[TizenTube] stopAtPlaylistEnd: failed to process /next response', e);
    }
    return json;
}

function getMutatedResponseText(xhr, originalGetter) {
    if (xhr.__ttMutatedText !== undefined) return xhr.__ttMutatedText;

    const raw = originalGetter.call(xhr);
    let mutated = raw;
    try {
        const json = JSON.parse(raw);
        neutralizeEndOfPlaylistAutonav(json);
        mutated = JSON.stringify(json);
    } catch (e) {
        // Not JSON (or body not readable yet) - leave untouched.
    }
    xhr.__ttMutatedText = mutated;
    return mutated;
}

function patchXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ttIsNextCall = typeof url === 'string' && url.includes('/youtubei/v1/next');
        return originalOpen.call(this, method, url, ...rest);
    };

    const responseTextDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const responseDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
        configurable: true,
        get: function () {
            if (this.__ttIsNextCall && configRead('enableStopAtPlaylistEnd')) {
                return getMutatedResponseText(this, responseTextDescriptor.get);
            }
            return responseTextDescriptor.get.call(this);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true,
        get: function () {
            if (this.__ttIsNextCall && configRead('enableStopAtPlaylistEnd')) {
                const text = getMutatedResponseText(this, responseTextDescriptor.get);
                if (this.responseType === '' || this.responseType === 'text') return text;
                if (this.responseType === 'json') {
                    try { return JSON.parse(text); } catch (e) { /* fall through */ }
                }
            }
            return responseDescriptor.get.call(this);
        }
    });
}

patchXHR();
