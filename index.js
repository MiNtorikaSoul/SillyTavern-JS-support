(function () {
    'use strict';

    var VERSION = '1.2';
    if (window.__stJs && window.__stJs.version === VERSION) return;
    window.__stJs = { version: VERSION };

    ['tavo-debug-btn', 'tavo-debug-panel'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });

    var errors = (window.__tavoErrors = []);
    (function hideTavoStyle() {
        var s = document.createElement('style');
        s.textContent = 'tavo-style{display:none!important}';
        (document.head || document.documentElement).appendChild(s);
    })();
    var cssSet = new Set();
    var stats = { widgets: 0, revived: 0, styles: 0, failed: 0 };
    var captureModes = [];
    var generating = false;

    var btn = document.createElement('div');
    btn.id = 'tavo-debug-btn';
    btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483647;background:#9a6a7a;color:#fff;padding:6px 10px;border-radius:10px;font-size:11px;font-family:sans-serif;cursor:pointer;opacity:.85;';
    btn.textContent = 'ST-JS';

    var panel = document.createElement('div');
    panel.id = 'tavo-debug-panel';
    panel.style.cssText = 'display:none;position:fixed;bottom:40px;right:10px;width:340px;max-height:60vh;overflow:auto;z-index:2147483647;background:#18171d;color:#e0d8e0;border:1px solid #7a4a58;padding:10px;border-radius:10px;font-size:11px;font-family:monospace;white-space:pre-wrap;';

    (function appendOverlay() {
        if (document.body) {
            document.body.appendChild(btn);
            document.body.appendChild(panel);
        } else {
            setTimeout(appendOverlay, 50);
        }
    })();

    btn.addEventListener('click', function () {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        renderPanel();
    });

    var panelPending = false;
    function renderPanel() {
        if (panelPending) return;
        panelPending = true;
        setTimeout(function () {
            panelPending = false;
            btn.textContent = 'ST-JS (' + errors.length + ')';
            if (panel.style.display !== 'block') return;
            panel.textContent =
                'Version: ' + VERSION +
                '\nWidgets seen: ' + stats.widgets +
                '\nScripts revived: ' + stats.revived +
                '\nScripts failed: ' + stats.failed +
                '\nStyles injected: ' + stats.styles +
                '\nDOMPurify hook: ' + !!window.__tavoDpHooked +
                '\nCapture: ' + (captureModes.join('+') || 'none') +
                '\nGenerating: ' + generating +
                '\n\n' + errors.slice(-30).join('\n');
        }, 120);
    }

    function log(msg) {
        errors.push(msg);
        if (errors.length > 200) errors.splice(0, errors.length - 200);
        renderPanel();
    }
    window.__tavoLog = log;

    function note(mode) {
        if (captureModes.indexOf(mode) === -1) captureModes.push(mode);
    }

    window.addEventListener('error', function (e) {
        if (e && e.message) log('JS: ' + e.message + (e.lineno ? ' @' + e.lineno : ''));
    });

    function decodeEntities(text) {
        if (!text || !/&(?:lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/.test(text)) return text;
        var t = document.createElement('textarea');
        t.innerHTML = text;
        return t.value;
    }

    function isDataScript(code) {
        code = String(code || '').trim();
        if (!code) return true;
        if (/^(?:out|in|vin|vout)~/.test(code)) return true;
        if (/;;(?:in|out|vin|vout)~/.test(code)) return true;
        if (/^data:image\//i.test(code) && !/\bfunction\b|=>/.test(code)) return true;
        return false;
    }

    function isWidgetHtml(html) {
        if (typeof html !== 'string') return false;
        return /<\s*(?:style|script|svg|custom-style|tavo-style|canvas|link)\b/i.test(html) ||
            /\[\[[A-Za-z][\w-]*\s*\|/.test(html);
    }

    function isEditing(mesText) {
        return !!(mesText && mesText.querySelector('#curEditTextarea, textarea.edit_textarea, .edit_textarea'));
    }

    function b64encode(str) {
        try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return ''; }
    }
    function b64decode(b64) {
        try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return ''; }
    }

    var TOKEN_RE = /%%TAVO64:([A-Za-z0-9+/=]+)%%/g;
    var CSS_TOKEN_RE = /%%TAVOCSS:([A-Za-z0-9+/=]+)%%/g;

    function protectBlock(open, body, close, prefix) {
        if (!body.trim() || body.indexOf('%%TAVO') !== -1) return open + body + close;
        var enc = b64encode(body);
        if (!enc) return open + body + close;
        return open + '%%' + (prefix || 'TAVO64') + ':' + enc + '%%' + close;
    }

    function preclean(body) {
        return body
            .replace(/<q>("[\s\S]*?")<\/q>/g, '$1')
            .replace(/\u00A8D/g, '$')
            .replace(/\u00A8T/g, '\u00A8');
    }

    function protectWidgetCode(text) {
        if (typeof text !== 'string' || !/<script\b|<style\b/i.test(text)) return text;
        note('pre-markdown');
        text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, function (_m, o, b, c) {
            return protectBlock(o, preclean(b), c);
        });
        text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_m, b) {
            return protectBlock('<tavo-style>', preclean(b), '</tavo-style>', 'TAVOCSS');
        });
        return text;
    }

    function restoreWidgetCode(text) {
        if (typeof text !== 'string' || text.indexOf('%%TAVO64:') === -1) return text;
        return text.replace(TOKEN_RE, function (_m, b64) { return b64decode(b64); });
    }

    function hookShowdown() {
        try {
            var libs = window.SillyTavern && window.SillyTavern.libs;
            var sd = (libs && (libs.showdown || (libs.default && libs.default.showdown))) || window.showdown;
            if (!sd) return false;

            var hookedSomething = false;

            if (typeof sd.subParser === 'function' && !sd.__tavoSubHooked) {
                var origMeta = sd.subParser('metadata');
                if (typeof origMeta === 'function') {
                    sd.subParser('metadata', function (text, options, globals) {
                        if (typeof text === 'string') text = protectWidgetCode(text);
                        return origMeta(text, options, globals);
                    });
                    sd.__tavoSubHooked = true;
                    hookedSomething = true;
                }
            }

            var proto = sd.Converter && sd.Converter.prototype;
            if (proto && typeof proto.makeHtml === 'function' && !proto.makeHtml.__tavoHooked) {
                var orig = proto.makeHtml;
                proto.makeHtml = function (text) {
                    if (typeof text === 'string') text = protectWidgetCode(text);
                    return orig.call(this, text);
                };
                proto.makeHtml.__tavoHooked = true;
                hookedSomething = true;
            }

            if (hookedSomething || sd.__tavoSubHooked) {
                note('showdown');
                log('showdown hooked');
                return true;
            }
            return false;
        } catch (e) {
            log('showdown hook failed: ' + e.message);
            return false;
        }
    }

    function compiles(code) {
        try { new Function(code); return true; } catch (e) { return false; }
    }

    function repairScript(code) {
        code = decodeEntities(code);
        code = code.replace(/<\/?(?:em|strong|b|i|u|s|del|q|p|mark|small|sub|sup|code|pre|span)\b[^>]*>/gi, '');
        code = code.replace(/<br\s*\/?>/gi, '\n');
        code = code.replace(/\uFFFE/g, '"');
        return code;
    }

    function neutralizeScripts(html) {
        if (typeof html !== 'string' || !/<script\b/i.test(html)) return html;
        return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function (full, attrs, body) {
            if (/data-tavo-held/i.test(attrs)) return full;
            var typeMatch = attrs.match(/\btype\s*=\s*["']([^"']*)["']/i);
            var origType = typeMatch ? typeMatch[1].trim().toLowerCase() : '';
            var executable = !origType || origType === 'text/javascript' ||
                origType === 'application/javascript' || origType === 'module';
            if (!executable) return full;
            var cleanAttrs = attrs.replace(/\s*\btype\s*=\s*["'][^"']*["']/gi, '');
            var keepType = origType === 'module' ? ' data-tavo-type="module"' : '';
            return '<script type="text/plain" data-tavo-held="1"' + keepType + cleanAttrs + '>' + body + '</script>';
        });
    }

    function secureScriptNode(node) {
        if (!node || node.tagName !== 'SCRIPT') return;
        if (node.getAttribute('data-tavo-ran')) return;
        var type = (node.getAttribute('type') || '').toLowerCase();
        if (type === 'text/plain') return;
        var orig = node.getAttribute('type');
        if (orig && !/^text\/javascript$|^application\/javascript$|^module$/i.test(orig)) {
            node.setAttribute('data-tavo-type', orig);
        } else if (orig === 'module') {
            node.setAttribute('data-tavo-type', 'module');
        }
        node.setAttribute('type', 'text/plain');
        node.setAttribute('data-tavo-held', '1');
    }

    function secureScriptsIn(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('script:not([type="text/plain"])').forEach(secureScriptNode);
    }

    var WIDGET_TAGS = ['style', 'custom-style', 'script', 'svg', 'path', 'g', 'circle', 'ellipse', 'rect',
        'line', 'polyline', 'polygon', 'defs', 'use', 'symbol', 'marker', 'pattern', 'image', 'text', 'tspan',
        'clipPath', 'linearGradient', 'radialGradient', 'stop', 'mask', 'filter', 'feGaussianBlur',
        'feColorMatrix', 'feOffset', 'feMerge', 'feMergeNode', 'feBlend', 'feFlood', 'feComposite',
        'feTurbulence', 'feDisplacementMap', 'foreignObject', 'canvas', 'audio', 'video', 'source', 'marquee', 'link', 'tavo-style'];
    var WIDGET_ATTR = ['style', 'class', 'id', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
        'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'viewBox', 'xmlns', 'xmlns:xlink',
        'xlink:href', 'href', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'points', 'transform', 'transform-origin', 'opacity', 'offset', 'stop-color', 'stop-opacity',
        'gradientUnits', 'gradientTransform', 'spreadMethod', 'fill-opacity', 'fill-rule', 'clip-path',
        'clip-rule', 'mask', 'filter', 'preserveAspectRatio', 'result', 'in', 'in2', 'stdDeviation', 'values',
        'type', 'baseFrequency', 'numOctaves', 'scale', 'dx', 'dy', 'controls', 'loop', 'autoplay', 'muted',
        'playsinline', 'poster', 'src', 'alt', 'contenteditable', 'draggable', 'tabindex', 'role', 'target',
        'rel', 'media', 'as', 'crossorigin', 'integrity', 'data-*'];

    function hookDOMPurify() {
        var DP = window.DOMPurify;
        if (!DP || typeof DP.sanitize !== 'function') {
            setTimeout(hookDOMPurify, 80);
            return;
        }
        if (DP.__tavoHooked) return;
        var orig = DP.sanitize;
        DP.sanitize = function (dirty, cfg) {
            cfg = cfg || {};
            if (typeof dirty === 'string' && isWidgetHtml(dirty)) {
                note('dompurify-bypass');
                cfg.ALLOW_DATA_ATTR = true;
                cfg.ADD_TAGS = (cfg.ADD_TAGS || []).concat(WIDGET_TAGS);
                cfg.ADD_ATTR = (cfg.ADD_ATTR || []).concat(WIDGET_ATTR);
                var neutral = neutralizeScripts(restoreWidgetCode(dirty));
                if (cfg.RETURN_DOM || cfg.RETURN_DOM_FRAGMENT) {
                    return orig.call(this, neutral, cfg);
                }
                return neutral;
            }
            return orig.call(this, dirty, cfg);
        };
        DP.sanitize.__tavoWrapped = true;
        DP.__tavoHooked = true;
        window.__tavoDpHooked = true;
        note('dompurify');
        log('DOMPurify hooked');
    }

    function expandCustomSelectors(css) {
        if (css.indexOf('.custom-') === -1) return css;
        css = css.replace(/\/\*[\s\S]*?\*\//g, '');
        return css.replace(/([^{};]+)(\{)/g, function (m, sel, brace) {
            if (sel.indexOf('.custom-') === -1 || /^\s*@/.test(sel)) return m;
            var extra = sel.split(',').filter(function (p) {
                return p.indexOf('.custom-') !== -1;
            }).map(function (p) {
                return p.replace(/\.custom-/g, '.');
            });
            if (!extra.length) return m;
            return sel + ',' + extra.join(',') + brace;
        });
    }

    function injectCss(css) {
        css = String(css || '').trim();
        if (!css) return;
        css = expandCustomSelectors(css);
        if (cssSet.has(css)) return;
        cssSet.add(css);
        var s = document.createElement('style');
        s.className = 'tavo-widget-style';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        stats.styles++;
    }

    var linkSet = new Set();
    function liftLinks(mesText) {
        var links = mesText.querySelectorAll('link[href]');
        if (!links.length) return;
        links.forEach(function (node) {
            var href = node.getAttribute('href') || '';
            if (!href || linkSet.has(href)) { try { node.remove(); } catch (e) {} return; }
            linkSet.add(href);
            var l = document.createElement('link');
            for (var i = 0; i < node.attributes.length; i++) {
                var a = node.attributes[i];
                try { l.setAttribute(a.name, a.value); } catch (e) {}
            }
            if (!l.getAttribute('rel')) l.setAttribute('rel', 'stylesheet');
            (document.head || document.documentElement).appendChild(l);
            try { node.remove(); } catch (e) {}
        });
        note('link-lift');
    }

    function liftStyles(mesText) {
        var nodes = mesText.querySelectorAll('style, custom-style, tavo-style');
        if (!nodes.length) return;
        nodes.forEach(function (node) {
            var tag = node.tagName.toLowerCase();
            if (tag === 'tavo-style') {
                var css2 = (node.textContent || '').replace(CSS_TOKEN_RE, function (_m, b64) { return b64decode(b64); });
                injectCss(css2);
                try { node.remove(); } catch (e) {}
                return;
            }
            var raw = restoreWidgetCode(node.textContent || '');
            var css = '';
            if (tag === 'custom-style') {
                try { css = decodeURIComponent(raw.replace(/<br\s*\/?>/gi, '')); }
                catch (e) { css = raw; }
            } else {
                css = decodeEntities(raw.replace(/<br\s*\/?>/gi, ''));
            }
            injectCss(css);
            try { node.remove(); } catch (e) {}
        });
        note('style-lift');
    }

    function reviveScript(oldNode) {
        var code = restoreWidgetCode(oldNode.textContent || '');
        if (!code.trim()) { try { oldNode.remove(); } catch (e) {} return; }
        if (isDataScript(code)) {
            oldNode.setAttribute('data-tavo-done', 'data');
            return;
        }
        var isModule = oldNode.getAttribute('data-tavo-type') === 'module';
        if (!isModule && !compiles(code)) {
            var fixed = repairScript(code);
            if (compiles(fixed)) {
                code = fixed;
                note('repair');
            } else {
                stats.failed++;
                oldNode.setAttribute('data-tavo-done', 'broken');
                log('script broken (syntax): ' + code.replace(/\s+/g, ' ').slice(0, 120));
                return;
            }
        }
        var s = document.createElement('script');
        var keepType = oldNode.getAttribute('data-tavo-type');
        if (keepType) s.type = keepType;
        for (var i = 0; i < oldNode.attributes.length; i++) {
            var a = oldNode.attributes[i];
            if (/^(?:type|data-tavo-held|data-tavo-type|data-tavo-done)$/i.test(a.name)) continue;
            try { s.setAttribute(a.name, a.value); } catch (e) {}
        }
        s.setAttribute('data-tavo-ran', '1');
        s.textContent = code;
        try {
            oldNode.parentNode.replaceChild(s, oldNode);
            stats.revived++;
        } catch (e) {
            stats.failed++;
            log('revive fail: ' + e.message);
        }
    }

    function reviveScriptsIn(mesText) {
        var held = mesText.querySelectorAll('script[data-tavo-held="1"]:not([data-tavo-done])');
        if (!held.length) return 0;
        var count = 0;
        Array.prototype.slice.call(held).forEach(function (node) {
            if (!node.isConnected) return;
            reviveScript(node);
            count++;
            if (mesText.dataset && mesText.dataset.init) delete mesText.dataset.init;
        });
        if (count) note('revive');
        return count;
    }

    function processMessage(mesText) {
        if (!mesText || isEditing(mesText)) return;
        secureScriptsIn(mesText);
        var hasHeld = mesText.querySelector('script[data-tavo-held="1"]:not([data-tavo-done])');
        var hasStyle = mesText.querySelector('style, custom-style, tavo-style, link[href]');
        if (!hasHeld && !hasStyle) return;
        stats.widgets++;
        if (hasHeld) {
            delete mesText.dataset.init;
        }
        liftLinks(mesText);
        liftStyles(mesText);
        reviveScriptsIn(mesText);
        renderPanel();
    }

    var procTimers = new WeakMap();
    function scheduleProcess(mesText, delay) {
        if (!mesText) return;
        if (procTimers.has(mesText)) clearTimeout(procTimers.get(mesText));
        procTimers.set(mesText, setTimeout(function () {
            procTimers.delete(mesText);
            processMessage(mesText);
        }, delay == null ? 40 : delay));
    }

    function mesTextById(id) {
        return document.querySelector('#chat .mes[mesid="' + id + '"] .mes_text');
    }

    function processById(id, delay) {
        var mt = mesTextById(id);
        if (mt) scheduleProcess(mt, delay);
    }

    function processLast(delay) {
        var mes = document.querySelectorAll('#chat .mes[mesid]');
        if (!mes.length) return;
        var mt = mes[mes.length - 1].querySelector('.mes_text');
        if (mt) scheduleProcess(mt, delay);
    }

    function processAll(delay) {
        document.querySelectorAll('#chat .mes .mes_text').forEach(function (mt) {
            scheduleProcess(mt, delay);
        });
    }

    function installObserver() {
        var chat = document.getElementById('chat');
        if (!chat) { setTimeout(installObserver, 100); return; }

        secureScriptsIn(chat);

        new MutationObserver(function (mutations) {
            if (generating) return;
            var touched = new Set();
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'SCRIPT') secureScriptNode(node);
                    else secureScriptsIn(node);
                    var mt = node.closest ? node.closest('.mes_text') : null;
                    if (!mt && node.querySelector) mt = node.querySelector('.mes_text');
                    if (mt) touched.add(mt);
                    else if (node.classList && node.classList.contains('mes_text')) touched.add(node);
                }
            }
            touched.forEach(function (mt) {
                if (mt.querySelector('script[data-tavo-held="1"]:not([data-tavo-done]), style, custom-style, tavo-style, link[href]')) {
                    scheduleProcess(mt, 30);
                }
            });
        }).observe(chat, { childList: true, subtree: true });
        note('observer');
    }

    function bindEvents() {
        var ctx;
        try { ctx = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext(); }
        catch (e) { ctx = null; }
        if (!ctx || !ctx.eventSource) { setTimeout(bindEvents, 200); return; }

        var es = ctx.eventSource;
        var et = ctx.eventTypes || ctx.event_types || {};

        function on(name, fn) { if (name && es.on) es.on(name, fn); }

        if (et.GENERATION_STARTED) on(et.GENERATION_STARTED, function () { generating = true; });
        on(et.CHARACTER_MESSAGE_RENDERED, function (id) { generating = false; processById(id, 40); });
        on(et.USER_MESSAGE_RENDERED, function (id) { processById(id, 40); });
        on(et.MESSAGE_EDITED, function (id) { processById(id, 60); });
        on(et.MESSAGE_UPDATED, function (id) { processById(id, 60); });
        on(et.MESSAGE_SWIPED, function (id) { processById(id, 80); processLast(300); });
        on(et.GENERATION_ENDED, function () { generating = false; processLast(80); processLast(500); });
        if (et.GENERATION_STOPPED) on(et.GENERATION_STOPPED, function () { generating = false; processLast(120); });
        if (et.MORE_MESSAGES_LOADED) on(et.MORE_MESSAGES_LOADED, function () { processAll(60); });
        on(et.CHAT_CHANGED, function () { setTimeout(function () { processAll(0); }, 200); });

        note('events');
        log('bound to ST events');
        processAll(0);
    }

    hookDOMPurify();
    installObserver();
    bindEvents();
    (function waitShowdown(tries) {
        if (hookShowdown() || tries > 120) return;
        setTimeout(function () { waitShowdown(tries + 1); }, 250);
    })(0);
    log('SillyTavern JS v' + VERSION + ' ready');
    try { window.toastr && window.toastr.success('SillyTavern JS v' + VERSION, 'SillyTavern JS'); } catch (e) {}
})();
