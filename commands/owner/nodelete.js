// FILE: commands/owner/nodelete.js
// 🛡️ ANTI-DELETE SYSTEM: Prevents message deletion when owner is present

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const isOwnerOrSudo = require('../../lib/isOwner');
const settings = require('../../settings');

// Owner's number from settings
const OWNER_NUMBER = settings.ownerNumber;
const OWNER_JID = OWNER_NUMBER + '@s.whatsapp.net';

const CONFIG_PATH = path.join(__dirname, '../../data/nodelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../../temp/nodelete_protected');

// Store ALL messages in protected chats for recovery
const protectedMessages = new Map(); // messageId -> {message, sender, timestamp, media}

const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
        newsletterName: settings.botName || 'S7 SAFWAN',
        serverMessageId: -1
    }
};

if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// Clean old stored messages every hour (prevent memory leak)
setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    for (const [msgId, data] of protectedMessages.entries()) {
        if (now - data.storedAt > ONE_HOUR) {
            protectedMessages.delete(msgId);
        }
    }
    console.log(`🧹 Cleaned old protected messages. Current: ${protectedMessages.size}`);
}, 60 * 60 * 1000);

function loadNoDeleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: false };
    }
}

function saveNoDeleteConfig(config) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

// Check if owner is present in the group
async function isOwnerInGroup(sock, groupJid) {
    try {
        const groupMetadata = await sock.groupMetadata(groupJid);
        const participants = groupMetadata.participants;
        const ownerPresent = participants.some(p => p.id === OWNER_JID);
        console.log(`👑 Owner ${OWNER_NUMBER} present in group ${groupJid.split('@')[0]}: ${ownerPresent}`);
        return ownerPresent;
    } catch (err) {
        console.error('Error checking owner in group:', err);
        return false;
    }
}

// Check if protection should be active for this chat
async function shouldProtectChat(sock, chatId) {
    const config = loadNoDeleteConfig();
    if (!config.enabled) return false;
    
    const isGroup = chatId.endsWith('@g.us');
    const isDirectChat = chatId === OWNER_JID;
    
    // Direct message to owner: ALWAYS protect
    if (isDirectChat) {
        console.log(`🛡️ Direct chat with owner - Protection ACTIVE`);
        return true;
    }
    
    // Group chat: Protect ONLY if owner is in the group
    if (isGroup) {
        const ownerInGroup = await isOwnerInGroup(sock, chatId);
        if (ownerInGroup) {
            console.log(`🛡️ Group has owner - Protection ACTIVE for ${chatId.split('@')[0]}`);
            return true;
        } else {
            console.log(`❌ Owner not in group - Protection INACTIVE for ${chatId.split('@')[0]}`);
            return false;
        }
    }
    
    return false;
}

// 🛡️ MAIN FUNCTION: Store messages for recovery when deleted
async function convertToProtectedMessage(sock, message) {
    try {
        if (!message.key?.id) return;
        
        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        
        // Check if protection should be active
        const shouldProtect = await shouldProtectChat(sock, chatId);
        if (!shouldProtect) return;
        
        // Don't store bot's own messages
        if (message.key.fromMe) {
            console.log(`🤖 Bot's own message - not storing`);
            return;
        }
        
        // Don't store owner's messages (optional - remove this if you want to protect owner too)
        if (senderId === OWNER_JID) {
            console.log(`👑 Owner's message - not storing (owner can delete their own)`);
            return;
        }
        
        const messageId = message.key.id;
        console.log(`🛡️ STORING message ${messageId} from ${senderId.split('@')[0]} for anti-delete protection`);
        
        // Extract message content
        let content = '';
        let mediaType = 'text';
        let mediaBuffer = null;
        let fileName = '';
        let caption = '';
        
        // Text messages
        if (message.message?.conversation) {
            content = message.message.conversation;
        } 
        else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        }
        // Image messages
        else if (message.message?.imageMessage) {
            mediaType = 'image';
            caption = message.message.imageMessage.caption || '';
            try {
                const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                console.error('Failed to download image:', err.message);
            }
        }
        // Video messages
        else if (message.message?.videoMessage) {
            mediaType = 'video';
            caption = message.message.videoMessage.caption || '';
            try {
                const stream = await downloadContentFromMessage(message.message.videoMessage, 'video');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                console.error('Failed to download video:', err.message);
            }
        }
        // Sticker messages
        else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            try {
                const stream = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                console.error('Failed to download sticker:', err.message);
            }
        }
        // Audio/Voice messages
        else if (message.message?.audioMessage) {
            mediaType = message.message.audioMessage.ptt ? 'voice' : 'audio';
            try {
                const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                console.error('Failed to download audio:', err.message);
            }
        }
        // Document messages
        else if (message.message?.documentMessage) {
            mediaType = 'document';
            caption = message.message.documentMessage.caption || '';
            fileName = message.message.documentMessage.fileName || 'document';
            try {
                const stream = await downloadContentFromMessage(message.message.documentMessage, 'document');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                console.error('Failed to download document:', err.message);
            }
        }
        
        // Store the message data
        protectedMessages.set(messageId, {
            content: content || caption,
            mediaType,
            mediaBuffer,
            fileName,
            senderId,
            senderName: message.pushName || senderId.split('@')[0],
            chatId,
            timestamp: message.messageTimestamp || Math.floor(Date.now() / 1000),
            storedAt: Date.now()
        });
        
        console.log(`✅ Message stored: ${messageId} | Type: ${mediaType} | From: ${senderId.split('@')[0]}`);
        
    } catch (err) {
        console.error('convertToProtectedMessage error:', err);
    }
}

// 🚨 HANDLE DELETE ATTEMPTS: Restore deleted messages
async function handleDeletePrevention(sock, revocationMessage) {
    try {
        const protocolMessage = revocationMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 0) return;
        
        const deletedMessageId = protocolMessage.key?.id;
        if (!deletedMessageId) return;
        
        const chatId = revocationMessage.key.remoteJid;
        const deleterId = revocationMessage.key.participant || revocationMessage.key.remoteJid;
        
        console.log(`🔄 DELETE DETECTED | Message: ${deletedMessageId} | By: ${deleterId.split('@')[0]}`);
        
        // Check if protection is active
        const shouldProtect = await shouldProtectChat(sock, chatId);
        if (!shouldProtect) {
            console.log(`❌ Protection not active in this chat - allowing delete`);
            return;
        }
        
        // Check if this was a protected message
        const stored = protectedMessages.get(deletedMessageId);
        if (!stored) {
            console.log(`⚠️ Message ${deletedMessageId} not found in protected storage`);
            return;
        }
        
        // Allow owner to delete their own messages
        if (deleterId === OWNER_JID) {
            console.log(`👑 Owner deleted their own message - allowing`);
            protectedMessages.delete(deletedMessageId);
            return;
        }
        
        console.log(`🛡️ BLOCKING DELETE | Restoring message from: ${stored.senderName}`);
        
        // Format timestamp
        const msgDate = new Date(stored.timestamp * 1000);
        const timeStr = msgDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
        const dateStr = msgDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        });
        
        // Build restoration message
        const header = `╔═══════════════════╗\n║  🚫 DELETE BLOCKED  ║\n╚═══════════════════╝\n\n`;
        const info = `👤 *Sender:* ${stored.senderName}\n🕐 *Time:* ${timeStr}, ${dateStr}\n❌ *Deleted by:* ${deleterId === stored.senderId ? 'Sender' : 'Someone else'}\n\n`;
        const footer = `\n\n━━━━━━━━━━━━━━━━━━━\n🛡️ *Anti-Delete Protection Active*\n👑 Owner is present in this chat`;
        
        // Restore the message
        if (stored.mediaType === 'text' && stored.content) {
            await sock.sendMessage(chatId, {
                text: `${header}${info}📝 *Message:*\n${stored.content}${footer}`,
                contextInfo: contextInfo
            });
        } 
        else if (stored.mediaType === 'image' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                image: stored.mediaBuffer,
                caption: `${header}${info}${stored.content ? `📝 *Caption:* ${stored.content}\n` : ''}${footer}`,
                contextInfo: contextInfo
            });
        }
        else if (stored.mediaType === 'video' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                video: stored.mediaBuffer,
                caption: `${header}${info}${stored.content ? `📝 *Caption:* ${stored.content}\n` : ''}${footer}`,
                contextInfo: contextInfo
            });
        }
        else if (stored.mediaType === 'sticker' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                sticker: stored.mediaBuffer,
                contextInfo: contextInfo
            });
            await sock.sendMessage(chatId, {
                text: `${header}${info}${footer}`,
                contextInfo: contextInfo
            });
        }
        else if (stored.mediaType === 'voice' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                audio: stored.mediaBuffer,
                ptt: true,
                mimetype: 'audio/ogg; codecs=opus',
                contextInfo: contextInfo
            });
            await sock.sendMessage(chatId, {
                text: `${header}${info}🎤 *Voice message restored*${footer}`,
                contextInfo: contextInfo
            });
        }
        else if (stored.mediaType === 'audio' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                audio: stored.mediaBuffer,
                mimetype: 'audio/mpeg',
                contextInfo: contextInfo
            });
            await sock.sendMessage(chatId, {
                text: `${header}${info}🎵 *Audio restored*${footer}`,
                contextInfo: contextInfo
            });
        }
        else if (stored.mediaType === 'document' && stored.mediaBuffer) {
            await sock.sendMessage(chatId, {
                document: stored.mediaBuffer,
                fileName: stored.fileName || 'document',
                caption: `${header}${info}${stored.content ? `📝 *Caption:* ${stored.content}\n` : ''}${footer}`,
                contextInfo: contextInfo
            });
        }
        
        console.log(`✅ Message restored successfully`);
        
        // Keep the message in storage for potential future attempts
        // protectedMessages.delete(deletedMessageId); // Don't delete yet
        
    } catch (err) {
        console.error('handleDeletePrevention error:', err);
    }
}

// 🚨 HANDLE EDIT ATTEMPTS: Show original message
async function handleEditPrevention(sock, editMessage) {
    try {
        const protocolMessage = editMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 1) return;
        
        const editedMessageId = protocolMessage.key?.id;
        if (!editedMessageId) return;
        
        const chatId = editMessage.key.remoteJid;
        const editorId = editMessage.key.participant || editMessage.key.remoteJid;
        
        console.log(`✏️ EDIT DETECTED | Message: ${editedMessageId} | By: ${editorId.split('@')[0]}`);
        
        // Check if protection is active
        const shouldProtect = await shouldProtectChat(sock, chatId);
        if (!shouldProtect) {
            console.log(`❌ Protection not active in this chat - allowing edit`);
            return;
        }
        
        // Check if this was a protected message
        const stored = protectedMessages.get(editedMessageId);
        if (!stored) {
            console.log(`⚠️ Message ${editedMessageId} not found in protected storage`);
            return;
        }
        
        // Allow owner to edit their own messages
        if (editorId === OWNER_JID) {
            console.log(`👑 Owner edited their own message - allowing`);
            return;
        }
        
        console.log(`🛡️ BLOCKING EDIT | Showing original from: ${stored.senderName}`);
        
        // Extract new edited text
        const newText = protocolMessage.editedMessage?.conversation || 
                       protocolMessage.editedMessage?.extendedTextMessage?.text || 
                       '[Media/Complex message]';
        
        // Format timestamp
        const msgDate = new Date(stored.timestamp * 1000);
        const timeStr = msgDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
        const dateStr = msgDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        });
        
        // Build edit notification message
        const header = `╔═══════════════════╗\n║  ✏️ EDIT BLOCKED  ║\n╚═══════════════════╝\n\n`;
        const info = `👤 *Sender:* ${stored.senderName}\n🕐 *Original Time:* ${timeStr}, ${dateStr}\n\n`;
        const originalMsg = `📝 *ORIGINAL MESSAGE:*\n${stored.content}\n\n`;
        const editedMsg = `✏️ *TRIED TO EDIT TO:*\n${newText}\n\n`;
        const footer = `━━━━━━━━━━━━━━━━━━━\n🛡️ *Anti-Edit Protection Active*\n👑 Owner is present in this chat`;
        
        await sock.sendMessage(chatId, {
            text: `${header}${info}${originalMsg}${editedMsg}${footer}`,
            contextInfo: contextInfo
        });
        
        console.log(`✅ Edit blocked and reported successfully`);
        
    } catch (err) {
        console.error('handleEditPrevention error:', err);
    }
}

// Command handler
async function handleNoDeleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, {
            text: '❌ *Only the bot owner can use this command.*',
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    const config = loadNoDeleteConfig();
    
    if (!match) {
        const isGroup = chatId.endsWith('@g.us');
        const ownerInGroup = isGroup ? await isOwnerInGroup(sock, chatId) : false;
        
        return sock.sendMessage(chatId, {
            text: `╔═══════════════════════╗
║  🛡️ ANTI-DELETE SYSTEM  ║
╚═══════════════════════╝

📊 *SYSTEM STATUS*
━━━━━━━━━━━━━━━━━━━━━

🔘 *Global Status:* ${config.enabled ? '✅ ACTIVE' : '❌ INACTIVE'}
👑 *Owner in this chat:* ${ownerInGroup ? '✅ YES' : '❌ NO'}
💾 *Messages stored:* ${protectedMessages.size}

━━━━━━━━━━━━━━━━━━━━━

⚙️ *COMMANDS*

• *.nodelete on* - Enable protection
• *.nodelete off* - Disable protection

━━━━━━━━━━━━━━━━━━━━━

🛡️ *HOW IT WORKS*

When ACTIVE and owner is present:
✅ All messages are stored in memory
✅ If someone deletes their message
✅ Bot immediately restores it
✅ Shows who deleted it and when

━━━━━━━━━━━━━━━━━━━━━

📍 *APPLIES TO*

• 📱 Direct messages to owner
• 👥 Any group where owner is member

━━━━━━━━━━━━━━━━━━━━━

⚠️ *IMPORTANT NOTES*

• Owner can still delete own messages
• Works for text, images, videos, etc.
• Messages stored for 1 hour max
• Requires bot to have internet access

━━━━━━━━━━━━━━━━━━━━━

📞 *Owner Contact*
+92 3345216246`,
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    if (match === 'on') {
        config.enabled = true;
        saveNoDeleteConfig(config);
        
        await sock.sendMessage(chatId, {
            text: `╔═══════════════════════╗
║  ✅ PROTECTION ACTIVE  ║
╚═══════════════════════╝

🛡️ *Anti-Delete System Enabled!*

━━━━━━━━━━━━━━━━━━━━━

✅ System is now monitoring all messages
✅ Deletions will be blocked and restored
✅ Protection active in:
   • Groups where you are member
   • Direct messages to you

━━━━━━━━━━━━━━━━━━━━━

🧪 *Test It Now!*

1. Send a test message in any group where you are present
2. Try to delete it
3. Bot will immediately restore it

━━━━━━━━━━━━━━━━━━━━━

📞 *Contact:* +92 3345216246`,
            contextInfo: contextInfo
        }, { quoted: message });
        
    } else if (match === 'off') {
        config.enabled = false;
        saveNoDeleteConfig(config);
        
        // Clear stored messages
        protectedMessages.clear();
        
        await sock.sendMessage(chatId, {
            text: `╔═══════════════════════╗
║  ❌ PROTECTION DISABLED  ║
╚═══════════════════════╝

🔓 *Anti-Delete System Deactivated*

━━━━━━━━━━━━━━━━━━━━━

❌ System is now inactive
🗑️ Stored messages cleared
📝 Messages can be deleted normally

━━━━━━━━━━━━━━━━━━━━━

📞 *Contact:* +92 3345216246`,
            contextInfo: contextInfo
        }, { quoted: message });
    }
}

module.exports = {
    handleNoDeleteCommand,
    handleDeletePrevention,
    handleEditPrevention,
    convertToProtectedMessage
};