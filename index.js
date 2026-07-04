(function() {
    var VERSION = '1.1.1';
    if (window.__stJs && window.__stJs.version === VERSION) return;
    window.__stJs = { version: VERSION };
    window.__tavoHydrateLoaded = true;
    var oldBtn = document.getElementById('tavo-debug-btn');
    if (oldBtn) oldBtn.remove();
    var oldPanel = document.getElementById('tavo-debug-panel');
    if (oldPanel) oldPanel.remove();
    document.querySelectorAll('span.tavo-sh, span.tavo-done').forEach(function(el) { el.remove(); });
    if (window.__tavoStore && window.__tavoStore.clear) window.__tavoStore.clear();

    var STORE = window.__tavoStore = new Map();
    var SEQ = 0;
    var errors = window.__tavoErrors = window.__tavoErrors || [];
    errors.length = 0;
    var syncing = false;
    var watchedMes = new WeakSet();
    var cssSet = new Set();
    var ranScripts = new WeakMap();
    var failedScripts = new WeakMap();
    var processedMsgs = new WeakMap();
    var nativeAdd = DOMTokenList.prototype.add;
    var nativeRemove = DOMTokenList.prototype.remove;
    var nativeToggle = DOMTokenList.prototype.toggle;
    var regexEngine = null;
    var captureModes = [];
    var activateTimers = new Map();
    var activateGen = new Map();
    var generating = false;

    window.addEventListener('error', function(e) {
        errors.push(e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
        updateOverlay();
    });

    var EV_TYPES = ['click', 'input', 'change', 'mouseover', 'mouseout', 'keydown', 'keyup'];
    EV_TYPES.forEach(function(ev) {
        window.addEventListener(ev, function(e) {
            var el = e.target.closest ? e.target.closest('[data-tavo-ev-' + ev + ']') : null;
            if (el) {
                var idx = el.getAttribute('data-tavo-ev-' + ev);
                var code = STORE.get('ev_' + idx);
                if (code) {
                    try { new Function('event', repairScript(code)).call(el, e); }
                    catch (err) { log('Event [' + ev + '] ' + err.message); }
                }
            }
        }, true);
    });


    var btn = document.createElement('div');
    btn.id = 'tavo-debug-btn';
    btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#9a6a7a;color:#fff;padding:6px 10px;border-radius:10px;font-size:11px;font-family:sans-serif;cursor:pointer;';
    btn.innerText = 'ST-JS Debug (0)';

    var panel = document.createElement('div');
    panel.id = 'tavo-debug-panel';
    panel.style.cssText = 'display:none;position:fixed;bottom:40px;right:10px;width:340px;max-height:420px;overflow:auto;z-index:999999;background:#18171d;color:#e0d8e0;border:1px solid #7a4a58;padding:10px;border-radius:10px;font-size:11px;font-family:monospace;white-space:pre-wrap;';

    (function appendOverlay() {
        if (document.body) { document.body.appendChild(btn); document.body.appendChild(panel); }
        else setTimeout(appendOverlay, 50);
    })();

    btn.addEventListener('click', function() {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        updateOverlay();
    });

    var log = window.__tavoLog = function(msg) { errors.push(msg); updateOverlay(); };
    var updatePending = false;
    function updateOverlay() {
        if (updatePending) return;
        updatePending = true;
        setTimeout(function() {
            updatePending = false;
            if (btn) btn.innerText = 'ST-JS Debug (' + errors.length + ')';
            if (panel && panel.style.display === 'block') {
                var pending = document.querySelectorAll('[data-tavo-script]:not([data-tavo-done])').length;
                var legacy = document.querySelectorAll('span.tavo-sh').length;
                panel.innerText = 'Version: ' + VERSION +
                    '\nPending scripts: ' + pending +
                    '\nLegacy v1 markers: ' + legacy + (legacy ? ' <- DELETE tavo-hydrate folder!' : '') +
                    '\nCapture: ' + (window.__tavoCapture || 'none') +
                    '\nShowdown: ' + !!window.__tavoShowdownHooked +
                    '\nRegex engine: ' + !!regexEngine +
                    '\nStage hits: ' + JSON.stringify(window.__tavoStages || {}) +
                    '\nInjected styles: ' + cssSet.size +
                    '\n\n' + errors.slice(-30).join('\n');
            }
        }, 150);
    }

    log('SillyTavern JS v' + VERSION);
    var stageHits = window.__tavoStages = {};

    function noteCapture(mode) {
        if (captureModes.indexOf(mode) === -1) captureModes.push(mode);
        window.__tavoCapture = captureModes.join('+');
    }

    function decodeEntities(text) {
        if (!text || !/&(?:lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/.test(text)) return text;
        var t = document.createElement('textarea');
        t.innerHTML = text;
        return t.value;
    }

    function repairScript(code) {
        code = decodeEntities(code);
        code = code.replace(/<\/?(?:em|strong|b|i|u|s|del|q|p|mark|small|sub|sup|code|pre)\b[^>]*>/gi, '');
        code = code.replace(/<br\s*\/?>/gi, '\n');
        code = code.replace(/\uFFFE/g, '"');
        return code;
    }

    function fixCssForParser(css) {
        if (!css) return '';
        css = decodeEntities(String(css));
        return css
            .replace(/<br\s*\/?>/gi, '')
            .replace(/\s+i(\]|,)/gi, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '');
    }

    function scriptKey(code) {
        return String(code.length) + ':' + code.slice(0, 96);
    }

    function isDataScriptContent(code) {
        code = String(code || '').trim();
        if (!code) return true;
        if (/^(?:out|in|vin|vout)~/.test(code)) return true;
        if (/;;(?:in|out|vin|vout)~/.test(code)) return true;
        if (/~[\d:]+\s*(?:~|;|$)/.test(code) && /;;/.test(code)) return true;
        if (code.length < 120 && /^[\u0400-\u04FF\s\d.,!?«»\-—:;()]+$/.test(code)) return true;
        if (/^data:image\//i.test(code) && !/\bfunction\b/.test(code)) return true;
        return false;
    }

    function isExecutableScript(code, node) {
        code = String(code || '').trim();
        if (!code || isDataScriptContent(code)) return false;
        if (/^\s*</.test(code)) return false;
        if (node) {
            if (node.classList && node.classList.contains('tavo-data-script')) return false;
            if (node.getAttribute && node.getAttribute('data-tavo-held') === '0') return false;
            var type = (node.getAttribute && node.getAttribute('type') || '').trim().toLowerCase();
            var held = node.getAttribute && node.getAttribute('data-tavo-held');
            if (type === 'text/plain' && held === '1') {
                // neutralized widget script — run via our executor
            } else if (type && type !== 'text/javascript' && type !== 'application/javascript' && type !== 'module') {
                return false;
            }
        }
        return /(?:function\s*\(|function\s+\w|\(\s*\)\s*=>|=>|\bconst\b|\blet\b|\bvar\b|addEventListener|querySelector|document\.|window\.|setInterval|setTimeout|requestAnimationFrame|classList|\.forEach\s*\(|new\s+Function)/i.test(code);
    }

    function neutralizeScriptsInHtml(html) {
        if (typeof html !== 'string' || !/<script\b/i.test(html)) return html;
        return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function(full, attrs, body) {
            if (/\btype\s*=\s*["']text\/plain["']/i.test(attrs)) return full;
            var cleanAttrs = attrs.replace(/\s*type\s*=\s*["'][^"']*["']/gi, '');
            return '<script type="text/plain" data-tavo-held="1"' + cleanAttrs + '>' + body + '</script>';
        });
    }

    function secureScriptNode(node) {
        if (!node || !node.tagName || node.tagName.toLowerCase() !== 'script') return;
        if (node.classList && node.classList.contains('tavo-data-script')) return;
        var type = (node.getAttribute('type') || '').toLowerCase();
        if (type === 'text/plain') {
            if (!node.getAttribute('data-tavo-held')) node.setAttribute('data-tavo-held', '1');
            return;
        }
        try {
            node.setAttribute('type', 'text/plain');
            node.setAttribute('data-tavo-held', '1');
            node.classList.add('tavo-held-script');
        } catch (e) {}
    }

    function secureDomScripts(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('script').forEach(secureScriptNode);
    }

    function installScriptGuard() {
        var chat = document.getElementById('chat');
        if (!chat) { setTimeout(installScriptGuard, 100); return; }
        new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    if (node.tagName && node.tagName.toLowerCase() === 'script') secureScriptNode(node);
                    if (node.querySelectorAll) secureDomScripts(node);
                });
            });
        }).observe(chat, { childList: true, subtree: true });
        secureDomScripts(chat);
    }

    function msgStableKey(messageId, msg) {
        return String(messageId) + ':' + String(msg && msg.swipe_id || 0);
    }

    function syncMesStableKey(messageId, mesText) {
        if (!mesText) return false;
        var ctx = SillyTavern.getContext();
        var msg = ctx.chat && ctx.chat[messageId];
        if (!msg) return false;
        var stable = msgStableKey(messageId, msg);
        if (mesText.getAttribute('data-tavo-stable') !== stable) {
            resetMesState(mesText);
            mesText.setAttribute('data-tavo-stable', stable);
            return true;
        }
        return false;
    }

    function markDataScript(node) {
        if (!node) return;
        try {
            node.setAttribute('type', 'text/plain');
            node.setAttribute('data-tavo-held', '0');
            if (node.classList) node.classList.add('tavo-data-script');
        } catch (e) {}
    }

    function isCleanStage(stage) {
        return stage === 'preShowdown' || stage === 'afterRegex' || stage === 'raw-regex' || stage === 'dom-script';
    }

    function shouldRunStage(stage) {
        return isCleanStage(stage);
    }

    var SKIP_MIRROR = { 'tavo-script': 1, 'tavo-done': 1 };
    var SKIP_PATCH = /^(mes_|edit_|swipe|token|fa-|menu_|monospace|metadata|ng-|text_p|ch_name|mes_img|flex-container|timestamp|mes_timer)/i;
    var WIDGET_SEL = [
        '.tavo-footer-v9', '.custom-tavo-footer-v9',
        '.tavo-header-v9', '.custom-tavo-header-v9',
        '.tavo-opt-widget', '.custom-tavo-opt-widget',
        '.ios-weather-pro', '.custom-ios-weather-pro',
        '.r-dlv-v2', '.custom-r-dlv-v2',
        '.wb-phone-widget-mini', '.custom-wb-phone-widget-mini',
        '.tavo-stream-card', '.custom-tavo-stream-card',
        '.r26-wallet', '.r26-note', '.g-search-mini-widget',
        '.adult-v1-widget', '[class*="gnav"]', '[class*="r26-"]',
        '[class*="imessage"]', '[class*="iMessage"]',
        '[class*="chat-app"]', '[class*="phone-widget"]',
        '[class*="bank"]', '[class*="Bank"]', '[class*="ios-bank"]'
    ].join(', ');
    var SVG_TAGS = { svg: 1, path: 1, g: 1, circle: 1, rect: 1, defs: 1, use: 1, clipPath: 1, linearGradient: 1, stop: 1 };

    function ensureWidgetAnimations(mesText) {
        if (!mesText) return;
        mesText.querySelectorAll('.tavo-opt-widget, [class*="tavo-footer"], [class*="tavo-header"], .ios-weather-pro').forEach(function(el) {
            if (el.classList) el.classList.remove('tavo-opt-offscreen');
        });
    }

    function isWidgetHtmlString(html) {
        if (typeof html !== 'string') return false;
        return /<\s*(?:style|script|svg|custom-style)\b/i.test(html)
            || /\[\[[A-Z][A-Z0-9_]+\|/.test(html)
            || /class\s*=\s*["'][^"']*(?:tavo-footer|tavo-header|ios-weather|imessage|iMessage|r-dlv|tab-btn|tavo-opt|bank|Bank)/i.test(html);
    }

    function isMesEditing(mesText) {
        if (!mesText) return false;
        return !!mesText.querySelector('#curEditTextarea, textarea.edit_textarea, .edit_textarea');
    }

    function shouldPatchEl(el) {
        if (!el || !el.classList) return false;
        var tag = el.nodeName ? el.nodeName.toLowerCase() : '';
        if (SVG_TAGS[tag] || tag === 'svg') return false;
        if (el.closest && el.closest('svg')) return false;
        if (el.matches && el.matches('textarea, button, .mes_timer, .tokenCounterDisplay, .edit_textarea, #curEditTextarea')) return false;
        if (el.closest && el.closest('.mes_buttons, .mes_edit_buttons')) return false;
        var cls = el.className;
        if (typeof cls === 'string' && SKIP_PATCH.test(cls)) return false;
        return true;
    }

    function pairNames(cls) {
        if (!cls || SKIP_MIRROR[cls]) return [];
        if (cls.indexOf('custom-') === 0) {
            var bare = cls.slice(7);
            return bare ? [cls, bare] : [cls];
        }
        return [cls, 'custom-' + cls];
    }

    function mirrorAllClasses(el) {
        if (!el || !el.classList) return;
        var have = Array.from(el.classList);
        var toAdd = [];
        have.forEach(function(cls) {
            pairNames(cls).forEach(function(n) {
                if (n && have.indexOf(n) === -1 && toAdd.indexOf(n) === -1) toAdd.push(n);
            });
        });
        if (!toAdd.length) return;
        syncing = true;
        try { nativeAdd.apply(el.classList, toAdd); } finally { syncing = false; }
    }

    function patchClassList(el) {
        if (!el || !el.classList || el.__tavoClsPatched) return;
        el.__tavoClsPatched = true;
        var cl = el.classList;
        cl.add = function() {
            syncing = true;
            try {
                for (var i = 0; i < arguments.length; i++) {
                    pairNames(arguments[i]).forEach(function(n) { nativeAdd.call(cl, n); });
                }
            } finally { syncing = false; }
        };
        cl.remove = function() {
            syncing = true;
            try {
                for (var i = 0; i < arguments.length; i++) {
                    pairNames(arguments[i]).forEach(function(n) { nativeRemove.call(cl, n); });
                }
            } finally { syncing = false; }
        };
        cl.toggle = function(name, force) {
            syncing = true;
            try {
                var pairs = pairNames(name);
                var result = nativeToggle.call(cl, pairs[0], force);
                for (var i = 1; i < pairs.length; i++) {
                    if (result) nativeAdd.call(cl, pairs[i]);
                    else nativeRemove.call(cl, pairs[i]);
                }
                return result;
            } finally { syncing = false; }
        };
    }

    function scopeCssForMes(css) {
        css = fixCssForParser(css);
        if (!css || /\.mes_text[\s.#\[]/.test(css)) return css;
        var preserved = [];
        css = css.replace(/@[^{]+{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, function(block) {
            preserved.push(block);
            return '/*__TAVO_AT_' + (preserved.length - 1) + '__*/';
        });
        css = css.replace(/(^|})\s*([^@{}][^{]+)\{/g, function(_m, before, selectors) {
            var parts = selectors.split(',').map(function(sel) { return sel.trim(); });
            if (parts.length && parts.every(function(p) {
                return /^(?:\d+(?:\.\d+)?%|from|to)$/i.test(p);
            })) return _m;
            var scoped = parts.map(function(sel) {
                if (!sel || sel.indexOf('.mes_text') === 0) return sel;
                return '.mes_text ' + sel;
            }).join(', ');
            return before + scoped + '{';
        });
        css = css.replace(/\/\*__TAVO_AT_(\d+)__\*\//g, function(_m, idx) {
            return preserved[Number(idx)] || '';
        });
        return css;
    }

    function injectCss(css) {
        if (!css) return;
        css = scopeCssForMes(String(css)).trim();
        if (!css || cssSet.has(css)) return;
        cssSet.add(css);
        var s = document.createElement('style');
        s.className = 'tavo-injected-style';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        stageHits['inject:style'] = (stageHits['inject:style'] || 0) + 1;
    }

    function patchWidgetTree(mesText) {
        if (!mesText || !mesText.querySelectorAll || isMesEditing(mesText)) return;
        var widgets = mesText.querySelectorAll(WIDGET_SEL);
        if (!widgets.length) return;
        widgets.forEach(function(widget) {
            if (shouldPatchEl(widget)) {
                patchClassList(widget);
                mirrorAllClasses(widget);
            }
            widget.querySelectorAll('[class]').forEach(function(el) {
                if (!shouldPatchEl(el)) return;
                patchClassList(el);
                mirrorAllClasses(el);
            });
        });
    }

    function ensureMesObserver(mesText) {
        if (!mesText || watchedMes.has(mesText)) return;
        watchedMes.add(mesText);
        var pending = [];
        var raf = 0;
        function flush() {
            raf = 0;
            if (syncing || isMesEditing(mesText)) return;
            cleanMesStyles(mesText);
            var nodes = pending.splice(0);
            var sawWidget = false;
            nodes.forEach(function(node) {
                if (node.nodeType !== 1) return;
                if ((node.matches && node.matches(WIDGET_SEL)) ||
                    (node.querySelector && node.querySelector(WIDGET_SEL))) {
                    sawWidget = true;
                }
                if (node.tagName === 'SCRIPT' || (node.querySelector && node.querySelector('script'))) {
                    sawWidget = true;
                }
            });
            if (!sawWidget) return;
            patchWidgetTree(mesText);
            // A widget (with its neutralised, not-yet-run scripts) just appeared in the DOM. This is
            // the reliable signal for reroll / swipe re-renders where no render event targets us.
            // Gated on an unrun held script so widget-built innerHTML (script-free) can't loop, and
            // suppressed mid-generation to avoid per-token thrash.
            if (!generating && mesText.querySelector('script[data-tavo-held="1"], script.tavo-held-script')) {
                var mesEl = mesText.closest && mesText.closest('.mes');
                var mid = mesEl && mesEl.getAttribute('mesid');
                if (mid != null) activateMessage(Number(mid), { force: true, delay: 60 });
            }
        }
        new MutationObserver(function(mutations) {
            if (syncing) return;
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) pending.push(node);
                });
            });
            if (pending.length && !raf) raf = requestAnimationFrame(flush);
        }).observe(mesText, { childList: true, subtree: true });
    }

    function fixStyleContent(raw, isCustomStyle) {
        if (!raw) return '';
        var css = raw;
        if (isCustomStyle) {
            try {
                css = decodeURIComponent(String(raw).replace(/<br\/?>/gi, ''));
            } catch (e) {
                return raw;
            }
        }
        css = fixCssForParser(css);
        if (isCustomStyle) {
            try { return encodeURIComponent(css); } catch (e) { return raw; }
        }
        return css;
    }

    function fixStylesInHtml(html) {
        if (typeof html !== 'string') return html;
        html = html.replace(/<custom-style[^>]*>([\s\S]*?)<\/custom-style>/gi, function(full, enc) {
            stageHits['fix:custom-style'] = (stageHits['fix:custom-style'] || 0) + 1;
            return full.replace(enc, fixStyleContent(enc, true));
        });
        html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function(full, css) {
            stageHits['fix:style'] = (stageHits['fix:style'] || 0) + 1;
            return full.replace(css, fixStyleContent(css, false));
        });
        return neutralizeScriptsInHtml(html);
    }

    function fixStyleNodeInPlace(node) {
        if (!node) return;
        var tag = node.nodeName ? node.nodeName.toLowerCase() : '';
        if (tag !== 'style' && tag !== 'custom-style') return;
        var raw = node.textContent || '';
        if (!raw.trim()) return;
        var fixed = fixStyleContent(raw, tag === 'custom-style');
        if (fixed && fixed !== raw) {
            try { node.textContent = fixed; } catch (e) {}
        }
    }

    function storeScript(code, stage) {
        if (!code || !String(code).trim()) return '';
        stageHits[stage + ':script'] = (stageHits[stage + ':script'] || 0) + 1;
        var idx = String(SEQ++);
        STORE.set(idx, { code: code, stage: stage });
        return '<span data-tavo-script="' + idx + '" style="display:none!important"></span>';
    }

    function captureWidgetCode(html, stage) {
        if (typeof html !== 'string' || !/<(?:style|script|[a-z][\w-]*[^>]*\bon[a-z]+)\b/i.test(html)) return html;
        noteCapture(stage);
        var keepScripts = isCleanStage(stage);
        html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function(full, css) {
            stageHits[stage + ':style'] = (stageHits[stage + ':style'] || 0) + 1;
            return full.replace(css, fixStyleContent(css, false));
        });
        html = html.replace(/<custom-style[^>]*>([\s\S]*?)<\/custom-style>/gi, function(full, enc) {
            stageHits[stage + ':custom-style'] = (stageHits[stage + ':custom-style'] || 0) + 1;
            return full.replace(enc, fixStyleContent(enc, true));
        });
        if (keepScripts) {
            html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(_full, js) {
                return storeScript(js, stage);
            });
        }
        html = html.replace(/<([a-z][\w-]*)([^>]+)>/gi, function(match, tag, attrs) {
            var replaced = false;
            var newAttrs = attrs.replace(/\bon([a-z]+)\s*=\s*(["'])([\s\S]*?)\2/gi, function(_m, ev, quote, code) {
                replaced = true;
                var idx = String(SEQ++);
                STORE.set('ev_' + idx, code);
                return 'data-tavo-ev-' + ev.toLowerCase() + '="' + idx + '"';
            });
            return replaced ? '<' + tag + newAttrs + '>' : match;
        });
        return html;
    }

    function absorbStyleNode(node) {
        if (!node) return;
        var tag = node.nodeName ? node.nodeName.toLowerCase() : '';
        var raw = node.textContent || '';
        if (!raw.trim()) return;
        if (tag === 'custom-style') {
            try { injectCss(decodeURIComponent(String(raw).replace(/<br\/?>/gi, ''))); } catch (e) {}
        } else {
            injectCss(fixCssForParser(raw));
        }
        try { node.remove(); } catch (e) {}
    }

    function removeCssErrorNodes(mesText) {
        var walker = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        var kill = [];
        while (walker.nextNode()) {
            if (walker.currentNode.data && walker.currentNode.data.indexOf('CSS ERROR:') !== -1) {
                kill.push(walker.currentNode);
            }
        }
        kill.forEach(function(n) {
            n.data = n.data.replace(/CSS ERROR:\s*[^\n]*/gi, '');
            if (!n.data.trim()) n.remove();
        });
    }

    function cleanMesStyles(mesText) {
        if (!mesText || isMesEditing(mesText)) return;
        removeCssErrorNodes(mesText);
        mesText.querySelectorAll('style, custom-style').forEach(absorbStyleNode);
    }

    function stripStylesFromHtml(html) {
        return fixStylesInHtml(html);
    }

    function wrapMakeHtml(inst) {
        if (!inst || inst.makeHtml.__tavoInstHooked) return;
        var orig = inst.makeHtml.bind(inst);
        inst.makeHtml = function(text) {
            if (typeof text === 'string') text = captureWidgetCode(text, 'preShowdown');
            return orig(text);
        };
        inst.makeHtml.__tavoInstHooked = true;
    }

    function hookShowdown() {
        try {
            var libs = window.SillyTavern && window.SillyTavern.libs;
            var sd = (libs && (libs.showdown || (libs.default && libs.default.showdown))) || window.showdown;
            if (!sd || !sd.Converter || !sd.Converter.prototype) return false;
            var proto = sd.Converter.prototype;
            if (!proto.makeHtml) return false;
            if (!proto.makeHtml.__tavoHooked) {
                var orig = proto.makeHtml;
                proto.makeHtml = function(text) {
                    if (typeof text === 'string') text = captureWidgetCode(text, 'preShowdown');
                    return orig.call(this, text);
                };
                proto.makeHtml.__tavoHooked = true;
            }
            if (!sd.Converter.__tavoCtorHooked) {
                var OrigCtor = sd.Converter;
                sd.Converter = function() {
                    var inst = new OrigCtor(...arguments);
                    wrapMakeHtml(inst);
                    return inst;
                };
                sd.Converter.prototype = OrigCtor.prototype;
                sd.Converter.__tavoCtorHooked = true;
            }
            window.__tavoShowdownHooked = true;
            noteCapture('showdown');
            log('showdown hooked');
            return true;
        } catch (e) {
            log('showdown hook failed: ' + e.message);
            return false;
        }
    }

    function hookDOMPurify() {
        var DP = window.DOMPurify;
        if (!DP || typeof DP.sanitize !== 'function') { setTimeout(hookDOMPurify, 100); return; }
        if (DP.__stJsHooked) return;

        var origSanitize = DP.sanitize;
        var WIDGET_TAGS = ['style', 'custom-style', 'script', 'svg', 'path', 'g', 'circle', 'rect', 'defs', 'use', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'mask', 'foreignObject'];
        var WIDGET_ATTR = ['style', 'class', 'id', 'd', 'fill', 'stroke', 'stroke-width', 'viewBox', 'xmlns', 'xlink:href', 'href', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'points', 'transform', 'opacity', 'mask', 'clip-path'];

        DP.sanitize = function(dirty, cfg) {
            cfg = cfg || {};
            cfg.ALLOW_DATA_ATTR = true;
            if (typeof dirty === 'string' && isWidgetHtmlString(dirty)) {
                noteCapture('dompurify-bypass');
                if (cfg.RETURN_DOM || cfg.RETURN_DOM_FRAGMENT) {
                    cfg.ADD_TAGS = (cfg.ADD_TAGS || []).concat(WIDGET_TAGS);
                    cfg.ADD_ATTR = (cfg.ADD_ATTR || []).concat(WIDGET_ATTR);
                    dirty = fixStylesInHtml(dirty);
                    return origSanitize.call(this, dirty, cfg);
                }
                return fixStylesInHtml(dirty);
            }
            return origSanitize.call(this, dirty, cfg);
        };
        DP.sanitize.__stJsWrapped = true;

        DP.__stJsHooked = true;
        noteCapture('dompurify');
        log('DOMPurify hooked (widget bypass)');
        if (DP.__tavoHooked) log('WARN: old tavo-hydrate also loaded — remove that folder');
    }

    hookDOMPurify();
    installScriptGuard();
    (function waitShowdown(tries) {
        if (hookShowdown() || tries > 100) return;
        setTimeout(function() { waitShowdown(tries + 1); }, 250);
    })(0);

    function detectStRoot() {
        var scripts = document.querySelectorAll('script[src]');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].getAttribute('src') || '';
            var m = src.match(/^(.*)\/scripts\/(?:script|lib)\.js/);
            if (m) return m[1];
        }
        return '';
    }

    function loadRegexEngine() {
        if (regexEngine) return Promise.resolve(regexEngine);
        var root = detectStRoot();
        var paths = [
            root ? root + '/scripts/extensions/regex/engine.js' : '',
            '/scripts/extensions/regex/engine.js',
            './scripts/extensions/regex/engine.js',
            '../extensions/regex/engine.js'
        ].filter(Boolean);
        var i = 0;
        function tryNext() {
            if (i >= paths.length) return Promise.resolve(null);
            var path = paths[i++];
            return import(path).then(function(mod) {
                if (mod && mod.getRegexedString && mod.regex_placement) {
                    regexEngine = mod;
                    noteCapture('regex-engine');
                    log('regex engine loaded');
                    return mod;
                }
                return tryNext();
            }).catch(function() { return tryNext(); });
        }
        return tryNext().then(function(mod) {
            if (!mod) log('ERROR: regex engine not loaded — scripts will not run');
            else patchRegexEngine(mod);
            return mod;
        });
    }

    function isContainerRegexScript(script) {
        return !!(script && script.findRegex && /\[\\s\\S\]/.test(String(script.findRegex)));
    }

    function filterApplicableScripts(scripts, placement, params) {
        params = params || {};
        var isMarkdown = params.isMarkdown;
        var isPrompt = params.isPrompt;
        var isEdit = params.isEdit;
        var depth = params.depth;
        return scripts.filter(function(script) {
            if (script.disabled || !script.findRegex) return false;
            var md = !!script.markdownOnly;
            var pr = !!script.promptOnly;
            if (!((md && isMarkdown) || (pr && isPrompt) || (!md && !pr && !isMarkdown && !isPrompt))) return false;
            if (isEdit && !script.runOnEdit) return false;
            if (typeof depth === 'number') {
                if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) return false;
                if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) return false;
            }
            return script.placement && script.placement.indexOf(placement) !== -1;
        });
    }

    function getRegexedStringOrdered(rawString, placement, params) {
        if (typeof rawString !== 'string' || !rawString || placement == null || !regexEngine) return rawString || '';
        params = params || {};
        try {
            var ext = (SillyTavern.getContext().extensionSettings) || window.extension_settings;
            if (ext && ext.disabledExtensions && ext.disabledExtensions.indexOf('regex') !== -1) return rawString;
        } catch (e) {}
        var scripts = regexEngine.getRegexScripts ? regexEngine.getRegexScripts({ allowedOnly: true }) : [];
        var applicable = filterApplicableScripts(scripts, placement, params);
        applicable.sort(function(a, b) {
            var ac = isContainerRegexScript(a) ? 1 : 0;
            var bc = isContainerRegexScript(b) ? 1 : 0;
            return ac - bc;
        });
        var result = rawString;
        var run = regexEngine.runRegexScript;
        if (typeof run !== 'function') return rawString;
        applicable.forEach(function(script) {
            result = run(script, result, { characterOverride: params.characterOverride });
        });
        if (applicable.length) noteCapture('regex-ordered');
        return result;
    }

    function patchRegexEngine(mod) {
        if (!mod || mod.__stJsRegexPatched) return;
        mod.getRegexedString = function(rawString, placement, params) {
            return getRegexedStringOrdered(rawString, placement, params || {});
        };
        mod.__stJsRegexPatched = true;
        noteCapture('regex-patch');
        log('regex order patched (inner markers before containers)');
    }

    function clearWidgetInitFlags(mesText) {
        if (!mesText) return;
        mesText.querySelectorAll('[class]').forEach(function(el) {
            if (!el.dataset) return;
            if (el.dataset.init) delete el.dataset.init;
            if (el.dataset.ready) delete el.dataset.ready;
            if (el.dataset.done) delete el.dataset.done;
            if (el.dataset.loaded) delete el.dataset.loaded;
            if (el.dataset.hydrated) delete el.dataset.hydrated;
        });
    }

    function extractStyleBlocks(html) {
        var blocks = [];
        if (!html) return blocks;
        html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function(_f, css) {
            var fixed = fixStyleContent(css, false);
            if (fixed && fixed.trim()) blocks.push(fixed);
            return '';
        });
        html.replace(/<custom-style[^>]*>([\s\S]*?)<\/custom-style>/gi, function(_f, enc) {
            try {
                var decoded = decodeURIComponent(String(enc).replace(/<br\/?>/gi, ''));
                var fixed = fixCssForParser(decoded);
                if (fixed && fixed.trim()) blocks.push(fixed);
            } catch (e) {}
            return '';
        });
        return blocks;
    }

    function injectStylesFromHtml(html) {
        extractStyleBlocks(html).forEach(injectCss);
    }

    function isMesTextEl(el) {
        return el && el.classList && el.classList.contains('mes_text');
    }

    function findRootForScriptNode(node, mesText) {
        if (!node || !mesText) return mesText;
        var parent = node.parentElement;
        // Faithful to document.currentScript.parentElement: script that lives inside a widget.
        if (parent && parent !== mesText && !isMesTextEl(parent)) {
            var w = parent.closest ? parent.closest(WIDGET_SEL) : null;
            return w || parent;
        }
        // Script is a direct child of .mes_text (e.g. footer sits before it) -> use preceding widget.
        var prev = node.previousElementSibling;
        while (prev) {
            if (prev.matches && prev.matches(WIDGET_SEL)) return prev;
            var inner = prev.querySelector && prev.querySelector(WIDGET_SEL);
            if (inner) return inner;
            prev = prev.previousElementSibling;
        }
        return findScriptRoot(mesText, '', 0);
    }

    // The regex output is the clean, canonical source. The DOM <script> textContent is frequently
    // mangled by the renderer (HTML entities, injected <em>/<br>, broken ${} template literals),
    // so whenever we have an aligned regex twin we use it. DOM code is only a last resort.
    function pickScriptSource(domCode, regexCode) {
        domCode = String(domCode || '').trim();
        regexCode = String(regexCode || '').trim();
        if (!regexCode) return domCode;
        return regexCode;
    }

    function getRegexExecutableScripts(regexed) {
        var list = [];
        var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        var m;
        while ((m = re.exec(regexed))) {
            var code = m[1];
            if (!isExecutableScript(code, null)) continue;
            list.push({
                code: code,
                hint: findWidgetRootHint(regexed.slice(0, m.index))
            });
        }
        return list;
    }

    function hasWidgetInMes(mesText) {
        if (!mesText) return false;
        if (mesText.querySelector(WIDGET_SEL)) return true;
        return !!mesText.querySelector('[class*="tavo-"], [class*="r26-"], [class*="g-search"], [class*="adult-v1"], [class*="gnav"]');
    }

    // Idempotency is delegated to each preset's own guard (root.dataset.init / window globals).
    // We never clear those guards on re-activation, so re-running is a safe no-op and never
    // double-binds. On a genuine DOM rebuild (edit / swipe / new generation) the widget elements
    // are new and guard-free, so init runs again cleanly. The clean script source always comes
    // from the regex output; the DOM <script> node only tells us where its widget root is.
    function runMessageScripts(mesText, regexed, scriptForce) {
        if (!mesText || isMesEditing(mesText)) return 0;
        secureDomScripts(mesText);
        var regexList = getRegexExecutableScripts(regexed);
        var domNodes = Array.from(mesText.querySelectorAll('script[data-tavo-held="1"], script.tavo-held-script'));
        var ran = 0;
        var rIdx = 0;

        domNodes.forEach(function(node) {
            var domCode = node.textContent || '';
            if (!domCode.trim()) {
                try { node.remove(); } catch (e) {}
                return;
            }
            if (!isExecutableScript(domCode, node)) {
                markDataScript(node);
                return;
            }
            var regexEntry = rIdx < regexList.length ? regexList[rIdx] : null;
            rIdx++;
            var code = regexEntry ? pickScriptSource(domCode, regexEntry.code) : domCode;
            var root = findRootForScriptNode(node, mesText);
            if (runScriptCode(mesText, code, root, 'dom-script')) {
                ran++;
                try { node.remove(); } catch (e) {}
            }
        });

        if (rIdx < regexList.length) {
            noteCapture('raw-regex');
            var counts = {};
            for (var i = rIdx; i < regexList.length; i++) {
                var entry = regexList[i];
                var idx = counts[entry.hint] || 0;
                counts[entry.hint] = idx + 1;
                var root = entry.hint ? findScriptRoot(mesText, entry.hint, idx) : findScriptRoot(mesText, '', 0);
                if (runScriptCode(mesText, entry.code, root, 'raw-regex')) ran++;
            }
        } else if (!domNodes.length && regexList.length && hasWidgetInMes(mesText)) {
            noteCapture('raw-regex');
            var counts2 = {};
            regexList.forEach(function(entry) {
                var idx = counts2[entry.hint] || 0;
                counts2[entry.hint] = idx + 1;
                var root = entry.hint ? findScriptRoot(mesText, entry.hint, idx) : findScriptRoot(mesText, '', 0);
                if (runScriptCode(mesText, entry.code, root, 'raw-regex')) ran++;
            });
        }

        if (ran) noteCapture('dom-scripts');
        return ran;
    }

    function clearWidgetInits(mesText) {
        if (!mesText) return;
        mesText.querySelectorAll(WIDGET_SEL).forEach(function(el) {
            if (el.dataset) {
                delete el.dataset.init;
                delete el.dataset.ready;
                delete el.dataset.done;
            }
        });
        clearWidgetInitFlags(mesText);
    }

    function runMesDomScripts(mesText, force) {
        if (!mesText || isMesEditing(mesText)) return 0;
        secureDomScripts(mesText);
        var nodes = mesText.querySelectorAll('script[data-tavo-held="1"], script.tavo-held-script');
        if (!nodes.length) return 0;
        if (force) {
            clearWidgetInits(mesText);
            ranScripts.delete(mesText);
            failedScripts.delete(mesText);
        }
        var ran = 0;
        Array.from(nodes).forEach(function(node) {
            var code = node.textContent || '';
            if (!code.trim()) { try { node.remove(); } catch (e) {} return; }
            if (!isExecutableScript(code, node)) {
                markDataScript(node);
                return;
            }
            var root = findRootForScriptNode(node, mesText);
            if (runScriptCode(mesText, code, root, 'dom-script')) {
                ran++;
                try { node.remove(); } catch (e) {}
            }
        });
        if (ran) noteCapture('dom-scripts');
        return ran;
    }

    function findScriptRoot(mesText, hint, index) {
        if (hint) {
            var byHint = findInDomByIndex(mesText, hint, index || 0);
            if (byHint) {
                if (byHint.matches && byHint.matches(WIDGET_SEL)) return byHint;
                var w = byHint.closest ? byHint.closest(WIDGET_SEL) : null;
                if (w) return w;
                return byHint;
            }
        }
        var selectors = [
            '.tavo-footer-v9', '.custom-tavo-footer-v9',
            '.tavo-header-v9', '.custom-tavo-header-v9',
            '.r-dlv-v2', '.custom-r-dlv-v2',
            '.ios-weather-pro', '.custom-ios-weather-pro',
            '[class*="imessage"]', '[class*="iMessage"]',
            '[class*="chat-app"]', '[class*="phone-widget"]',
            '[class*="bank"]', '[class*="Bank"]', '[class*="ios-bank"]',
            '.tavo-opt-widget', '.custom-tavo-opt-widget',
            '.wb-phone-widget-mini', '.custom-wb-phone-widget-mini',
            '.tavo-stream-card', '.custom-tavo-stream-card',
            '.r26-wallet', '.r26-note', '.g-search-mini-widget',
            '.adult-v1-widget', '[class*="gnav"]', '[class*="r26-"]'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var found = mesText.querySelector(selectors[i]);
            if (found) return found;
        }
        return mesText;
    }

    function resetMesState(mesText) {
        if (!mesText) return;
        processedMsgs.delete(mesText);
        ranScripts.delete(mesText);
        failedScripts.delete(mesText);
        if (mesText.dataset) {
            delete mesText.dataset.init;
            delete mesText.dataset.tavoOptObserved;
        }
        mesText.querySelectorAll('[data-init]').forEach(function(el) {
            delete el.dataset.init;
        });
        clearWidgetInits(mesText);
        mesText.querySelectorAll('[data-tavo-onclick]').forEach(function(el) {
            if (el.__tavoClickFn) {
                el.removeEventListener('click', el.__tavoClickFn);
                el.__tavoClickFn = null;
            }
            delete el.dataset.tavoOnclick;
        });
        EV_TYPES.forEach(function(ev) {
            var attr = 'data-tavo-ev-' + ev;
            mesText.querySelectorAll('[' + attr + ']').forEach(function(el) {
                el.removeAttribute(attr);
            });
        });
        mesText.querySelectorAll('[data-tavo-script]').forEach(function(el) {
            el.removeAttribute('data-tavo-done');
        });
        mesText.querySelectorAll('[class*="interactive-panel"]').forEach(function(el) {
            delete el.__tavoBorderSpin;
            el.removeAttribute('data-tavo-spin');
        });
    }

    function getRegexPlacement(msg) {
        if (!regexEngine) return null;
        if (msg.is_user) return regexEngine.regex_placement.USER_INPUT;
        if (msg.extra && msg.extra.type === 'narrator') return regexEngine.regex_placement.SLASH_COMMAND;
        return regexEngine.regex_placement.AI_OUTPUT;
    }

    function getRegexDepth(ctx, messageId) {
        var chat = ctx.chat || [];
        var usable = [];
        for (var i = 0; i < chat.length; i++) {
            if (!chat[i].is_system) usable.push({ message: chat[i], index: i });
        }
        var pos = -1;
        for (var j = 0; j < usable.length; j++) {
            if (usable[j].index === Number(messageId)) { pos = j; break; }
        }
        return (messageId >= 0 && pos !== -1) ? (usable.length - pos - 1) : undefined;
    }

    function msgProcessKey(messageId, msg) {
        var mes = msg.mes || '';
        var tail = mes.length > 0 ? mes.charCodeAt(mes.length - 1) : 0;
        return String(messageId) + ':' + String(msg.swipe_id || 0) + ':' + mes.length + ':' + tail;
    }

    function hasWidgetHtml(html) {
        return /<(?:style|script)\b/i.test(html) || /\bon[a-z]+\s*=/i.test(html);
    }

    function findInnermostOpenDivClass(before) {
        var stack = [];
        var re = /<\/?div\b[^>]*>/gi;
        var m;
        while ((m = re.exec(before))) {
            if (m[0].charAt(1) === '/') {
                if (stack.length) stack.pop();
            } else {
                var cls = m[0].match(/class\s*=\s*(["'])([^"']+)\1/i);
                stack.push(cls ? cls[2].trim().split(/\s+/)[0] : '');
            }
        }
        for (var i = stack.length - 1; i >= 0; i--) {
            if (stack[i]) return stack[i];
        }
        return '';
    }

    function findWidgetRootHint(before) {
        var hint = findInnermostOpenDivClass(before);
        if (hint) return hint;
        var tail = before.slice(-1200);
        var matches = tail.match(/<div\b[^>]*class\s*=\s*(["'])([^"']+)\1/gi);
        if (matches && matches.length) {
            var last = matches[matches.length - 1];
            var cm = last.match(/class\s*=\s*(["'])([^"']+)\1/i);
            if (cm) return cm[2].trim().split(/\s+/)[0];
        }
        return '';
    }

    function findInDomByIndex(mesText, className, index) {
        if (!className || !mesText) return null;
        var matches = [];
        mesText.querySelectorAll('[class]').forEach(function(el) {
            var list = Array.from(el.classList);
            if (list.indexOf(className) !== -1 || list.indexOf('custom-' + className) !== -1) {
                matches.push(el);
            }
        });
        return matches[index] || matches[0] || null;
    }

    function extractScriptChunks(html) {
        var chunks = [];
        var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        var match;
        while ((match = re.exec(html))) {
            var code = match[1];
            if (!isExecutableScript(code, null)) continue;
            chunks.push({
                code: code,
                hint: findWidgetRootHint(html.slice(0, match.index))
            });
        }
        return chunks;
    }

    function extractEventHandlers(html) {
        var handlers = [];
        var re = /<([a-z][\w-]*)([^>]*)\bon([a-z]+)\s*=\s*(["'])([\s\S]*?)\4/gi;
        var match;
        while ((match = re.exec(html))) {
            var attrs = match[2];
            var cls = attrs.match(/class\s*=\s*(["'])([^"']+)\1/i);
            var idm = attrs.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
            handlers.push({
                className: cls ? cls[2].trim().split(/\s+/)[0] : '',
                id: idm ? idm[2] : '',
                event: match[3].toLowerCase(),
                code: match[5]
            });
        }
        return handlers;
    }

    function wireHandlersFromRaw(mesText, html) {
        if (!mesText || isMesEditing(mesText)) return 0;
        var wired = 0;
        patchWidgetTree(mesText);

        var classCounts = {};
        extractEventHandlers(html).forEach(function(h) {
            if (!h.code) return;
            var el = null;
            if (h.id) {
                var esc = String(h.id).replace(/"/g, '\\"');
                el = mesText.querySelector('#' + esc);
            }
            if (!el && h.className) {
                var key = h.className + ':' + h.event;
                var idx = classCounts[key] || 0;
                classCounts[key] = idx + 1;
                el = findInDomByIndex(mesText, h.className, idx);
            }
            if (!el) return;
            var evAttr = 'data-tavo-ev-' + h.event;
            if (el.hasAttribute(evAttr)) return;
            if (h.event === 'click' && el.__tavoClickFn) {
                el.removeEventListener('click', el.__tavoClickFn);
                el.__tavoClickFn = null;
            }
            var storeIdx = String(SEQ++);
            STORE.set('ev_' + storeIdx, h.code);
            el.setAttribute('data-tavo-ev-' + h.event, storeIdx);
            if (h.event === 'click') {
                el.dataset.tavoOnclick = '1';
            }
            wired++;
        });

        noteCapture('raw-handlers');
        stageHits['raw:handlers'] = (stageHits['raw:handlers'] || 0) + wired;
        return wired;
    }

    function runScriptsFromRegex(mesText, regexed, force) {
        var chunks = extractScriptChunks(regexed);
        if (!chunks.length) return 0;
        noteCapture('raw-regex');
        if (force) {
            clearWidgetInits(mesText);
            ranScripts.delete(mesText);
        }
        var counts = {};
        var ran = 0;
        chunks.forEach(function(chunk) {
            var idx = counts[chunk.hint] || 0;
            counts[chunk.hint] = idx + 1;
            var root = chunk.hint ? findScriptRoot(mesText, chunk.hint, idx) : findScriptRoot(mesText, '', 0);
            if (runScriptCode(mesText, chunk.code, root, 'raw-regex')) ran++;
        });
        return ran;
    }

    function extractAndRunFromRaw(messageId, mesText, opts) {
        opts = opts || {};
        var force = !!opts.force;
        var reset = !!opts.reset;
        var finalize = !!opts.finalize;
        if (!regexEngine || !mesText || isMesEditing(mesText)) return false;
        var ctx = SillyTavern.getContext();
        var msg = ctx.chat && ctx.chat[messageId];
        if (!msg || !msg.mes) return false;
        var pkey = msgProcessKey(messageId, msg);
        // reset (edit / swipe / reroll) is the only path that clears preset init guards, and it is
        // always paired with a fresh DOM render, so no stale listeners survive to be double-bound.
        if (reset) resetMesState(mesText);
        var done = processedMsgs.get(mesText);
        if (!done) { done = new Set(); processedMsgs.set(mesText, done); }
        if (!force && !finalize && done.has(pkey)) return true;

        var placement = getRegexPlacement(msg);
        if (placement == null) return false;
        var regexed = neutralizeScriptsInHtml(getRegexedStringOrdered(msg.mes, placement, {
            characterOverride: msg.name || ctx.name2 || '',
            isMarkdown: true,
            depth: getRegexDepth(ctx, messageId)
        }));
        if (!hasWidgetHtml(regexed)) return false;

        done.add(pkey);
        secureDomScripts(mesText);
        cleanMesStyles(mesText);
        ensureMesObserver(mesText);
        injectStylesFromHtml(regexed);
        patchWidgetTree(mesText);

        var scriptForce = force || reset || finalize;
        runMessageScripts(mesText, regexed, scriptForce);
        wireHandlersFromRaw(mesText, regexed);
        ensureWidgetAnimations(mesText);

        var domPending = mesText.querySelector('script[data-tavo-held="1"], script.tavo-held-script');
        return !domPending;
    }

    function resolveScriptRoot(marker, mesText) {
        var parent = marker.parentElement;
        if (parent && parent !== mesText && (!parent.classList || !parent.classList.contains('mes_text'))) {
            return parent;
        }
        return mesText;
    }

    function isRetryableScriptError(msg) {
        return /Cannot (?:read|set) properties of (?:null|undefined)/i.test(msg || '');
    }

    function makeScopedDoc(mesText, root) {
        function pick(sel, all) {
            if (root && root.isConnected) {
                var fromRoot = all ? root.querySelectorAll(sel) : root.querySelector(sel);
                if (all ? fromRoot.length : fromRoot) return fromRoot;
            }
            if (mesText && mesText.isConnected) {
                var fromMes = all ? mesText.querySelectorAll(sel) : mesText.querySelector(sel);
                if (all ? fromMes.length : fromMes) return fromMes;
            }
            return all ? document.querySelectorAll(sel) : document.querySelector(sel);
        }
        return {
            querySelector: function(sel) { return pick(sel, false); },
            querySelectorAll: function(sel) { return pick(sel, true); },
            getElementById: function(id) {
                if (!id) return null;
                var esc = String(id).replace(/"/g, '');
                if (root && root.isConnected) {
                    var inRoot = root.querySelector('#' + esc);
                    if (inRoot) return inRoot;
                }
                if (mesText && mesText.isConnected) {
                    var inMes = mesText.querySelector('#' + esc);
                    if (inMes) return inMes;
                }
                return document.getElementById(id);
            }
        };
    }

    function patchScriptCode(code) {
        return code
            .replace(/document\.currentScript/g, '__tavoCS')
            .replace(/document\.querySelectorAll\b/g, '__tavoDoc.querySelectorAll')
            .replace(/document\.querySelector\b/g, '__tavoDoc.querySelector')
            .replace(/document\.getElementById\b/g, '__tavoDoc.getElementById');
    }

    function clearRootInit(root) {
        if (!root || !root.dataset) return;
        delete root.dataset.init;
        delete root.dataset.ready;
        delete root.dataset.done;
        delete root.dataset.loaded;
        delete root.dataset.hydrated;
    }

    // No cross-call dedup here: the preset's own guard (root.dataset.init / window flags) makes a
    // re-run a harmless no-op on an already-initialised widget, while a rebuilt widget (new element,
    // no guard) is correctly re-initialised. We only reset the guard on failure so a not-yet-ready
    // DOM can be retried on the next pass.
    function runScriptCode(mesText, code, rootEl, stage) {
        if (!code || !shouldRunStage(stage)) return true;
        var finalCode = repairScript(code);
        if (!isExecutableScript(finalCode, null)) return true;

        patchWidgetTree(mesText);
        var root = rootEl || mesText;
        if (root === mesText) root = findScriptRoot(mesText, '', 0);
        if (!root || !root.isConnected) return false;

        var currentScript = {
            get parentElement() { return root && root.isConnected ? root : mesText; },
            get parentNode() { return root && root.isConnected ? root : mesText; }
        };
        var scopedDoc = makeScopedDoc(mesText, root);
        var jq = window.jQuery || window.$;
        try {
            new Function('__tavoCS', '__tavoDoc', '$', 'jQuery', patchScriptCode(finalCode))(currentScript, scopedDoc, jq, jq);
            return true;
        } catch (e) {
            try {
                new Function('__tavoCS', '__tavoDoc', '$', 'jQuery', finalCode)(currentScript, scopedDoc, jq, jq);
                return true;
            } catch (e2) {
                clearRootInit(root);
                if (isRetryableScriptError(e2.message)) return false;
                log('Script [' + (stage || 'run') + '] ' + e2.message + ' | ' + finalCode.slice(0, 200).replace(/\s+/g, ' '));
                return false;
            }
        }
    }

    function postProcessMes(mesText) {
        if (!mesText || isMesEditing(mesText)) return;
        secureDomScripts(mesText);
        ensureMesObserver(mesText);
    }

    var isHydrating = false;
    var hydrateTimer = null;
    var BATCH = 8;

    function scheduleHydrate() {
        if (hydrateTimer) return;
        hydrateTimer = setTimeout(function() { hydrateTimer = null; hydrate(); }, 60);
    }

    function hydrateOne(marker) {
        var idx = marker.getAttribute('data-tavo-script') || '';
        var entry = STORE.get(idx);
        if (!entry || !shouldRunStage(entry.stage)) {
            marker.setAttribute('data-tavo-done', '1');
            STORE.delete(idx);
            return;
        }
        var mesText = marker.closest('.mes_text');
        if (mesText) postProcessMes(mesText);
        var rootEl = findRootForScriptNode(marker, mesText);
        if (runScriptCode(mesText, entry.code, rootEl, entry.stage)) {
            marker.setAttribute('data-tavo-done', '1');
            STORE.delete(idx);
        }
    }

    function hydrate() {
        if (isHydrating) return;
        var pending = document.querySelectorAll('[data-tavo-script]:not([data-tavo-done])');
        if (!pending.length) return;
        isHydrating = true;
        Array.from(pending).slice(0, BATCH).forEach(hydrateOne);
        isHydrating = false;
        if (document.querySelectorAll('[data-tavo-script]:not([data-tavo-done])').length) scheduleHydrate();
    }

    new MutationObserver(function() {
        if (isHydrating) return;
        if (document.querySelector('[data-tavo-script]:not([data-tavo-done])')) scheduleHydrate();
    }).observe(document.documentElement, { childList: true, subtree: true });

    function registerFormatterHook() {
        try {
            var ctx = SillyTavern.getContext();
            var mf = ctx.messageFormatter;
            if (!mf || typeof mf.addHook !== 'function') return false;
            if (mf.__tavoHooked) return true;
            var order = (mf.order && mf.order.EARLY != null) ? mf.order.EARLY : 10;
            var sAfterRegex = (mf.stage && mf.stage.AFTER_REGEX) || 'afterRegex';
            mf.addHook(function(mes) { return captureWidgetCode(mes, sAfterRegex); }, { stage: sAfterRegex, order: order });
            mf.__tavoHooked = true;
            noteCapture('formatter');
            log('messageFormatter hooked');
            return true;
        } catch (e) { return false; }
    }

    var streamingMesId = null;

    function activateMessage(messageId, opts) {
        opts = opts || {};
        if (messageId == null || messageId < 0) return;
        var gen = (activateGen.get(messageId) || 0) + 1;
        activateGen.set(messageId, gen);
        var prev = activateTimers.get(messageId);
        if (prev) clearTimeout(prev);
        var delay = opts.delay != null ? opts.delay : 80;
        activateTimers.set(messageId, setTimeout(function() {
            activateTimers.delete(messageId);
            runActivateMessage(messageId, opts, gen);
        }, delay));
    }

    function messageExpectsWidget(messageId) {
        var ctx = SillyTavern.getContext();
        var msg = ctx.chat && ctx.chat[messageId];
        return !!(msg && msg.mes && isWidgetHtmlString(msg.mes));
    }

    function runActivateMessage(messageId, opts, gen) {
        if (activateGen.get(messageId) !== gen) return;
        var mesText = document.querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
        if (!mesText) return;
        if (isMesEditing(mesText)) return;
        syncMesStableKey(messageId, mesText);
        if (opts.reset) resetMesState(mesText);
        secureDomScripts(mesText);
        postProcessMes(mesText);
        var attempt = 0;
        var maxAttempts = 10;
        var expectsWidget = messageExpectsWidget(messageId);
        var runOpts = {
            force: true,
            reset: !!opts.reset,
            finalize: !!opts.finalize
        };
        var run = function() {
            if (activateGen.get(messageId) !== gen || isMesEditing(mesText)) return;
            var runRaw = function() {
                var ok = regexEngine ? extractAndRunFromRaw(messageId, mesText, runOpts) : false;
                var pendingScript = mesText.querySelector('[data-tavo-script]:not([data-tavo-done])');
                var pendingDom = mesText.querySelector('script[data-tavo-held="1"], script.tavo-held-script');
                // If the message should show a widget but ST has not committed it to the DOM yet
                // (the reroll / swipe race), keep retrying until it appears rather than giving up.
                var notReady = expectsWidget && !hasWidgetInMes(mesText) && !pendingDom;
                if ((pendingScript || pendingDom || notReady || !ok) && attempt < maxAttempts - 1) {
                    attempt++;
                    runOpts.reset = false;
                    runOpts.finalize = false;
                    setTimeout(run, attempt < 3 ? 180 : (attempt < 6 ? 320 : 550));
                    return;
                }
                scheduleHydrate();
                ensureWidgetAnimations(mesText);
            };
            if (regexEngine) runRaw();
            else loadRegexEngine().then(runRaw);
        };
        requestAnimationFrame(run);
    }

    function rerenderMessageIfBroken(messageId) {
        var ctx = SillyTavern.getContext();
        var msg = ctx.chat && ctx.chat[messageId];
        if (!msg || !msg.mes || msg.mes.indexOf('[[') === -1) return false;
        var mesText = document.querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
        if (!mesText || !/\[\[/.test(mesText.textContent || '')) return false;
        try {
            if (typeof ctx.reloadMessage === 'function') { ctx.reloadMessage(messageId); return true; }
            if (typeof ctx.updateMessage === 'function') { ctx.updateMessage(messageId); return true; }
        } catch (e) {}
        return false;
    }

    function refreshAllMessages(opts) {
        document.querySelectorAll('#chat .mes').forEach(function(mesEl) {
            var id = mesEl.getAttribute('mesid');
            if (id != null) activateMessage(Number(id), opts || { force: true, delay: 0 });
        });
    }

    // Reroll / swipe do not reliably emit CHARACTER_MESSAGE_RENDERED, and GENERATION_ENDED's
    // argument is not a trustworthy message index across ST versions. So we target the actual last
    // message element in the DOM and re-activate it with staggered delays: the widget markup is
    // often written by ST slightly after the event fires (and sometimes rewritten once more). Every
    // activation is idempotent (preset guards + DOM-rebuild detection), so extra passes are safe.
    function getLastMessageId() {
        var mesEls = document.querySelectorAll('#chat .mes[mesid]');
        if (!mesEls.length) return null;
        var last = mesEls[mesEls.length - 1];
        var id = last.getAttribute('mesid');
        return id == null ? null : Number(id);
    }

    function activateLastMessage(opts) {
        var id = getLastMessageId();
        if (id != null && id >= 0) activateMessage(id, opts);
    }

    function bindST() {
        try {
            if (!window.__tavoShowdownHooked) hookShowdown();
            var ctx = SillyTavern.getContext();
            registerFormatterHook();
            loadRegexEngine().then(function() {
                document.querySelectorAll('#chat .mes').forEach(function(mesEl) {
                    var id = mesEl.getAttribute('mesid');
                    var mesText = mesEl.querySelector('.mes_text');
                    if (mesText && id != null) {
                        if (!rerenderMessageIfBroken(Number(id))) {
                            postProcessMes(mesText);
                            activateMessage(Number(id), { force: true, delay: 0 });
                        }
                    }
                });
                scheduleHydrate();
            });
            var es = ctx.eventSource;
            var et = ctx.eventTypes || ctx.event_types;
            if (et.GENERATION_STARTED) {
                es.on(et.GENERATION_STARTED, function() { generating = true; });
            }
            es.on(et.CHARACTER_MESSAGE_RENDERED, function(id) {
                generating = false;
                activateMessage(id, { force: true, delay: 80 });
            });
            es.on(et.USER_MESSAGE_RENDERED, function(id) {
                activateMessage(id, { force: true, delay: 50 });
            });
            es.on(et.MESSAGE_RECEIVED, function(id) {
                streamingMesId = Number(id);
                activateMessage(id, { force: true, delay: 120 });
            });
            es.on(et.MESSAGE_SWIPED, function(id) {
                activateMessage(id, { force: true, reset: true, delay: 220 });
                // Existing-swipe display: content is present now, but ST may re-render once more.
                // The DOM observer catches generated-swipe content; this covers the static case.
                activateLastMessage({ force: true, delay: 650 });
            });
            es.on(et.MESSAGE_UPDATED, function(id) {
                activateMessage(id, { force: true, delay: 150 });
            });
            es.on(et.MESSAGE_EDITED, function(id) {
                activateMessage(id, { force: true, reset: true, delay: 150 });
            });
            es.on(et.GENERATION_ENDED, function(chatLen) {
                streamingMesId = null;
                generating = false;
                var id = Number(chatLen) - 1;
                if (id >= 0) activateMessage(id, { force: true, finalize: true, delay: 150 });
                // Fallback for when the widget was committed mid-generation (observer suppressed) and
                // for ST versions whose event argument is not a message index. The retry loop inside
                // waits for the widget to actually be present in the DOM.
                activateLastMessage({ force: true, finalize: true, delay: 400 });
            });
            if (et.GENERATION_STOPPED) {
                es.on(et.GENERATION_STOPPED, function() {
                    generating = false;
                    activateLastMessage({ force: true, reset: true, delay: 300 });
                });
            }
            installScriptGuard();
            if (et.MORE_MESSAGES_LOADED) {
                es.on(et.MORE_MESSAGES_LOADED, function() {
                    setTimeout(function() { refreshAllMessages({ force: true, delay: 50 }); }, 200);
                });
            }
            es.on(et.CHAT_CHANGED, function() {
                setTimeout(function() { refreshAllMessages({ force: true, delay: 0 }); }, 300);
            });
            if (!window.__tavoShowdownHooked && !regexEngine) {
                log('WARN: no showdown hook yet; waiting for regex engine fallback');
            }
            try { window.toastr && window.toastr.success('SillyTavern JS v' + VERSION + ' loaded', 'SillyTavern JS'); } catch (_) {}
            log('SillyTavern bound');
            scheduleHydrate();
        } catch (e) {
            setTimeout(bindST, 500);
        }
    }

    setTimeout(bindST, 100);
    loadRegexEngine();
})();
