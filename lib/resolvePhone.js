// Resolve a WhatsApp JID to an exact phone number for display.
// - PN JIDs (923345216246@s.whatsapp.net) → '923345216246'
// - LID JIDs (173414119669800@lid)        → resolved via Baileys LID↔PN mapping
// Falls back to the raw ID when no mapping exists yet (never throws).
const resolvedCache = new Map();

function userFromJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

function isLidJid(jid) {
    const j = String(jid || '');
    return j.endsWith('@lid') || j.endsWith('@hosted.lid');
}

async function resolvePhone(sock, jid) {
    if (!jid) return '';
    if (resolvedCache.has(jid)) return resolvedCache.get(jid);

    try {
        if (isLidJid(jid)) {
            const pnJid = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
            const phone = pnJid ? userFromJid(pnJid) : '';
            if (phone) {
                resolvedCache.set(jid, phone);
                return phone;
            }
            // Mapping unknown yet — don't cache the miss, retry next time
            return userFromJid(jid);
        }
    } catch {
        // fall through to raw id
    }

    const phone = userFromJid(jid);
    resolvedCache.set(jid, phone);
    return phone;
}

module.exports = resolvePhone;