(function () {
    'use strict';

    var VERSION = '2.0';
    if (window.__stJs && window.__stJs.version === VERSION) return;
    window.__stJs = { version: VERSION };

    var MODE = 'frame';
    try { if (localStorage.getItem('stjs_mode') === 'inline') MODE = 'inline'; } catch (e) {}

    ['tavo-debug-btn', 'tavo-debug-panel', 'st-js-debug-panel', 'st-js-base'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });

    var errors = (window.__tavoErrors = []);
    var cssSet = new Set();
    var stats = { widgets: 0, frames: 0, revived: 0, styles: 0, failed: 0 };
    var captureModes = [];

    (function baseStyle() {
        var PROSE = 'p,blockquote,ul,ol,li,h1,h2,h3,h4,h5,h6,pre,hr,br,q,em,i,strong,b,u,s,del,small,code,a,img,font,span:not([class]):not([style])';
        var ROOTS = [
            ':where(.mes_text)>:where(:not(' + PROSE + '))',
            ':where(.mes_text) :where(p,li,blockquote,h1,h2,h3,h4,h5,h6) :where([class],[style])'
        ];
        var s = document.createElement('style');
        s.id = 'st-js-base';
        s.textContent =
            ROOTS.join(',') + '{text-shadow:none}' +
            ROOTS.map(function (r) { return r + ' :where(*)'; }).join(',') + '{text-shadow:inherit}' +
            'tavo-style{display:none!important}' +
            '.stjs-host{display:block;width:100%;min-width:0;}' +
            '.stjs-host>template{display:none!important}' +
            'iframe.stjs-frame{display:block;width:100%;border:0;margin:0;padding:0;background:transparent;overflow:hidden;}' +
            '.stjs-preview{white-space:normal}' +
            '@media (max-width:900px), (pointer:coarse){#tavo-debug-btn{display:none!important}}';
        (document.head || document.documentElement).appendChild(s);
    })();

    var isMobileUi = (function () {
        try { return window.matchMedia('(max-width:900px), (pointer:coarse)').matches; }
        catch (e) { return Math.min(screen.width, screen.height) <= 900; }
    })();

    var btn = null, panel = null, panelBody = null, panelPending = false;

    function ensureOverlay(withButton) {
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'st-js-debug-panel';
            panel.style.cssText = 'display:none;position:fixed;bottom:40px;right:10px;width:340px;max-width:calc(100vw - 20px);max-height:60vh;overflow:auto;z-index:2147483647;background:#18171d;color:#e0d8e0;border:1px solid #7a4a58;padding:10px;border-radius:10px;font-size:11px;font-family:monospace;white-space:pre-wrap;text-shadow:none;-webkit-user-select:text;user-select:text;';
            var close = document.createElement('div');
            close.textContent = '✕ закрыть';
            close.style.cssText = 'text-align:right;cursor:pointer;color:#c99aaa;padding:2px 0 6px;font-family:sans-serif;';
            close.addEventListener('click', function () { panel.style.display = 'none'; });
            panelBody = document.createElement('div');
            panel.appendChild(close);
            panel.appendChild(panelBody);
        }
        if (withButton && !btn) {
            btn = document.createElement('div');
            btn.id = 'tavo-debug-btn';
            btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483647;background:#9a6a7a;color:#fff;padding:6px 10px;border-radius:10px;font-size:11px;font-family:sans-serif;cursor:pointer;opacity:.85;text-shadow:none;';
            btn.textContent = 'ST-JS';
            btn.addEventListener('click', function () { toggleDebug(); });
        }
        (function append() {
            if (!document.body) { setTimeout(append, 50); return; }
            if (btn && !btn.isConnected) document.body.appendChild(btn);
            if (!panel.isConnected) document.body.appendChild(panel);
        })();
    }

    function toggleDebug(force) {
        ensureOverlay(false);
        var show = typeof force === 'boolean' ? force : panel.style.display !== 'block';
        panel.style.display = show ? 'block' : 'none';
        if (isMobileUi) {
            panel.style.top = '60px';
            panel.style.bottom = 'auto';
            panel.style.left = '10px';
            panel.style.width = 'auto';
        }
        renderPanel();
    }

    function renderPanel() {
        if (!panel || panelPending) return;
        panelPending = true;
        setTimeout(function () {
            panelPending = false;
            if (btn) btn.textContent = 'ST-JS (' + errors.length + ')';
            if (panel.style.display !== 'block') return;
            var live = document.querySelectorAll('iframe.stjs-frame').length;
            panelBody.textContent =
                'Version: ' + VERSION + '   Mode: ' + MODE +
                '\nFrames on screen: ' + live + ' (mounted total: ' + stats.frames + ')' +
                '\nWidget renders: ' + stats.widgets +
                '\nInline scripts revived: ' + stats.revived + ', failed: ' + stats.failed +
                '\nInline styles injected: ' + stats.styles +
                '\nDOMPurify hook: ' + !!window.__tavoDpHooked +
                '\nCapture: ' + (captureModes.join('+') || 'none') +
                '\n\n/stjs — эта панель' +
                '\n/stjs frame — каждая плашка в своём iframe (по умолчанию)' +
                '\n/stjs inline — плашки прямо в чате, без изоляции' +
                '\n\n' + (errors.length ? errors.slice(-40).join('\n') : '(ошибок нет)');
        }, 100);
    }

    window.__stJs.debug = toggleDebug;
    if (!isMobileUi) ensureOverlay(true);

    function log(msg) {
        errors.push(String(msg));
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
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        log('Promise: ' + String(r && r.message ? r.message : r).slice(0, 200));
    });

    function decodeEntities(text) {
        if (!text || !/&(?:lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/.test(text)) return text;
        var t = document.createElement('textarea');
        t.innerHTML = text;
        return t.value;
    }

    function b64encode(str) {
        try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return ''; }
    }
    function b64decode(b64) {
        try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return ''; }
    }

    function hashStr(s) {
        var h = 5381, i = s.length;
        while (i) h = (h * 33) ^ s.charCodeAt(--i);
        return (h >>> 0).toString(36) + ':' + s.length;
    }

    function isWidgetHtml(html) {
        if (typeof html !== 'string') return false;
        return /<\s*(?:style|script|svg|custom-style|tavo-style|canvas|link|iframe|video|audio)\b/i.test(html) ||
            /%%TAVO(?:64|CSS):/.test(html) ||
            /<(?:div|section|article|aside|header|footer|nav|table|figure|details)\b[^>]*\b(?:style|class)\s*=/i.test(html) ||
            /\[\[[A-Za-z][\w-]*\s*\|/.test(html);
    }

    function isDataScript(code) {
        code = String(code || '').trim();
        if (!code) return true;
        if (/^(?:out|in|vin|vout)~/.test(code)) return true;
        if (/;;(?:in|out|vin|vout)~/.test(code)) return true;
        if (/^data:image\//i.test(code) && !/\bfunction\b|=>/.test(code)) return true;
        return false;
    }

    function isEditing(mesText) {
        return !!(mesText && mesText.querySelector('#curEditTextarea, textarea.edit_textarea, .edit_textarea'));
    }

    function getCtx() {
        try { return window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext(); }
        catch (e) { return null; }
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
            .replace(/<q>(["“«「『＂][\s\S]*?["”»」』＂])<\/q>/g, '$1')
            .replace(/¨D/g, '$')
            .replace(/¨T/g, '¨');
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

    function restoreAll(html) {
        html = restoreWidgetCode(html);
        html = html.replace(/<tavo-style>\s*%%TAVOCSS:([A-Za-z0-9+/=]+)%%\s*<\/tavo-style>/g, function (_m, b64) {
            return '<style>' + b64decode(b64) + '</style>';
        });
        html = html.replace(/<tavo-style>([\s\S]*?)<\/tavo-style>/g, '<style>$1</style>');
        html = html.replace(/<custom-style>([\s\S]*?)<\/custom-style>/g, function (_m, enc) {
            var css;
            try { css = decodeURIComponent(enc); } catch (e) { css = enc; }
            return '<style>' + css.replace(/<br\s*\/?>/gi, '') + '</style>';
        });
        return html;
    }

    function hookShowdown() {
        try {
            var libs = window.SillyTavern && window.SillyTavern.libs;
            var sd = (libs && (libs.showdown || (libs.default && libs.default.showdown))) || window.showdown;
            if (!sd) return false;
            var hooked = false;
            if (typeof sd.subParser === 'function' && !sd.__tavoSubHooked) {
                var origMeta = sd.subParser('metadata');
                if (typeof origMeta === 'function') {
                    sd.subParser('metadata', function (text, options, globals) {
                        if (typeof text === 'string') text = protectWidgetCode(text);
                        return origMeta(text, options, globals);
                    });
                    sd.__tavoSubHooked = true;
                    hooked = true;
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
                hooked = true;
            }
            if (hooked || sd.__tavoSubHooked) {
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

    function isMessageSanitize(cfg) {
        if (!cfg || cfg.RETURN_DOM || cfg.RETURN_DOM_FRAGMENT) return false;
        if (cfg.MESSAGE_SANITIZE) return true;
        return Array.isArray(cfg.ADD_TAGS) && cfg.ADD_TAGS.indexOf('custom-style') !== -1;
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

    var PROSE_TAGS = /^(?:P|BLOCKQUOTE|UL|OL|H[1-6]|HR|BR|Q|EM|I|STRONG|B|U|S|DEL|SMALL|CODE|PRE|A|FONT|SPAN|IMG|SUB|SUP|MARK|TABLE)$/;
    var renderSeq = 0;

    function classifyNode(n) {
        if (n.nodeType === 3) return /\S/.test(n.data) ? 'prose' : 'ws';
        if (n.nodeType !== 1) return 'ws';
        var tag = n.tagName;
        if (tag === 'SCRIPT') return 'script';
        if (tag === 'STYLE' || tag === 'LINK' || tag === 'TAVO-STYLE' || tag === 'CUSTOM-STYLE') return 'style';
        if ((tag === 'P' || tag === 'BR') && !/\S/.test(n.textContent) && !n.querySelector('img,svg,canvas,video,audio,iframe,script')) return 'ws';
        if (PROSE_TAGS.test(tag)) {
            var widgety = n.hasAttribute('class') ||
                (tag === 'SPAN' && n.hasAttribute('style')) ||
                (tag === 'TABLE' && n.hasAttribute('style')) ||
                n.querySelector('script,style,svg,canvas,video,audio,iframe,link,[class]');
            return widgety ? 'container' : 'prose';
        }
        return 'container';
    }

    function isHiddenNode(n) {
        if (n.nodeType !== 1) return true;
        if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return true;
        return /display\s*:\s*none/i.test(n.getAttribute('style') || '');
    }

    function serialize(nodes) {
        var t = document.createElement('template');
        nodes.forEach(function (n) { t.content.appendChild(n); });
        return t.innerHTML;
    }

    function splitForFrames(html, sanitizeProse) {
        var src = document.createElement('template');
        src.innerHTML = html;
        var segs = [], styles = [], pending = [], last = null;
        Array.prototype.slice.call(src.content.childNodes).forEach(function (n) {
            if (n.nodeType !== 1 || !/^(?:P|DIV|SPAN)$/.test(n.tagName)) return;
            if (n.tagName !== 'P' && (n.attributes.length || n.querySelector('*:not(style):not(link):not(script):not(br):not(tavo-style)'))) return;
            n.querySelectorAll('style,link,tavo-style').forEach(function (st) { st.remove(); styles.push(st); });
            var rest = Array.prototype.slice.call(n.childNodes).filter(function (c) {
                return !(c.nodeType === 3 && !/\S/.test(c.data)) && !(c.nodeType === 1 && c.tagName === 'BR');
            });
            if (rest.length && rest.every(function (c) { return c.nodeType === 1 && c.tagName === 'SCRIPT'; })) {
                rest.forEach(function (c) { src.content.insertBefore(c, n); });
                n.remove();
            } else if (!rest.length) {
                n.remove();
            }
        });
        Array.prototype.slice.call(src.content.childNodes).forEach(function (n) {
            var kind = classifyNode(n);
            if (kind === 'ws') { if (last) last.nodes.push(n); return; }
            if (kind === 'style') { styles.push(n); return; }
            if (kind === 'prose') {
                if (!last || last.w) { last = { w: false, nodes: [] }; segs.push(last); }
                last.nodes.push(n);
                return;
            }
            if (kind === 'script') {
                if (last && last.w) last.nodes.push(n); else pending.push(n);
                return;
            }
            var vis = !isHiddenNode(n);
            if (last && last.w && !(vis && last.vis)) {
                last.nodes.push(n);
                if (vis) last.vis = true;
            } else {
                last = { w: true, vis: vis, nodes: pending.concat([n]) };
                pending = [];
                segs.push(last);
            }
        });
        var wsegs = segs.filter(function (g) { return g.w; });
        if (pending.length) {
            if (wsegs.length) wsegs[wsegs.length - 1].nodes = wsegs[wsegs.length - 1].nodes.concat(pending);
            else { last = { w: true, vis: false, nodes: pending }; segs.push(last); wsegs.push(last); }
        }
        if (!wsegs.length && styles.length) {
            last = { w: true, vis: false, nodes: [] }; segs.push(last); wsegs.push(last);
        }
        var styleHtml = serialize(styles);
        var rid = ++renderSeq;
        var out = '';
        segs.forEach(function (g, i) {
            if (!g.w) {
                var prose = serialize(g.nodes);
                out += /\S/.test(prose) ? sanitizeProse(prose) : prose;
                return;
            }
            var body = (styleHtml + serialize(g.nodes)).replace(/<\/template>/gi, '<\\/template>');
            out += '<div class="stjs-host" data-stjs-r="' + rid + '" data-stjs-i="' + i + '"><template class="stjs-src">' + body + '</template></div>';
        });
        return out;
    }

    function hookDOMPurify() {
        var DP = window.DOMPurify;
        if (!DP || typeof DP.sanitize !== 'function') { setTimeout(hookDOMPurify, 80); return; }
        if (DP.__tavoHooked) return;
        var orig = DP.sanitize;
        DP.sanitize = function (dirty, cfg) {
            cfg = cfg || {};
            if (typeof dirty === 'string' && isWidgetHtml(dirty)) {
                stats.widgets++;
                if (MODE === 'frame' && isMessageSanitize(cfg)) {
                    note('frame');
                    try {
                        var self = this;
                        return splitForFrames(restoreAll(dirty), function (prose) {
                            return orig.call(self, prose, Object.assign({}, cfg));
                        });
                    } catch (e) {
                        log('split fail: ' + e.message);
                    }
                }
                note('dompurify-bypass');
                cfg.ALLOW_DATA_ATTR = true;
                cfg.ADD_TAGS = (cfg.ADD_TAGS || []).concat(WIDGET_TAGS);
                cfg.ADD_ATTR = (cfg.ADD_ATTR || []).concat(WIDGET_ATTR);
                var neutral = neutralizeScripts(restoreWidgetCode(dirty));
                if (cfg.RETURN_DOM || cfg.RETURN_DOM_FRAGMENT) return orig.call(this, neutral, cfg);
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

    var fontCssCache = null;
    function collectFontCss() {
        if (fontCssCache !== null) return fontCssCache;
        var out = [];
        var sheets = document.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
            var sh = sheets[i], rules;
            try { rules = sh.cssRules; } catch (e) { continue; }
            if (!rules) continue;
            var base = sh.href || location.href;
            for (var j = 0; j < rules.length; j++) {
                var r = rules[j];
                if (r.type !== 5) continue;
                out.push(r.cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (m, q, u) {
                    if (/^(?:data:|blob:|https?:)/i.test(u)) return m;
                    try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; }
                }));
            }
        }
        fontCssCache = out.join('\n');
        return fontCssCache;
    }

    var faLinks = null;
    function fontAwesomeLinks() {
        if (faLinks !== null) return faLinks;
        faLinks = '';
        document.querySelectorAll('link[rel="stylesheet"][href*="fontawesome"]').forEach(function (l) {
            faLinks += '<link rel="stylesheet" href="' + l.href.replace(/"/g, '&quot;') + '">';
        });
        return faLinks;
    }

    function cssVar(cs, name, fallback) {
        var v = (cs.getPropertyValue(name) || '').trim();
        return v || fallback;
    }

    function baseFrameCss(host) {
        var mt = host.closest('.mes_text') || host.parentElement || document.body;
        var cs = getComputedStyle(mt);
        var rootCs = getComputedStyle(document.documentElement);
        var scheme = (getComputedStyle(document.body).colorScheme || '').trim() || 'normal';
        var em = cssVar(rootCs, '--SmartThemeEmColor', 'inherit');
        var q = cssVar(rootCs, '--SmartThemeQuoteColor', 'inherit');
        var u = cssVar(rootCs, '--SmartThemeUnderlineColor', 'inherit');
        return ':root{color-scheme:' + scheme + ';-webkit-text-size-adjust:100%;text-size-adjust:100%}' +
            '*,*::before,*::after{box-sizing:border-box}' +
            'html,body{margin:0;padding:0;background:transparent}' +
            'html{overflow:hidden}' +
            'body{display:flow-root;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize +
            ';line-height:' + cs.lineHeight + ';font-weight:' + cs.fontWeight + ';color:' + cs.color +
            ';overflow-wrap:break-word;-webkit-tap-highlight-color:transparent}' +
            'p{margin:0 0 10px}p:last-child{margin-bottom:0}' +
            'em,i{color:' + em + '}q{color:' + q + '}q em,q i,font[color] em,font[color] i,font[color] q{color:inherit}' +
            'q::before,q::after{content:none}u{color:' + u + '}' +
            'ol,ul{margin:5px 0}blockquote{border-left:3px solid ' + q + ';padding-left:10px;background:rgba(0,0,0,.3);margin:0}' +
            'a{color:inherit}img{max-width:100%}hr{opacity:.4}' +
            'table{border-spacing:0;border-collapse:collapse;margin-bottom:10px}td,th{border:1px solid;padding:.25em}' +
            'pre{white-space:pre-wrap}' +
            '.stjs-offscreen *,.stjs-offscreen *::before,.stjs-offscreen *::after{animation-play-state:paused!important}';
    }

    var FRAME_BOOT = '<script>(function(){' +
        'var P;try{P=parent.__stJs}catch(e){}' +
        'var fe;try{fe=window.frameElement}catch(e){}' +
        'if(!P||!fe)return;' +
        'function fit(){try{P.fit(fe)}catch(e){}}' +
        'window.__stjsFit=fit;' +
        'function wire(){' +
        ' if("ResizeObserver" in window){var ro=new ResizeObserver(fit);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}' +
        ' document.addEventListener("load",function(e){if(e.target&&/^(IMG|VIDEO|IFRAME|LINK)$/.test(e.target.tagName))fit()},true);' +
        ' if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);' +
        ' if(document.fonts&&document.fonts.addEventListener)document.fonts.addEventListener("loadingdone",fit);' +
        ' [0,60,200,500,1000,2000,4000].forEach(function(t){setTimeout(fit,t)});' +
        ' fit();' +
        '}' +
        'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire);else wire();' +
        'window.addEventListener("load",fit);' +
        'window.addEventListener("click",function(e){' +
        ' if(e.defaultPrevented)return;' +
        ' var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;' +
        ' var h=a.getAttribute("href")||"";if(!h||h.charAt(0)==="#"||/^javascript:/i.test(h))return;' +
        ' var t=(a.getAttribute("target")||"").toLowerCase();if(t&&t!=="_self")return;' +
        ' e.preventDefault();try{parent.open(a.href,"_blank","noopener")}catch(x){}' +
        '});' +
        'window.addEventListener("error",function(e){try{P.frameError(fe,e)}catch(x){}});' +
        '})();<\/script>';

    function buildDoc(html, host) {
        var needsFa = /\bfa-/.test(html);
        var fonts = collectFontCss();
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            (fonts ? '<style id="stjs-fonts">' + fonts + '</style>' : '') +
            (needsFa ? fontAwesomeLinks() : '') +
            '<style id="stjs-frame-base">' + baseFrameCss(host) + '</style>' +
            FRAME_BOOT +
            '</head><body>' + html + '</body></html>';
    }

    var heightCache = new Map();
    function rememberHeight(key, h) {
        if (!key) return;
        heightCache.set(key, h);
        if (heightCache.size > 600) heightCache.delete(heightCache.keys().next().value);
    }

    function chatEl() { return document.getElementById('chat'); }

    window.__stJs.fit = function (fe) {
        if (!fe || !fe.isConnected) return;
        var d;
        try { d = fe.contentDocument; } catch (e) { return; }
        if (!d || !d.body) return;
        var b = d.body;
        var h = Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height));
        if (!isFinite(h) || h < 0) return;
        h = Math.min(h, 30000);
        var cur = parseFloat(fe.style.height) || 0;
        if (Math.abs(h - cur) < 1) return;
        var chat = chatEl();
        var atBottom = chat && (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40);
        fe.style.height = h + 'px';
        rememberHeight(fe.__stjsKey, h);
        if (atBottom && chat && chat.contains(fe)) chat.scrollTop = chat.scrollHeight;
    };

    window.__stJs.frameError = function (fe, e) {
        var mes = fe.closest && fe.closest('.mes');
        var id = mes ? mes.getAttribute('mesid') : '?';
        log('frame #' + id + ': ' + (e && e.message ? e.message : 'error') + (e && e.lineno ? ' @' + e.lineno : ''));
    };

    var frameIO = null;
    try {
        frameIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var d;
                try { d = en.target.contentDocument; } catch (e) { return; }
                if (d && d.documentElement) d.documentElement.classList.toggle('stjs-offscreen', !en.isIntersecting);
            });
        }, { root: null, rootMargin: '300px 0px', threshold: 0 });
    } catch (e) { frameIO = null; }

    function mesKey(host) {
        var mes = host.closest && host.closest('.mes');
        if (!mes) return 'x';
        return (mes.getAttribute('mesid') || 'x') + '/' + (mes.getAttribute('swipeid') || '');
    }

    var PREVIEW_DROP = 'script,style,link,template,tavo-style,custom-style,iframe,video,audio,canvas,svg';
    var PREVIEW_KEEP = /^(?:P|BLOCKQUOTE|UL|OL|H[1-6]|HR|BR|Q|EM|I|STRONG|B|U|S|DEL|SMALL|CODE|PRE|A|FONT|SPAN)$/;

    function showPreview(host, tpl) {
        if (host.querySelector('.stjs-preview')) return;
        var frag = tpl.content.cloneNode(true);
        frag.querySelectorAll(PREVIEW_DROP).forEach(function (n) { n.remove(); });
        var box = document.createElement('div');
        box.className = 'stjs-preview';
        Array.prototype.slice.call(frag.childNodes).forEach(function (n) {
            if (n.nodeType === 3 || (n.nodeType === 1 && PREVIEW_KEEP.test(n.tagName) && !n.hasAttribute('class') && !n.hasAttribute('style'))) {
                box.appendChild(n);
            }
        });
        host.appendChild(box);
    }

    function mountFrame(host) {
        if (!host.isConnected) return;
        var tpl = host.querySelector(':scope > template.stjs-src');
        if (!tpl || tpl.hasAttribute('data-stjs-mounted')) return;
        if (isEditing(host.closest('.mes_text'))) return;
        var html = tpl.innerHTML;
        var key = mesKey(host) + '#' + (host.getAttribute('data-stjs-i') || '') + '#' + hashStr(html);

        var f = document.createElement('iframe');
        f.className = 'stjs-frame';
        f.__stjsKey = key;
        f.setAttribute('scrolling', 'no');
        f.setAttribute('frameborder', '0');
        f.setAttribute('allowtransparency', 'true');
        f.setAttribute('allow', 'autoplay; clipboard-read; clipboard-write; fullscreen; encrypted-media');
        f.setAttribute('allowfullscreen', '');
        f.setAttribute('loading', 'eager');
        f.style.height = (heightCache.get(key) || 0) + 'px';
        try {
            f.srcdoc = buildDoc(html, host);
        } catch (e) {
            log('frame build fail: ' + e.message);
            return;
        }
        tpl.setAttribute('data-stjs-mounted', '1');
        var prev = host.querySelector(':scope > .stjs-preview');
        host.appendChild(f);
        if (prev) {
            var t0 = Date.now();
            (function swap() {
                if (!prev.isConnected) return;
                if ((parseFloat(f.style.height) || 0) > 0 || Date.now() - t0 > 1500) { prev.remove(); return; }
                setTimeout(swap, 50);
            })();
        }
        if (frameIO) frameIO.observe(f);
        stats.frames++;
        renderPanel();
    }

    var lastRender = new Map();
    var mountTimers = new WeakMap();

    function isStreamingHost(host, key, rid) {
        var now = Date.now(), prev = lastRender.get(key);
        if (rid != null && prev && prev.r === rid) return prev.s;
        var streaming = !!(prev && now - prev.t < 1200);
        var ctx = getCtx();
        var sp = ctx && ctx.streamingProcessor;
        if (sp && !sp.isFinished) {
            var mes = host.closest('.mes');
            var all = document.querySelectorAll('#chat .mes[mesid]');
            if (mes && all.length && all[all.length - 1] === mes) streaming = true;
        }
        lastRender.set(key, { r: rid, t: now, s: streaming });
        if (lastRender.size > 400) lastRender.delete(lastRender.keys().next().value);
        return streaming;
    }

    function scheduleMount(host) {
        if (!host || host.__stjsScheduled) return;
        host.__stjsScheduled = true;
        var tpl = host.querySelector(':scope > template.stjs-src');
        if (!tpl) return;
        var key = mesKey(host);
        if (isStreamingHost(host, key, host.getAttribute('data-stjs-r'))) {
            showPreview(host, tpl);
            var t = setTimeout(function () { settle(host, key); }, 700);
            mountTimers.set(host, t);
        } else {
            mountFrame(host);
        }
    }

    function settle(host, key) {
        if (!host.isConnected) return;
        var ctx = getCtx();
        var sp = ctx && ctx.streamingProcessor;
        var lr = lastRender.get(key);
        var since = Date.now() - (lr ? lr.t : 0);
        if ((sp && !sp.isFinished && since < 2500) || since < 650) {
            mountTimers.set(host, setTimeout(function () { settle(host, key); }, 500));
            return;
        }
        mountFrame(host);
    }

    function scanFrames(root) {
        if (MODE !== 'frame' || !root || !root.querySelectorAll) return;
        if (root.classList && root.classList.contains('stjs-host')) scheduleMount(root);
        root.querySelectorAll('.stjs-host').forEach(scheduleMount);
    }

    function compiles(code) {
        try { new Function(code); return true; } catch (e) { return false; }
    }

    function repairScript(code) {
        code = decodeEntities(code);
        code = code.replace(/<\/?(?:em|strong|b|i|u|s|del|q|p|mark|small|sub|sup|code|pre|span)\b[^>]*>/gi, '');
        code = code.replace(/<br\s*\/?>/gi, '\n');
        code = code.replace(/￾/g, '"');
        return code;
    }

    function secureScriptNode(node) {
        if (!node || node.tagName !== 'SCRIPT') return;
        if (node.getAttribute('data-tavo-ran')) return;
        if (node.closest && node.closest('template')) return;
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
        if (isDataScript(code)) { oldNode.setAttribute('data-tavo-done', 'data'); return; }
        var isModule = oldNode.getAttribute('data-tavo-type') === 'module';
        if (!isModule && !compiles(code)) {
            var fixed = repairScript(code);
            if (compiles(fixed)) { code = fixed; note('repair'); }
            else {
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
        try { oldNode.parentNode.replaceChild(s, oldNode); stats.revived++; }
        catch (e) { stats.failed++; log('revive fail: ' + e.message); }
    }

    function reviveScriptsIn(mesText) {
        var held = mesText.querySelectorAll('script[data-tavo-held="1"]:not([data-tavo-done])');
        if (!held.length) return;
        Array.prototype.slice.call(held).forEach(function (node) {
            if (!node.isConnected) return;
            reviveScript(node);
            if (mesText.dataset && mesText.dataset.init) delete mesText.dataset.init;
        });
        note('revive');
    }

    function processInline(mesText) {
        if (!mesText || isEditing(mesText)) return;
        secureScriptsIn(mesText);
        var hasHeld = mesText.querySelector('script[data-tavo-held="1"]:not([data-tavo-done])');
        var hasStyle = mesText.querySelector('style, custom-style, tavo-style, link[href]');
        if (!hasHeld && !hasStyle) return;
        if (hasHeld) delete mesText.dataset.init;
        liftLinks(mesText);
        liftStyles(mesText);
        reviveScriptsIn(mesText);
        renderPanel();
    }

    var procTimers = new WeakMap();
    function scheduleInline(mesText, delay) {
        if (!mesText) return;
        if (procTimers.has(mesText)) clearTimeout(procTimers.get(mesText));
        var key = mesKey(mesText);
        var streaming = isStreamingHost(mesText, 'inline:' + key);
        procTimers.set(mesText, setTimeout(function () {
            procTimers.delete(mesText);
            processInline(mesText);
        }, streaming ? 700 : (delay == null ? 40 : delay)));
    }

    function processRoot(root) {
        if (!root) return;
        scanFrames(root);
        if (!root.querySelectorAll) return;
        var mts = [];
        if (root.classList && root.classList.contains('mes_text')) mts.push(root);
        else if (root.closest && root.closest('.mes_text')) mts.push(root.closest('.mes_text'));
        root.querySelectorAll('.mes_text').forEach(function (m) { mts.push(m); });
        mts.forEach(function (mt) {
            if (mt.querySelector('script[data-tavo-held="1"]:not([data-tavo-done]), script:not([type="text/plain"]):not([data-tavo-ran]), style, custom-style, tavo-style, link[href]')) {
                scheduleInline(mt);
            }
        });
    }

    function installObserver() {
        if (!document.body) { setTimeout(installObserver, 50); return; }
        var chat = chatEl();
        if (chat) secureScriptsIn(chat);
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'IFRAME' || node.tagName === 'STYLE' || node.tagName === 'LINK') continue;
                    var inChat = node.closest ? node.closest('#chat') : null;
                    if (inChat) {
                        if (node.tagName === 'SCRIPT') secureScriptNode(node);
                        else secureScriptsIn(node);
                    }
                    if (node.classList && node.classList.contains('stjs-host')) { scheduleMount(node); continue; }
                    if (node.querySelector && node.querySelector('.stjs-host')) scanFrames(node);
                    if (inChat || (node.querySelector && node.querySelector('.mes_text'))) processRoot(node);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
        note('observer');
        processRoot(document.body);
    }

    function processAll() { processRoot(chatEl() || document.body); }

    function bindEvents() {
        var ctx = getCtx();
        if (!ctx || !ctx.eventSource) { setTimeout(bindEvents, 200); return; }
        var es = ctx.eventSource;
        var et = ctx.eventTypes || ctx.event_types || {};
        function on(name, fn) { if (name && es.on) es.on(name, fn); }
        function later(ms) { return function () { setTimeout(processAll, ms); }; }

        on(et.CHARACTER_MESSAGE_RENDERED, later(30));
        on(et.USER_MESSAGE_RENDERED, later(30));
        on(et.MESSAGE_EDITED, later(60));
        on(et.MESSAGE_UPDATED, later(60));
        on(et.MESSAGE_SWIPED, later(80));
        on(et.GENERATION_ENDED, later(120));
        if (et.GENERATION_STOPPED) on(et.GENERATION_STOPPED, later(120));
        if (et.MORE_MESSAGES_LOADED) on(et.MORE_MESSAGES_LOADED, later(60));
        on(et.CHAT_CHANGED, function () { lastRender.clear(); setTimeout(processAll, 200); });

        try {
            var cmdCb = function (_args, value) {
                var v = String(value == null ? '' : value).trim().toLowerCase();
                if (v === 'frame' || v === 'inline') {
                    try { localStorage.setItem('stjs_mode', v); } catch (e) {}
                    try { window.toastr && window.toastr.info('Режим ' + v + ' — перезагрузи страницу', 'SillyTavern JS'); } catch (e) {}
                    MODE = v;
                    return '';
                }
                toggleDebug(true);
                return '';
            };
            if (ctx.SlashCommandParser && ctx.SlashCommand && typeof ctx.SlashCommandParser.addCommandObject === 'function') {
                ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                    name: 'stjs',
                    callback: cmdCb,
                    helpString: 'SillyTavern JS: /stjs — отладка; /stjs frame | /stjs inline — режим плашек.',
                }));
            } else if (typeof ctx.registerSlashCommand === 'function') {
                ctx.registerSlashCommand('stjs', cmdCb, [], 'SillyTavern JS: отладка / режим плашек');
            }
        } catch (e) { log('slash cmd fail: ' + e.message); }

        note('events');
        log('bound to ST events');
        processAll();
    }

    hookDOMPurify();
    installObserver();
    bindEvents();
    (function waitShowdown(tries) {
        if (hookShowdown() || tries > 120) return;
        setTimeout(function () { waitShowdown(tries + 1); }, 250);
    })(0);
    log('SillyTavern JS v' + VERSION + ' ready (' + MODE + ')');
    try { window.toastr && window.toastr.success('SillyTavern JS v' + VERSION + ' · ' + MODE, 'SillyTavern JS'); } catch (e) {}
})();
