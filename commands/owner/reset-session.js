/**
 * S7BOT Reset Session Script
 * Deletes old WhatsApp session to get fresh QR code
 * Run: npm run reset-session
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SESSION_DIR = path.join(ROOT, 'session');

if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    console.log('✓ Session folder removed (fresh QR will be generated)');
} else {
    console.log('✓ No session folder found, already clean');
}

// Also remove baileys store if present
const baileysStore = path.join(ROOT, 'baileys_store.json');
if (fs.existsSync(baileysStore)) {
    fs.unlinkSync(baileysStore);
    console.log('✓ baileys_store.json removed');
}

console.log('\n✅ Session reset complete! Restart bot to scan new QR code.');