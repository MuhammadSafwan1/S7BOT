const fs = require('fs');

const ANTICALL_PATH = './data/anticall.json';
const BLOCKED_PATH = './data/blocked.json';
const CALL_LOG_PATH = './data/callLog.json';

// ========== READ / WRITE FUNCTIONS ==========

function readJSON(filePath, defaultData) {
    try {
        if (!fs.existsSync(filePath)) return defaultData;
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw || '{}');
    } catch {
        return defaultData;
    }
}

function writeJSON(filePath, data) {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {}
}

function readState() {
    return readJSON(ANTICALL_PATH, { enabled: false });
}

function writeState(enabled) {
    writeJSON(ANTICALL_PATH, { enabled: !!enabled });
}

function readBlocked() {
    return readJSON(BLOCKED_PATH, {});
}

function writeBlocked(data) {
    writeJSON(BLOCKED_PATH, data);
}

function readCallLog() {
    return readJSON(CALL_LOG_PATH, {});
}

function writeCallLog(data) {
    writeJSON(CALL_LOG_PATH, data);
}

// ========== CHECK IF USER IS BLOCKED ==========

function isUserBlocked(sender) {
    const blocked = readBlocked();
    if (!blocked[sender]) return false;
    
    const blockTime = blocked[sender];
    const currentTime = Date.now();
    const threeHours = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
    
    if (currentTime - blockTime >= threeHours) {
        // Auto-unblock after 3 hours
        delete blocked[sender];
        writeBlocked(blocked);
        // Clear call log too
        const callLog = readCallLog();
        delete callLog[sender];
        writeCallLog(callLog);
        return false;
    }
    
    return true;
}

function getRemainingTime(sender) {
    const blocked = readBlocked();
    if (!blocked[sender]) return 0;
    const currentTime = Date.now();
    const threeHours = 3 * 60 * 60 * 1000;
    const elapsed = currentTime - blocked[sender];
    const remaining = threeHours - elapsed;
    return Math.ceil(remaining / 60000); // Return minutes remaining
}

// ========== REJECT CALL ==========

async function rejectCall(sock, callId, callerJid) {
    try {
        if (typeof sock.rejectCall === 'function' && callId) {
            await sock.rejectCall(callId, callerJid);
        } else if (typeof sock.sendCallOfferAck === 'function' && callId) {
            await sock.sendCallOfferAck(callId, callerJid, 'reject');
        }
    } catch (e) {
        // Silently fail - call rejection isn't critical
    }
}

// ========== MAIN ANTICALL HANDLER ==========

async function handleIncomingCall(sock, sender, chatId, callId, callStatus) {
    const state = readState();
    if (!state.enabled) return; // Anticall OFF hai toh kuch mat karo
    
    // Only process 'offer' status - ignore ringing/timeout/accept/reject duplicates
    if (callStatus && callStatus !== 'offer') return;
    
    const currentTime = Date.now();
    const threeMinutes = 3 * 60 * 1000; // 3 minutes in milliseconds
    
    // First, reject/hang up the call immediately
    await rejectCall(sock, callId, sender);
    
    // Check if user is already blocked
    if (isUserBlocked(sender)) {
        const remaining = getRemainingTime(sender);
        await sock.sendMessage(chatId, { 
            text: `🚫 *You are BLOCKED!*\n\nYou have been blocked for excessive calling.\n⏳ *Remaining time: ${remaining} minute(s)*\n\nPlease wait until the block is automatically removed.\n📞 Your call has been auto-cut.` 
        });
        return; // Call already auto-cut
    }
    
    // Log the call
    const callLog = readCallLog();
    
    // Initialize or clean old logs
    if (!callLog[sender]) {
        callLog[sender] = [];
    }
    
    // Remove calls older than 3 minutes (only count recent calls)
    callLog[sender] = callLog[sender].filter(time => currentTime - time < threeMinutes);
    
    // Add current call
    callLog[sender].push(currentTime);
    writeCallLog(callLog);
    
    // Count calls in last 3 minutes
    const callCount = callLog[sender].length;
    
    // ========== LOGIC ==========
    
    if (callCount === 1) {
        // 1st call - Auto-cut + warning
        await sock.sendMessage(chatId, { 
            text: `📞 *Call ${callCount}*\n\n⚠️ You have *2 attempts left*.\nBe careful!` 
        });
        return;
    }
    
    if (callCount === 2) {
        // 2nd call - Auto-cut + warning
        await sock.sendMessage(chatId, { 
            text: `📞 *Call ${callCount}*\n\n⚠️ You have *1 attempt left*.\nNext call will be your LAST WARNING!` 
        });
        return;
    }
    
    if (callCount === 3) {
        // 3rd call - LAST WARNING
        await sock.sendMessage(chatId, { 
            text: `🚨 *LAST WARNING!*\n\n📞 *Call ${callCount}*\n\n⚠️ This is your *FINAL WARNING*!\n❌ If you make *1 more call*, you will be *BLOCKED for 3 HOURS*!` 
        });
        return;
    }
    
    if (callCount >= 4) {
        // 4th call - BLOCK for 3 HOURS!
        const blocked = readBlocked();
        blocked[sender] = currentTime;
        writeBlocked(blocked);
        
        // Clear call log for this user
        delete callLog[sender];
        writeCallLog(callLog);
        
        // Send block message
        await sock.sendMessage(chatId, { 
            text: `🚫 *YOU ARE BLOCKED!*\n\n❌ You have been blocked due to excessive calling.\n📞 You are now *BLOCKED for 3 HOURS*.\n⏳ Any calls during this time will be *auto-cut*.\n\n⏱️ Remaining time: 180 minutes\n\nPlease wait and try again later.` 
        });
        
        // ACTUALLY BLOCK the user on WhatsApp
        try {
            await sock.updateBlockStatus(sender, 'block');
            console.log(`🔒 ${sender} blocked for 3 hours (spam calls)`);
        } catch (e) {
            console.error(`Failed to block ${sender}:`, e.message);
        }
        
        // Auto-unblock after 3 hours
        setTimeout(async () => {
            try {
                const currentBlocked = readBlocked();
                if (currentBlocked[sender]) {
                    delete currentBlocked[sender];
                    writeBlocked(currentBlocked);
                    await sock.updateBlockStatus(sender, 'unblock');
                    console.log(`🔓 ${sender} auto-unblocked after 3 hours`);
                }
            } catch (e) {
                console.error(`Failed to auto-unblock ${sender}:`, e.message);
            }
        }, 3 * 60 * 60 * 1000); // 3 hours
        
        return;
    }
}

// ========== COMMAND: .anticall ==========

async function anticallCommand(sock, chatId, message, args) {
    const state = readState();
    const sub = (args || '').trim().toLowerCase();

    if (!sub || (sub !== 'on' && sub !== 'off' && sub !== 'status')) {
        await sock.sendMessage(chatId, { 
            text: `*🤖 ANTICALL SYSTEM*\n\n📌 *Commands:*\n.anticall on  - Enable auto-block system\n.anticall off - Disable anticall\n.anticall status - Show current status\n\n📞 *How it works:*\n• Call 1: Auto-cut + "2 attempts left" ⚠️\n• Call 2: Auto-cut + "1 attempt left" ⚠️\n• Call 3: Auto-cut + "LAST WARNING" 🚨\n• Call 4+: BLOCKED for 3 HOURS 🔒\n• Auto-unblock after 3 hours 🔓\n• Calls during block = Auto-cut + time remaining` 
        }, { quoted: message });
        return;
    }

    if (sub === 'status') {
        const blocked = readBlocked();
        const blockedCount = Object.keys(blocked).length;
        await sock.sendMessage(chatId, { 
            text: `📊 *ANTICALL STATUS*\n\n📌 Status: *${state.enabled ? '🟢 ON' : '🔴 OFF'}*\n🔒 Currently Blocked: *${blockedCount} user(s)*` 
        }, { quoted: message });
        return;
    }

    const enable = sub === 'on';
    writeState(enable);
    await sock.sendMessage(chatId, { 
        text: `✅ Anticall is now *${enable ? 'ENABLED' : 'DISABLED'}*.\n${enable ? '📞 System active!\n\nCall 1 → "2 attempts left" ⚠️\nCall 2 → "1 attempt left" ⚠️\nCall 3 → "LAST WARNING" 🚨\nCall 4+ → BLOCKED for 3 HOURS 🔒' : ''}` 
    }, { quoted: message });
}

// ========== EXPORT ==========

module.exports = { 
    anticallCommand, 
    readState, 
    handleIncomingCall,
    rejectCall,
    isUserBlocked,
    getRemainingTime
};