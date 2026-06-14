// FILE: commands/owner/nodelete.js

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const isOwnerOrSudo = require('../../lib/isOwner');
const settings = require('../../settings');

// Owner's number from settings
const OWNER_NUMBER = settings.ownerNumber ;
const OWNER_JID = OWNER_NUMBER + '@s.whatsapp.net';

const CONFIG_PATH = path.join(__dirname, '../../data/nodelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp/nodelete_protected');

// Store converted "old" messages
const convertedMessages = new Map();

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
        console.log(`👑 Owner ${OWNER_NUMBER} present in group: ${ownerPresent}`);
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
            console.log(`🛡️ Group has owner - Protection ACTIVE for ${chatId}`);
            return true;
        } else {
            console.log(`❌ Owner not in group - Protection INACTIVE for ${chatId}`);
            return false;
        }
    }
    
    return false;
}

// Send message with old timestamp (5 days old - removes delete/edit options)
async function sendAsOldMessage(sock, chatId, content, mediaType = 'text', mediaBuffer = null, options = {}) {
    // WhatsApp only allows delete for everyone for ~3-5 minutes
    // By making it 5 days old, delete for everyone option disappears completely
    const OLD_TIMESTAMP = Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
    
    let sentMsg;
    
    if (mediaType === 'text' && content) {
        sentMsg = await sock.sendMessage(chatId, {
            text: content,
            contextInfo: contextInfo
        });
    } 
    else if (mediaType === 'image' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            image: mediaBuffer,
            caption: content || '',
            contextInfo: contextInfo
        });
    }
    else if (mediaType === 'video' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            video: mediaBuffer,
            caption: content || '',
            contextInfo: contextInfo
        });
    }
    else if (mediaType === 'sticker' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            sticker: mediaBuffer,
            contextInfo: contextInfo
        });
    }
    else if (mediaType === 'voice' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            audio: mediaBuffer,
            ptt: true,
            mimetype: 'audio/ogg',
            contextInfo: contextInfo
        });
    }
    else if (mediaType === 'audio' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            audio: mediaBuffer,
            mimetype: 'audio/mpeg',
            contextInfo: contextInfo
        });
    }
    else if (mediaType === 'document' && mediaBuffer) {
        sentMsg = await sock.sendMessage(chatId, {
            document: mediaBuffer,
            fileName: options.fileName || 'document',
            caption: content || '',
            contextInfo: contextInfo
        });
    }
    
    return sentMsg;
}

// Main function: Convert any new message to an "old" message
async function convertToProtectedMessage(sock, message) {
    try {
        if (!message.key?.id) return;
        
        const chatId = message.key.remoteJid;
        
        // Check if protection should be active
        const shouldProtect = await shouldProtectChat(sock, chatId);
        if (!shouldProtect) return;
        
        // Don't convert messages that are already old (> 1 hour)
        const currentTimestamp = message.messageTimestamp || Math.floor(Date.now() / 1000);
        const messageAge = (Date.now() / 1000) - currentTimestamp;
        if (messageAge > 3600) return;
        
        const messageId = message.key.id;
        
        // Extract message content
        let content = '';
        let mediaType = 'text';
        let mediaBuffer = null;
        let fileName = '';
        let mimetype = '';
        
        const sender = message.key.participant || message.key.remoteJid;
        
        // Don't convert owner's own messages (optional - remove if you want to protect owner too)
        if (sender === OWNER_JID) {
            console.log(`👑 Owner's message - not converting`);
            return;
        }
        
        console.log(`🛡️ Converting message to protected (5 days old) from ${sender}`);
        
        // Extract content
        if (message.message?.conversation) {
            content = message.message.conversation;
        } 
        else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        }
        else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.viewOnceMessageV2?.message?.imageMessage) {
            mediaType = 'image';
            const imgMsg = message.message.viewOnceMessageV2.message.imageMessage;
            content = imgMsg.caption || '';
            const stream = await downloadContentFromMessage(imgMsg, 'image');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.viewOnceMessageV2?.message?.videoMessage) {
            mediaType = 'video';
            const vidMsg = message.message.viewOnceMessageV2.message.videoMessage;
            content = vidMsg.caption || '';
            const stream = await downloadContentFromMessage(vidMsg, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            const stream = await downloadContentFromMessage(message.message.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const stream = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.audioMessage && message.message.audioMessage.ptt === true) {
            mediaType = 'voice';
            const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        else if (message.message?.documentMessage) {
            mediaType = 'document';
            const docMsg = message.message.documentMessage;
            content = docMsg.caption || '';
            fileName = docMsg.fileName || 'document';
            mimetype = docMsg.mimetype || 'application/octet-stream';
            const stream = await downloadContentFromMessage(docMsg, 'document');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
        }
        
        // Send the message as an "old" message
        if (content || mediaBuffer) {
            const oldMessage = await sendAsOldMessage(sock, chatId, content, mediaType, mediaBuffer, {
                fileName,
                mimetype
            });
            
            if (oldMessage && oldMessage.key) {
                // Store the old message info
                convertedMessages.set(oldMessage.key.id, {
                    content,
                    mediaType,
                    sender,
                    chatId,
                    originalId: messageId,
                    convertedAt: Date.now()
                });
                
                console.log(`✅ Message converted to protected (5 days old): ${oldMessage.key.id}`);
                
                // Delete the original message
                try {
                    await sock.sendMessage(chatId, { delete: message.key });
                    console.log(`🗑️ Original message deleted: ${messageId}`);
                } catch (err) {
                    console.log('Could not delete original:', err.message);
                }
            }
        }
        
    } catch (err) {
        console.error('convertToProtectedMessage error:', err);
    }
}

// Handle any delete attempts (backup protection)
async function handleDeletePrevention(sock, revocationMessage) {
    try {
        const protocolMessage = revocationMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 0) return;
        
        const deletedMessageId = protocolMessage.key?.id;
        if (!deletedMessageId) return;
        
        const chatId = revocationMessage.key.remoteJid;
        
        const shouldProtect = await shouldProtectChat(sock, chatId);
        if (!shouldProtect) return;
        
        // Check if this was one of our converted messages
        const converted = convertedMessages.get(deletedMessageId);
        if (!converted) return;
        
        console.log(`🛡️ Delete attempt on protected message: ${deletedMessageId}`);
        
        // Resend the message if someone tries to delete
        if (converted.mediaBuffer) {
            // Resend with media
            if (converted.mediaType === 'image') {
                await sock.sendMessage(chatId, { image: converted.mediaBuffer, caption: converted.content });
            } else if (converted.mediaType === 'video') {
                await sock.sendMessage(chatId, { video: converted.mediaBuffer, caption: converted.content });
            } else if (converted.mediaType === 'sticker') {
                await sock.sendMessage(chatId, { sticker: converted.mediaBuffer });
            } else if (converted.content) {
                await sock.sendMessage(chatId, { text: converted.content });
            }
        } else if (converted.content) {
            await sock.sendMessage(chatId, { text: converted.content });
        }
        
    } catch (err) {
        console.error('handleDeletePrevention error:', err);
    }
}

// Command handler
async function handleNoDeleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, {
            text: '*Only the bot owner can use this command.*',
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    const config = loadNoDeleteConfig();
    
    if (!match) {
        const isGroup = chatId.endsWith('@g.us');
        const ownerInGroup = isGroup ? await isOwnerInGroup(sock, chatId) : false;
        
        return sock.sendMessage(chatId, {
            text: `🛡️ *PROTECTION SYSTEM*\n\n<══════════════════>\n\n📌 *Global Status:* ${config.enabled ? '✅ ACTIVE' : '❌ INACTIVE'}\n👑 *Owner in this chat:* ${ownerInGroup ? '✅ YES' : '❌ NO'}\n\n*.nodelete on* - Enable protection\n*.nodelete off* - Disable protection\n\n<══════════════════>\n\n*When ACTIVE and owner is present:*\n🔒 ALL messages become PERMANENT\n❌ "Delete for everyone" option DISAPPEARS\n✏️ "Edit" option DISAPPEARS\n💡 Users can only use "Delete for me"\n\n<══════════════════>\n\n*Applies to:*\n• 📱 Direct messages to owner\n• 👥 Any group where owner is present\n\n<══════════════════>\n\n📞 *Owner:* +92 3345216246`,
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    if (match === 'on') {
        config.enabled = true;
        saveNoDeleteConfig(config);
        
        await sock.sendMessage(chatId, {
            text: `🛡️ *PROTECTION ACTIVATED* 🛡️\n\n<══════════════════>\n\n✅ System is now ACTIVE!\n\n*How it works:*\n• When you (owner) are in a group, all messages there become protected\n• Direct messages to you become protected\n• Messages become 5 days old instantly\n• "Delete for everyone" and "Edit" options DISAPPEAR\n• Users can only "Delete for me"\n\n<══════════════════>\n\n⚠️ *Test it in any group where you are present!*\n\n<══════════════════>\n\n📞 *Contact:* +92 3345216246`,
            contextInfo: contextInfo
        });
        
    } else if (match === 'off') {
        config.enabled = false;
        saveNoDeleteConfig(config);
        
        await sock.sendMessage(chatId, {
            text: `🔓 *PROTECTION DEACTIVATED* 🔓\n\n<══════════════════>\n\n❌ System is now INACTIVE.\n\nMessages will appear normally with real timestamps.\n\n<══════════════════>\n\n📞 *Contact:* +92 3345216246`,
            contextInfo: contextInfo
        });
    }
}

module.exports = {
    handleNoDeleteCommand,
    handleDeletePrevention,
    convertToProtectedMessage  // Main function to call on every message
};