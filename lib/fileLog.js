// Tee all console output into goodbye.txt (real-time, append mode) on the host/VPS.
// Every line gets a Pakistani-time (AM/PM) timestamp. At 10 MB the file rotates to
// goodbye1.txt, goodbye2.txt, ... (numbered archives) so the disk never fills up.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'goodbye.txt');
const MAX_SIZE = Number(process.env.LOG_MAX_SIZE) > 0
    ? Number(process.env.LOG_MAX_SIZE)
    : 10 * 1024 * 1024; // default 10 MB

let fd = null;
let writesSinceCheck = 0;
let installed = false;

function openFd() {
    try {
        fd = fs.openSync(LOG_FILE, 'a');
    } catch {
        fd = null;
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

// First free archive name: goodbye1.txt, goodbye2.txt, ...
function nextArchiveFile() {
    let i = 1;
    while (i < 10000 && fs.existsSync(path.join(process.cwd(), `goodbye${i}.txt`))) i++;
    return path.join(process.cwd(), `goodbye${i}.txt`);
}

function rotateIfNeeded() {
    // Check size only every 500 writes to keep overhead negligible
    if (++writesSinceCheck < 500) return;
    writesSinceCheck = 0;
    try {
        if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size <= MAX_SIZE) return;
        // Close BEFORE rename so rotation also works on Windows (open files are locked there)
        if (fd !== null) { fs.closeSync(fd); fd = null; }
        fs.renameSync(LOG_FILE, nextArchiveFile());
    } catch {
        // ignore — fall through to reopen below
    } finally {
        if (fd === null) openFd();
    }
}

function writeLine(args) {
    try {
        if (fd === null) openFd();
        if (fd === null) return;
        let line = Array.from(args).map(stringify).join(' ');
        line = line.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI color codes
        if (!line.trim()) return;
        fs.writeSync(fd, `[${timestamp()}] ${line}\n`);
        rotateIfNeeded();
    } catch {}
}

function install() {
    if (installed) return;
    installed = true;
    openFd();
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