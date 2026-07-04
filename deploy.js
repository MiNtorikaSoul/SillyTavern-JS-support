const fs = require('fs');
const path = require('path');

const repoRoot = __dirname;

function looksLikeStRoot(dir) {
    return fs.existsSync(path.join(dir, 'package.json')) &&
        fs.existsSync(path.join(dir, 'data', 'default-user'));
}

function resolveStRoot() {
    if (process.env.ST_ROOT) return process.env.ST_ROOT;

    const cwd = process.cwd();
    if (looksLikeStRoot(cwd)) return cwd;

    const candidates = [
        'C:/Games/SillyTavern (release)',
        'C:/Games/SillyTavern',
        '/c/Games/SillyTavern (release)',
        '/c/Games/SillyTavern'
    ];

    for (const candidate of candidates) {
        const normalized = path.resolve(candidate);
        if (looksLikeStRoot(normalized)) return normalized;
    }

    return process.env.ST_ROOT || 'C:/Games/SillyTavern (release)';
}

const ST_ROOT = path.resolve(resolveStRoot());

const targets = [
    path.join(ST_ROOT, 'data/default-user/extensions/sillytavern-js'),
    path.join(ST_ROOT, 'public/scripts/extensions/third-party/sillytavern-js')
];

const legacy = [
    path.join(ST_ROOT, 'data/default-user/extensions/tavo-hydrate'),
    path.join(ST_ROOT, 'public/scripts/extensions/third-party/tavo-hydrate')
];

const jsPath = path.join(repoRoot, 'index.js');
const mfPath = path.join(repoRoot, 'manifest.json');

if (!fs.existsSync(jsPath) || !fs.existsSync(mfPath)) {
    console.error('index.js or manifest.json not found in', repoRoot);
    process.exit(1);
}

if (!looksLikeStRoot(ST_ROOT)) {
    console.error('SillyTavern folder not found:', ST_ROOT);
    console.error('');
    console.error('Do this from Git Bash:');
    console.error('  cd "/c/Games/SillyTavern (release)"');
    console.error('  node "/c/Users/kira/Documents/Tavern/deploy.js"');
    console.error('');
    console.error('Or set path manually:');
    console.error('  ST_ROOT="/c/Games/SillyTavern (release)" node "/c/Users/kira/Documents/Tavern/deploy.js"');
    process.exit(1);
}

const js = fs.readFileSync(jsPath);
const mf = fs.readFileSync(mfPath);
let version = 'unknown';
try {
    version = JSON.parse(mf.toString()).version || version;
} catch (e) {}

legacy.forEach(function(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('Removed legacy:', dir);
    } catch (e) {}
});

targets.forEach(function(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), js);
    fs.writeFileSync(path.join(dir, 'manifest.json'), mf);
    console.log('Deployed:', dir);
});

console.log('SillyTavern JS v' + version + ' -> ' + ST_ROOT);
console.log('Reload SillyTavern page (Ctrl+F5) and enable extension in Extensions.');
