(function () {
    'use strict';
    var VERSION = '1.0';
    if (window.__stJs && window.__stJs.version === VERSION) return;
    window.__stJs = { version: VERSION };

    var CFG = {

        sanitizeMode: 'bypass',
        scopeQueries: true,
        debugButton: true
    };

    var executed = new Map();
    var injectedCss = new Set();
    var injectedFonts = new Set();
    var errors = [];
    var counters = { msgs: 0, extracted: 0, scripts: 0, failed: 0, styles: 0, fonts: 0 };
    var regexEngine = null;
    var engineTried = false;

    window.__tavoErrors = errors;
    function log(msg) { errors.push(msg); refreshOverlay(); }

    window.addEventListener('error', function (e) {
        if (e && e.filename) return;
        counters.failed++;
        log('Runtime: ' + ((e && e.message) || 'error'));
    });

    var __tavoOwner = null;
    var rafOwners = new Map();
    var intOwners = new Map();
    (function () {
        var origRaf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
        var origCaf = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : null;
        var origSetInt = window.setInterval.bind(window);
        function track(map, owner, id) { var s = map.get(owner) || new Set(); s.add(id); map.set(owner, s); }
        if (origRaf) {
            window.requestAnimationFrame = function (cb) {
                var owner = __tavoOwner;
                var id = origRaf(function (t) {
                    var prev = __tavoOwner; __tavoOwner = owner;
                    try { return cb(t); } finally { __tavoOwner = prev; }
                });
                if (owner) track(rafOwners, owner, id);
                return id;
            };
        }
        window.setInterval = function (fn, ms) {
            var owner = __tavoOwner;
            var rest = Array.prototype.slice.call(arguments, 2);
            var id = origSetInt(function () {
                var prev = __tavoOwner; __tavoOwner = owner;
                try { return fn.apply(null, rest); } finally { __tavoOwner = prev; }
            }, ms);
            if (owner) track(intOwners, owner, id);
            return id;
        };
        window.__tavoKillOwner = function (owner) {
            var r = rafOwners.get(owner); if (r) { r.forEach(function (id) { try { (origCaf || cancelAnimationFrame)(id); } catch (e) {} }); rafOwners.delete(owner); }
            var it = intOwners.get(owner); if (it) { it.forEach(function (id) { try { clearInterval(id); } catch (e) {} }); intOwners.delete(owner); }
        };
        var goneSince = new Map();
        window.__tavoGcLoops = function (force) {
            var now = Date.now();
            function sweep(map, cancel) {
                map.forEach(function (ids, owner) {
                    if (owner && owner.isConnected) { goneSince.delete(owner); return; }
                    var t = goneSince.get(owner) || now; goneSince.set(owner, t);

                    if (force || now - t > 15000) { ids.forEach(cancel); map.delete(owner); goneSince.delete(owner); }
                });
            }
            sweep(rafOwners, function (id) { try { (origCaf || cancelAnimationFrame)(id); } catch (e) {} });
            sweep(intOwners, function (id) { try { clearInterval(id); } catch (e) {} });
        };
    })();
    setInterval(function () { try { window.__tavoGcLoops(); } catch (e) {} }, 5000);

    var btn, panel;
    function buildOverlay() {
        if (!CFG.debugButton) return;
        var old = document.getElementById('tavo-debug-btn'); if (old) old.remove();
        var oldp = document.getElementById('tavo-debug-panel'); if (oldp) oldp.remove();
        btn = document.createElement('div');
        btn.id = 'tavo-debug-btn';
        btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#9a6a7a;color:#fff;padding:6px 10px;border-radius:10px;font-size:11px;font-family:sans-serif;cursor:pointer;';
        btn.textContent = 'ST-JS v' + VERSION + ' (0)';
        panel = document.createElement('div');
        panel.id = 'tavo-debug-panel';
        panel.style.cssText = 'display:none;position:fixed;bottom:40px;right:10px;width:340px;max-height:420px;overflow:auto;z-index:999999;background:#18171d;color:#e0d8e0;border:1px solid #7a4a58;padding:10px;border-radius:10px;font-size:11px;font-family:monospace;white-space:pre-wrap;';
        btn.addEventListener('click', function () {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            refreshOverlay();
        });
        (function attach() {
            if (document.body) { document.body.appendChild(btn); document.body.appendChild(panel); }
            else setTimeout(attach, 50);
        })();
    }
    var overlayPending = false;
    function refreshOverlay() {
        if (!btn || overlayPending) return;
        overlayPending = true;
        setTimeout(function () {
            overlayPending = false;
            btn.textContent = 'ST-JS v' + VERSION + ' (' + errors.length + ')';
            if (panel && panel.style.display === 'block') {
                panel.textContent =
                    'Version: ' + VERSION +
                    '\nRegex engine: ' + (!!regexEngine) +
                    '\nMessages processed: ' + counters.msgs +
                    '\nScripts found: ' + counters.extracted +
                    '\nScripts run: ' + counters.scripts +
                    '\nScripts failed: ' + counters.failed +
                    '\nStyles injected: ' + counters.styles +
                    '\nFonts injected: ' + counters.fonts +
                    '\n\n' + errors.slice(-30).join('\n');
            }
        }, 120);
    }

    function hash(s) {
        var h = 5381, i = s.length;
        while (i) h = (h * 33 ^ s.charCodeAt(--i)) >>> 0;
        return s.length + ':' + h.toString(36);
    }
    function decodeEntities(text) {
        if (!text || text.indexOf('&') === -1) return text;
        var t = document.createElement('textarea');
        t.innerHTML = text;
        return t.value;
    }

    var ttPolicy = null;
    function ensureTT() {
        if (ttPolicy !== null) return ttPolicy;
        try {
            if (window.trustedTypes && window.trustedTypes.createPolicy) {
                ttPolicy = window.trustedTypes.createPolicy('tavo-passthrough', { createHTML: function (s) { return s; } });
            }
        } catch (e) { ttPolicy = false; }
        return ttPolicy;
    }
    function controlDOMPurify() {
        var DP = window.DOMPurify;
        if (!DP || typeof DP.sanitize !== 'function') { setTimeout(controlDOMPurify, 100); return; }
        if (DP.__tavoControlled) return;
        DP.__tavoControlled = true;
        var orig = DP.sanitize;

        if (CFG.sanitizeMode === 'bypass') {
            DP.sanitize = function (dirty, cfg) {

                if (typeof dirty !== 'string') return orig.call(this, dirty, cfg);
                if (cfg && (cfg.RETURN_DOM || cfg.RETURN_DOM_FRAGMENT)) return orig.call(this, dirty, cfg);
                if (cfg && cfg.RETURN_TRUSTED_TYPE) { var p = ensureTT(); return p ? p.createHTML(dirty) : dirty; }
                return dirty;
            };
            log('DOMPurify bypassed (full passthrough)');
        } else {
            var ADD_TAGS = ['style', 'canvas', 'svg', 'use', 'path', 'g', 'defs', 'lineargradient',
                'radialgradient', 'stop', 'filter', 'fegaussianblur', 'femerge', 'femergenode',
                'fecolormatrix', 'feoffset', 'feblend', 'feflood', 'fecomposite', 'circle', 'rect',
                'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'clippath', 'mask',
                'pattern', 'symbol', 'marker', 'foreignobject', 'animate', 'animatetransform', 'animatemotion'];
            var ADD_ATTR = ['style', 'class', 'id', 'd', 'fill', 'stroke', 'stroke-width', 'cx', 'cy',
                'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'viewbox', 'preserveaspectratio',
                'transform', 'gradientunits', 'offset', 'stop-color', 'stop-opacity', 'fill-opacity',
                'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
                'opacity', 'width', 'height', 'fr', 'fx', 'fy', 'spreadmethod', 'filter', 'clip-path',
                'from', 'to', 'dur', 'repeatcount', 'begin', 'values', 'keytimes', 'attributename', 'type'];
            DP.sanitize = function (dirty, cfg) {
                cfg = cfg || {};
                cfg.ALLOW_DATA_ATTR = true;
                cfg.ADD_TAGS = (cfg.ADD_TAGS || []).concat(ADD_TAGS);
                cfg.ADD_ATTR = (cfg.ADD_ATTR || []).concat(ADD_ATTR);
                return orig.call(this, dirty, cfg);
            };
            log('DOMPurify relaxed (allowlist widened)');
        }
    }

    function detectStRoot() {
        var scripts = document.querySelectorAll('script[src]');
        for (var i = 0; i < scripts.length; i++) {
            var m = (scripts[i].getAttribute('src') || '').match(/^(.*)\/scripts\/(?:script|lib)\.js/);
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
        function next() {
            if (i >= paths.length) return Promise.resolve(null);
            var p = paths[i++];
            return import(p).then(function (mod) {
                if (mod && mod.getRegexedString) { regexEngine = mod; log('regex engine loaded'); return mod; }
                return next();
            }).catch(next);
        }
        return next().then(function (m) {
            engineTried = true;
            if (!m) log('ERROR: regex engine not found — marker widgets will not expand');
            return m;
        });
    }

    function expandRaw(raw) {
        if (typeof raw !== 'string' || !raw) return '';
        if (!regexEngine || typeof regexEngine.getRegexedString !== 'function') return '';
        var P = regexEngine.regex_placement || {};
        var placement = (P.AI_OUTPUT != null) ? P.AI_OUTPUT : 2;
        var variants = [
            [raw, placement, { isMarkdown: true, isPrompt: false }],
            [raw, placement, { isMarkdown: true }],
            [raw, placement]
        ];
        for (var i = 0; i < variants.length; i++) {
            try {
                var out = regexEngine.getRegexedString.apply(null, variants[i]);
                if (typeof out === 'string' && out.length) return out;
            } catch (e) {  }
        }
        return '';
    }

    function extractBlocks(html) {
        var styles = [], links = [], scripts = [];

        html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_f, css) { styles.push(css); return ''; });

        html.replace(/<link\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/gi, function (_f, _q, href) { links.push(href); return ''; });

        html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function (_f, js) { if (js && js.trim()) scripts.push(js); return ''; });
        return { styles: styles, links: links, scripts: scripts };
    }

    function injectCss(css) {
        if (!css) return;
        css = decodeEntities(String(css)).trim();
        if (!css || injectedCss.has(css)) return;
        injectedCss.add(css);
        var s = document.createElement('style');
        s.className = 'tavo-injected-style';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        counters.styles++;
    }
    function injectFont(href) {
        if (!href || injectedFonts.has(href)) return;
        injectedFonts.add(href);
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.className = 'tavo-injected-font';
        (document.head || document.documentElement).appendChild(l);
        counters.fonts++;
    }

    var TAG_NOISE = /<\/?(?:q|em|strong|b|i|u|s|del|ins|mark|small|sub|sup|code|pre|span|a|p|abbr|cite|big|tt|font|kbd|samp|var)\b[^>]*>/gi;
    function repairJs(code) {
        code = decodeEntities(String(code));
        code = code.replace(TAG_NOISE, '');
        code = code.replace(/<br\s*\/?>/gi, '\n');
        return code;
    }
    function repairCss(css, isCustom) {
        css = decodeEntities(String(css));
        if (isCustom && /%[0-9a-fA-F]{2}/.test(css)) { try { css = decodeURIComponent(css); } catch (e) {} }
        css = css.replace(TAG_NOISE, '').replace(/<br\s*\/?>/gi, '');
        return css;
    }
    function canonKey(code) { return hash(repairJs(code).replace(/\s+/g, '')); }

    function cleanCssErrorText(root) {
        try {
            var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            var hits = [], n;
            while ((n = walker.nextNode())) { if (/CSS ERROR:/.test(n.nodeValue || '')) hits.push(n); }
            hits.forEach(function (t) { t.nodeValue = t.nodeValue.replace(/CSS ERROR:[^\n]*/g, ''); });
            root.querySelectorAll('*').forEach(function (el) {
                if (!el.children.length && /^\s*CSS ERROR:/.test(el.textContent || '')) { try { el.remove(); } catch (e) {} }
            });
        } catch (e) {}
    }

    function runScript(code, mesText) {
        try {
            var s = document.createElement('script');
            s.className = 'tavo-exec';
            s.textContent = code;
            mesText.appendChild(s);
            counters.scripts++;
            return true;
        } catch (e) {
            counters.failed++;
            log('Script ' + e.message + ' | ' + code.slice(0, 140).replace(/\s+/g, ' '));
            return false;
        }
    }

    var EV_STORE = new Map();
    var EV_TYPES = ['click', 'input', 'change', 'mouseover', 'mouseout', 'keydown', 'keyup'];
    EV_TYPES.forEach(function (ev) {
        window.addEventListener(ev, function (e) {
            var el = e.target.closest ? e.target.closest('[data-tavo-ev-' + ev + ']') : null;
            if (!el) return;
            var code = EV_STORE.get(el.getAttribute('data-tavo-ev-' + ev));
            if (code) { try { new Function('event', code).call(el, e); } catch (err) { log('Event[' + ev + '] ' + err.message); } }
        }, true);
    });

    function getCtx() { try { return SillyTavern.getContext(); } catch (e) { return null; } }

    function processMessage(id, attempt) {
        attempt = attempt || 0;
        var ctx = getCtx();
        if (!ctx || !ctx.chat) return;
        var msg = ctx.chat[id];
        var mesEl = document.querySelector('#chat .mes[mesid="' + id + '"]');
        var mesText = mesEl && mesEl.querySelector('.mes_text');
        if (!msg || !mesText) return;
        if (mesText.querySelector('#curEditTextarea, textarea.edit_textarea')) return;

        var raw = typeof msg.mes === 'string' ? msg.mes : '';

        var cleanByKey = new Map();
        if (raw.indexOf('[[') !== -1 || raw.indexOf('<script') !== -1 || raw.indexOf('<style') !== -1) {
            var html = expandRaw(raw);
            if (!html && attempt < 8) { return void setTimeout(function () { processMessage(id, attempt + 1); }, 200); }
            if (html) {
                var b = extractBlocks(html);
                b.links.forEach(injectFont);
                b.styles.forEach(function (css) { injectCss(repairCss(css, false)); });
                b.scripts.forEach(function (code) { cleanByKey.set(canonKey(code), code); });
            }
        }

        mesText.querySelectorAll('style:not(.tavo-injected-style)').forEach(function (st) { injectCss(repairCss(st.textContent || '', false)); });
        mesText.querySelectorAll('custom-style').forEach(function (st) { injectCss(repairCss(st.textContent || '', true)); });

        mesText.querySelectorAll('style:not(.tavo-injected-style), custom-style').forEach(function (n) { try { n.remove(); } catch (e) {} });
        cleanCssErrorText(mesText);

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {

                mesText.querySelectorAll('script:not(.tavo-exec)').forEach(function (node) {
                    var domCode = repairJs(node.textContent || '');
                    if (!domCode.trim()) { try { node.remove(); } catch (e) {} return; }
                    var code = cleanByKey.get(canonKey(domCode)) || domCode;
                    counters.extracted++;
                    var s = document.createElement('script');
                    s.className = 'tavo-exec';
                    s.textContent = code;
                    __tavoOwner = node.parentNode || mesText;
                    try { node.replaceWith(s); counters.scripts++; }
                    catch (e) { counters.failed++; log('Script ' + e.message + ' | ' + code.slice(0, 120).replace(/\s+/g, ' ')); }
                    __tavoOwner = null;
                });
                counters.msgs++;
                refreshOverlay();
            });
        });
    }

    function resetMessage(id) { try { window.__tavoGcLoops(); } catch (e) {} }

    function processAll() {
        var ctx = getCtx();
        if (!ctx || !ctx.chat) return;
        document.querySelectorAll('#chat .mes').forEach(function (el) {
            var id = el.getAttribute('mesid');
            if (id != null) processMessage(Number(id));
        });
    }

    var reprocessTimers = new Map();
    function scheduleReprocess(id) {
        if (reprocessTimers.has(id)) clearTimeout(reprocessTimers.get(id));
        reprocessTimers.set(id, setTimeout(function () {
            reprocessTimers.delete(id);
            processMessage(id);
        }, 200));
    }
    function isRealRender(node) {
        if (node.nodeType !== 1) return false;
        if (node.classList && (node.classList.contains('tavo-exec') || node.classList.contains('tavo-injected-style') || node.classList.contains('tavo-injected-font'))) return false;
        var tag = node.tagName;
        if (tag === 'SCRIPT') return true;
        if (tag === 'CUSTOM-STYLE') return true;
        return !!(node.querySelector && node.querySelector('script:not(.tavo-exec), custom-style'));
    }
    function startChatObserver() {
        var chat = document.getElementById('chat');
        if (!chat) { setTimeout(startChatObserver, 300); return; }
        new MutationObserver(function (muts) {
            var ids = new Set();
            muts.forEach(function (m) {
                var mes = m.target && m.target.closest ? m.target.closest('#chat .mes') : null;
                if (!mes) return;
                for (var i = 0; i < m.addedNodes.length; i++) {
                    if (isRealRender(m.addedNodes[i])) { var id = mes.getAttribute('mesid'); if (id != null) ids.add(Number(id)); break; }
                }
            });
            ids.forEach(scheduleReprocess);
        }).observe(chat, { childList: true, subtree: true });

        setInterval(function () {
            try {
                document.querySelectorAll('#chat .mes').forEach(function (mes) {
                    var mt = mes.querySelector('.mes_text');
                    if (!mt) return;
                    if (mt.querySelector('custom-style, script:not(.tavo-exec)')) {
                        var id = mes.getAttribute('mesid');
                        if (id != null) scheduleReprocess(Number(id));
                    }
                });
            } catch (e) {}
        }, 1500);

        log('chat observer + poll active');
    }

    function bindST() {
        var ctx = getCtx();
        if (!ctx || !ctx.eventSource) { setTimeout(bindST, 300); return; }
        var es = ctx.eventSource;
        var et = ctx.eventTypes || ctx.event_types || {};
        function on(name, fn) { if (et[name]) es.on(et[name], fn); }

        loadRegexEngine().then(function () { processAll(); });
        startChatObserver();

        on('CHARACTER_MESSAGE_RENDERED', function (id) { setTimeout(function () { processMessage(Number(id)); }, 60); });
        on('USER_MESSAGE_RENDERED', function (id) { setTimeout(function () { processMessage(Number(id)); }, 40); });
        on('MESSAGE_UPDATED', function (id) { scheduleReprocess(Number(id)); });
        on('MESSAGE_EDITED', function (id) { scheduleReprocess(Number(id)); });
        on('MESSAGE_SWIPED', function (id) { scheduleReprocess(Number(id)); });
        on('GENERATION_ENDED', function (len) { var id = Number(len) - 1; if (id >= 0) setTimeout(function () { processMessage(id); }, 120); });
        on('MORE_MESSAGES_LOADED', function () { setTimeout(processAll, 200); });
        on('CHAT_CHANGED', function () {

            document.querySelectorAll('style.tavo-injected-style, link.tavo-injected-font').forEach(function (n) { n.remove(); });
            injectedCss.clear(); injectedFonts.clear();
            try { window.__tavoGcLoops(true); } catch (e) {}
            counters = { msgs: 0, extracted: 0, scripts: 0, failed: 0, styles: 0, fonts: 0 };
            setTimeout(processAll, 300);
        });

        try { window.toastr && window.toastr.success('SillyTavern JS v' + VERSION + ' loaded', 'SillyTavern JS'); } catch (e) {}
        log('SillyTavern bound');
        refreshOverlay();
    }

    buildOverlay();
    controlDOMPurify();
    bindST();
    log('SillyTavern JS v' + VERSION + ' init');
})();
