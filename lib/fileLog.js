// Tee all console output into goodbye.txt (real-time, append mode) on the host/VPS.
// Every line gets a Pakistani-time (AM/PM) timestamp. File auto-rotates at 10 MB
// (old content moves to goodbye.old.txt) so the disk never fills up.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'goodbye.txt');
const OLD_FILE = path.join(process.cwd(), 'goodbye.old.txt');
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

let stream = null;
let writesSinceCheck = 0;
let installed = false;

function openStream() {
    try {
        stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
        stream.on('error', () => { stream = null; });
    } catch {
        stream = null;
    }
}

function timestamp() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function stringify(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try {
        const s = JSON.stringify(arg);
        return s === undefined ? String(arg) : s;
    } catch {
        return String(arg);
    }
}

function rotateIfNeeded() {
    // Check size only every 500 writes to keep overhead negligible
    if (++writesSinceCheck < 500) return;
    writesSinceCheck = 0;
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_SIZE) {
            if (stream) { try { stream.end(); } catch {} }
            try { fs.rmSync(OLD_FILE, { force: true }); } catch {}
            fs.renameSync(LOG_FILE, OLD_FILE);
            openStream();
        }
    } catch {}
}

function writeLine(args) {
    try {
        if (!stream) openStream();
        if (!stream) return;
        let line = Array.from(args).map(stringify).join(' ');
        line = line.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI color codes
        if (!line.trim()) return;
        stream.write(`[${timestamp()}] ${line}\n`);
        rotateIfNeeded();
    } catch {}
}

function install() {
    if (installed) return;
    installed = true;
    openStream();
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = typeof console[m] === 'function' ? console[m].bind(console) : null;
        console[m] = (...args) => {
            if (original) original(...args);
            writeLine(args);
        };
    }
    writeLine(['── goodbye.txt log capture started ──']);
}

module.exports = install;