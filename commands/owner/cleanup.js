/**
 * S7BOT Cleanup Script
 * Cleans temp files, old sessions, and caches to keep the project small
 * Run: npm run cleanup
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function removeDir(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`✓ Removed: ${dirPath}`);
    }
}

function removeFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✓ Removed: ${filePath}`);
    }
}

// Temporary folders
removeDir(path.join(ROOT, 'temp'));
removeDir(path.join(ROOT, 'XeonMedia'));
removeDir(path.join(ROOT, 'tmp'));

// Session backup files (keep active session)
removeFile(path.join(ROOT, 'baileys_store.json'));

// Create fresh temp folder
fs.mkdirSync(path.join(ROOT, 'temp'), { recursive: true });

console.log('\n✅ Cleanup complete! Project is ready for hosting.');