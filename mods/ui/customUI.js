// Custom UI for video player

import { extractAssignedFunctions } from "../utils/ASTParser.js";
import { configRead } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

function applyPatches() {
    if (!window._yttv) return setTimeout(applyPatches, 250);
    if (!document.querySelector('video')) return setTimeout(applyPatches, 250);
    const methods = Object.keys(window._yttv).filter(key => {
        return typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION');
    });

    if (methods.length === 0) {
        setTimeout(applyPatches, 250);
        return;
    }

    const origMethod = window._yttv[methods[0]];

    function YtlrPlayerActionsContainer() {
        const args = Array.prototype.slice.call(arguments);
        const isClass = /^class\s/.test(origMethod.toString());

        function constructAsNew(ctor, argsList) {
            if (typeof Reflect !== 'undefined' && typeof Reflect.construct === 'function') {
                return Reflect.construct(ctor, argsList, YtlrPlayerActionsContainer);
            }
            return new origMethod(...argsList);
        }

        if (!(this instanceof YtlrPlayerActionsContainer)) {
            if (isClass) return constructAsNew(origMethod, args);
            return origMethod.apply(this, args);
        }

        let inst;
        if (isClass) {
            inst = constructAsNew(origMethod, args);
        } else {
            origMethod.apply(this, args);
            inst = this;
        }

        const functions = extractAssignedFunctions(origMethod.toString());

        const pipCommand = {
            "type": "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP",
            "button": {
                "buttonRenderer": ButtonRenderer(
                    false,
                    configRead('enableSwapMPWithPIP') ? 'Picture in Picture' : 'Mini Player',
                    'CLEAR_COOKIES',
                    {
                        customAction: {
                            action: configRead('enableSwapMPWithPIP') ? 'ENTER_PIP' : 'ENTER_MP',
                        }
                    }
                )
            }
        }

        const settingActionGroup = functions.find(func => {
            return func.rhs.includes('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
        }).left.split('.')[1];

        if (!settingActionGroup) return inst;

        const origSettingActionGroup = inst[settingActionGroup];
        if (configRead('enableMPButton')) {
            inst[settingActionGroup] = function () {
                const res = origSettingActionGroup.apply(this, arguments);
                const idx = res.findIndex(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP') || res.splice(idx, 0, pipCommand);
                return res;
            };
        }

        const previousButtonName = functions.find(func => {
            if (func.rhs.includes('skipNextButton')) {
                const skipNextButtonIndex = func.rhs.indexOf('skipNextButton');
                const skipPreviousButtonIndex = func.rhs.indexOf('skipPreviousButton');
                if (skipPreviousButtonIndex > skipNextButtonIndex) {
                    return true;
                }
            }
        }).left.split('.')[1];

        const nextButtonName = functions.find(func => {
            if (func.rhs.includes('skipPreviousButton')) {
                const skipNextButtonIndex = func.rhs.indexOf('skipNextButton');
                const skipPreviousButtonIndex = func.rhs.indexOf('skipPreviousButton');
                if (skipNextButtonIndex > skipPreviousButtonIndex) {
                    return true;
                }
            }
        }).left.split('.')[1];

        const engagementActionButton = functions.find(func => func.rhs.includes('props.data.engagementActions')).left.split('.')[1];

        // Nr (real name varies per build — minified) is the shared per-row
        // renderer used for every button row in this class, including the
        // promoted-actions row (Channel/About/Subscribe) and the engagement
        // row (Like/Comments/etc). It's a plain prototype method, not an
        // assignment, so extractAssignedFunctions above won't find it — we
        // locate it here by a stable marker instead: 'subscribeButtonRenderer'
        // is a real Innertube schema name (not a minifier artifact), so this
        // should keep resolving correctly even if the internal method name
        // changes on a future YouTube TV frontend rebuild.
        function findMethodNameByBodyMarker(source, marker) {
            const re = /(?:^|[;,{}\s])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
            let m;
            while ((m = re.exec(source)) !== null) {
                const braceStart = source.indexOf('{', m.index);
                let depth = 1, i = braceStart + 1;
                while (i < source.length && depth > 0) {
                    if (source[i] === '{') depth++;
                    else if (source[i] === '}') depth--;
                    i++;
                }
                if (source.slice(braceStart, i).includes(marker)) {
                    return m[1];
                }
            }
            return null;
        }

        const sharedRowRenderer = findMethodNameByBodyMarker(origMethod.toString(), 'subscribeButtonRenderer');

        // The promoted-actions row (Channel/About/Subscribe) is the only one
        // of the three button rows in this class's template() that calls
        // this shared renderer without seamless mode — that's specifically
        // why it can't tolerate a filtered/shrunk array the way the
        // engagement row (Like/Comments/etc, seamless already true) can.
        // Force seamless on for that one row only — identified by its call
        // always passing a fixed index of 0, per template()'s own source —
        // leaving the other rows' calls untouched.
        if (sharedRowRenderer && (configRead('enableHideSubscribeButton') || configRead('enableHideAboutButton'))) {
            const origSharedRowRenderer = inst[sharedRowRenderer];
            inst[sharedRowRenderer] = function (a, b, c) {
                if (b === 0) {
                    c = true;
                }
                return origSharedRowRenderer.call(this, a, b, c);
            }
        }

        // 'props.data.promotedActions' alone isn't a unique marker on every
        // build — the real class can have a second, unrelated assignment
        // whose source also happens to reference it, and .find() would
        // silently grab that one instead, wrapping a property that's never
        // actually part of the rendered row (confirmed live on-device: the
        // toggle had no visible effect because of exactly this). The correct
        // accessor also references 'setReminderButton' in the same
        // expression — pairing both markers disambiguates it.
        const promotedActionButtonMatch = functions.find(func => func.rhs.includes('props.data.promotedActions') && func.rhs.includes('setReminderButton'));
        const promotedActionButton = promotedActionButtonMatch ? promotedActionButtonMatch.left.split('.')[1] : null;

        if (promotedActionButton && configRead('enableHideSubscribeButton')) {
            const origPromotedActionButton = inst[promotedActionButton];
            inst[promotedActionButton] = function () {
                const res = origPromotedActionButton.apply(this, arguments);
                // res can legitimately be undefined in some player states —
                // this was uncaught before and threw from inside
                // resolveCommand's call chain (not just at render time),
                // which was severe enough to freeze the app on navigating
                // back.
                if (!Array.isArray(res)) return res;
                return res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUBSCRIBE');
            }
        }

        if (promotedActionButton && configRead('enableHideAboutButton')) {
            const origPromotedActionButton = inst[promotedActionButton];
            inst[promotedActionButton] = function () {
                const res = origPromotedActionButton.apply(this, arguments);
                if (!Array.isArray(res)) return res;
                return res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_ABOUT_BUTTON');
            }
        }

        if (engagementActionButton && configRead('enableSpeedControlsButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED') || res.push({
                    type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                    button: {
                        buttonRenderer: ButtonRenderer(
                            false,
                            "Speed Controls",
                            'SLOW_MOTION_VIDEO',
                            {
                                customAction:
                                {
                                    action: 'TT_SPEED_SETTINGS_SHOW',
                                }
                            }
                        )
                    }
                });
                return res;
            }
        }

        if (!configRead('enableSuperThanksButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING');
                return shoppingFiltered;
            }
        }
        
        if (!configRead('enableAIAskButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                return shoppingFiltered;
            }
        }

        if (configRead('enableHideLikeDislikeButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                return res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_LIKE_BUTTON');
            }
        }

        if (configRead('enableHideCommentsButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                return res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_COMMENTS');
            }
        }

        if (configRead('enableHideSaveToPlaylistButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                return res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_ADD_TO_PLAYLIST');
            }
        }

        if (configRead('enableHidePreviousNextButtons')) {
            if (!previousButtonName || !nextButtonName) return inst;
            inst[previousButtonName] = function () {
                return null;
            }

            inst[nextButtonName] = function () {
                return null;
            }
        } else if (configRead('enablePreviousNextButtons')) {
            if (!previousButtonName || !nextButtonName) return inst;
            inst[previousButtonName] = function () {
                return ButtonRenderer(
                    false,
                    'Previous',
                    'SKIP_PREVIOUS',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_PREVIOUS'
                        }
                    }
                )
            }

            inst[nextButtonName] = function () {
                return ButtonRenderer(
                    false,
                    'Next',
                    'SKIP_NEXT',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_NEXT'
                        }
                    }
                )
            }

        }

        return inst;
    }

    if (configRead('enablePatchingVideoPlayer')) {
        YtlrPlayerActionsContainer.prototype = origMethod.prototype;
        window._yttv[methods[0]] = YtlrPlayerActionsContainer;
    }
}


if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyPatches();
} else {
    window.addEventListener('DOMContentLoaded', applyPatches);
}