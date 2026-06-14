const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

// Import settings
const isOwnerOrSudo = require('../../lib/isOwner');
const settings = require('../../settings');

// Configuration paths
const CONFIG_PATH = path.join(__dirname, '../../data/nodelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp/nodelete_protected');

// Store protected messages
const protectedMessages = new Map(); // messageId -> { chatId, sender, timestamp, content, mediaType, mediaPath, fileName, mimetype }

// Context info for forwarded appearance
const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
        newsletterName: settings.botName || 'S7 SAFWAN',
        serverMessageId: -1
    }
};

// Ensure temp directory exists
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// Get file extension from mimetype
function getFileExtension(mimetype) {
    const extensions = {
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'application/x-rar-compressed': 'rar',
        'application/vnd.android.package-archive': 'apk',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'text/plain': 'txt',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg'
    };
    return extensions[mimetype] || 'file';
}

// Load config
function loadNoDeleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, chats: [] };
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: false, chats: [] };
    }
}

// Save config
function saveNoDeleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

// Check if protection is enabled for a specific chat
function isProtectionEnabled(chatId) {
    const config = loadNoDeleteConfig();
    return config.enabled && config.chats.includes(chatId);
}

// Add chat to protection list
function addProtectedChat(chatId) {
    const config = loadNoDeleteConfig();
    if (!config.chats.includes(chatId)) {
        config.chats.push(chatId);
        saveNoDeleteConfig(config);
    }
}

// Remove chat from protection list
function removeProtectedChat(chatId) {
    const config = loadNoDeleteConfig();
    config.chats = config.chats.filter(chat => chat !== chatId);
    saveNoDeleteConfig(config);
}

// Get folder size in MB
const getFolderSizeInMB = (folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
            }
        }
        return totalSize / (1024 * 1024);
    } catch (err) {
        return 0;
    }
};

// Clean temp folder if exceeds 500MB
const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > 500) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                fs.unlinkSync(filePath);
            }
            console.log('🧹 Nodelete temp folder cleaned (exceeded 500MB)');
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

// Periodic cleanup every 5 minutes
setInterval(cleanTempFolderIfLarge, 5 * 60 * 1000);

// Get contact name
async function getContactName(sock, jid) {
    try {
        const number = jid.split('@')[0];
        const contacts = await sock.getContacts();
        const contact = contacts.find(c => c.id === jid || c.id === number);
        if (contact && contact.name) return contact.name;
        if (contact && contact.notify) return contact.notify;
        if (contact && contact.pushname) return contact.pushname;
        return number;
    } catch (err) {
        return jid.split('@')[0];
    }
}

// Store protected message
async function storeProtectedMessage(sock, message) {
    try {
        if (!message.key?.id) return;
        
        const chatId = message.key.remoteJid;
        
        // Only protect if enabled for this chat
        if (!isProtectionEnabled(chatId)) return;
        
        const messageId = message.key.id;
        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let fileName = '';
        let mimetype = '';
        let isViewOnce = false;
        
        const sender = message.key.participant || message.key.remoteJid;
        
        // Check for text messages
        if (message.message?.conversation) {
            content = message.message.conversation;
        } 
        else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        }
        // Images (including view once)
        else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            isViewOnce = message.message.imageMessage.viewOnce || false;
            
            const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            await writeFile(mediaPath, buffer);
            console.log(`📸 Image stored (ViewOnce: ${isViewOnce})`);
        }
        // View Once Images (alternative detection)
        else if (message.message?.viewOnceMessageV2?.message?.imageMessage) {
            mediaType = 'image';
            const imgMsg = message.message.viewOnceMessageV2.message.imageMessage;
            content = imgMsg.caption || '';
            isViewOnce = true;
            
            const buffer = await downloadContentFromMessage(imgMsg, 'image');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}_viewonce.jpg`);
            await writeFile(mediaPath, buffer);
            console.log(`👁️ View Once Image stored`);
        }
        // View Once Videos
        else if (message.message?.viewOnceMessageV2?.message?.videoMessage) {
            mediaType = 'video';
            const vidMsg = message.message.viewOnceMessageV2.message.videoMessage;
            content = vidMsg.caption || '';
            isViewOnce = true;
            
            const buffer = await downloadContentFromMessage(vidMsg, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}_viewonce.mp4`);
            await writeFile(mediaPath, buffer);
            console.log(`👁️ View Once Video stored`);
        }
        // Videos
        else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            isViewOnce = message.message.videoMessage.viewOnce || false;
            
            const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            await writeFile(mediaPath, buffer);
            console.log(`🎥 Video stored`);
        }
        // Stickers
        else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            await writeFile(mediaPath, buffer);
            console.log(`🏷️ Sticker stored`);
        }
        // Voice Notes
        else if (message.message?.audioMessage && message.message.audioMessage.ptt === true) {
            mediaType = 'voice';
            const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.ogg`);
            await writeFile(mediaPath, buffer);
            console.log(`🎙️ Voice note stored`);
        }
        // Regular Audio
        else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp3`);
            await writeFile(mediaPath, buffer);
            console.log(`🎵 Audio stored`);
        }
        // GIFs (animated images)
        else if (message.message?.imageMessage?.mimetype === 'image/gif' || 
                 (message.message?.videoMessage?.gifPlayback === true)) {
            mediaType = 'gif';
            const gifMsg = message.message.videoMessage || message.message.imageMessage;
            const buffer = await downloadContentFromMessage(gifMsg, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.gif`);
            await writeFile(mediaPath, buffer);
            console.log(`🎬 GIF stored`);
        }
        // Documents
        else if (message.message?.documentMessage) {
            mediaType = 'document';
            const docMsg = message.message.documentMessage;
            content = docMsg.caption || '';
            mimetype = docMsg.mimetype || 'application/octet-stream';
            fileName = docMsg.fileName || `document_${messageId}`;
            
            let ext = getFileExtension(mimetype);
            if (ext === 'file' && fileName.includes('.')) {
                ext = fileName.split('.').pop();
            }
            
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
            const buffer = await downloadContentFromMessage(docMsg, 'document');
            await writeFile(mediaPath, buffer);
            console.log(`📄 Document stored: ${fileName}`);
        }
        else if (message.message?.documentWithCaptionMessage?.message?.documentMessage) {
            mediaType = 'document';
            const docMsg = message.message.documentWithCaptionMessage.message.documentMessage;
            content = docMsg.caption || '';
            mimetype = docMsg.mimetype || 'application/octet-stream';
            fileName = docMsg.fileName || `document_${messageId}`;
            
            let ext = getFileExtension(mimetype);
            if (ext === 'file' && fileName.includes('.')) {
                ext = fileName.split('.').pop();
            }
            
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
            const buffer = await downloadContentFromMessage(docMsg, 'document');
            await writeFile(mediaPath, buffer);
            console.log(`📄 Document stored: ${fileName}`);
        }
        
        // Store in protection map
        if (content || mediaPath) {
            protectedMessages.set(messageId, {
                content,
                mediaType,
                mediaPath,
                fileName,
                mimetype,
                sender,
                chatId,
                isViewOnce,
                timestamp: new Date().toISOString(),
                messageId: messageId
            });
            
            // Also save to a persistent backup (last 1000 messages)
            saveToBackup(messageId, {
                content,
                mediaType,
                mediaPath,
                fileName,
                mimetype,
                sender,
                chatId,
                isViewOnce,
                timestamp: new Date().toISOString()
            });
            
            console.log(`🛡️ Message protected: ${messageId} (Type: ${mediaType || 'text'}) in ${chatId}`);
        }
        
    } catch (err) {
        console.error('storeProtectedMessage error:', err);
    }
}

// Persistent backup (last 1000 messages)
const BACKUP_PATH = path.join(__dirname, '../../data/nodelete_backup.json');

function saveToBackup(messageId, data) {
    try {
        let backup = {};
        if (fs.existsSync(BACKUP_PATH)) {
            backup = JSON.parse(fs.readFileSync(BACKUP_PATH));
        }
        
        // Keep only last 1000 messages per chat
        if (!backup[data.chatId]) backup[data.chatId] = {};
        backup[data.chatId][messageId] = data;
        
        // Limit to 1000 messages per chat
        const keys = Object.keys(backup[data.chatId]);
        if (keys.length > 1000) {
            const oldestKeys = keys.slice(0, keys.length - 1000);
            oldestKeys.forEach(key => delete backup[data.chatId][key]);
        }
        
        fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));
    } catch (err) {
        console.error('Backup save error:', err);
    }
}

function loadFromBackup(messageId, chatId) {
    try {
        if (fs.existsSync(BACKUP_PATH)) {
            const backup = JSON.parse(fs.readFileSync(BACKUP_PATH));
            return backup[chatId]?.[messageId] || null;
        }
    } catch (err) {
        console.error('Backup load error:', err);
    }
    return null;
}

// Handle message deletion - PREVENT AND RESEND
async function handleDeletePrevention(sock, revocationMessage) {
    try {
        const protocolMessage = revocationMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 0) return;
        
        const deletedMessageId = protocolMessage.key?.id;
        if (!deletedMessageId) return;
        
        const chatId = revocationMessage.key.remoteJid;
        
        // Check if protection is enabled for this chat
        if (!isProtectionEnabled(chatId)) return;
        
        // Get the protected message
        let original = protectedMessages.get(deletedMessageId);
        if (!original) {
            // Try to load from backup
            original = loadFromBackup(deletedMessageId, chatId);
            if (!original) return;
        }
        
        console.log(`🛡️ Deletion attempt detected for: ${deletedMessageId} in ${chatId}`);
        
        const deleter = revocationMessage.key.participant || revocationMessage.key.remoteJid;
        const originalSender = original.sender;
        
        // Check if deleter is bot owner (can still delete)
        const isOwnerDeleter = await isOwnerOrSudo(deleter, sock, chatId);
        
        const deleterName = await getContactName(sock, deleter);
        const senderName = await getContactName(sock, originalSender);
        
        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Karachi',
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        
        let warningText = `🛡️ *PROTECTION ACTIVE* 🛡️\n\n`;
        warningText += `<══════════════════>\n\n`;
        warningText += `⚠️ *${deleterName}* tried to delete a message!\n\n`;
        warningText += `👤 *Original Sender:* ${senderName}\n`;
        warningText += `🕐 *Time:* ${time}\n\n`;
        warningText += `<══════════════════>\n\n`;
        warningText += `🔒 *This chat has NO DELETE protection enabled*\n`;
        warningText += `❌ *Deletion blocked!*\n\n`;
        
        if (!isOwnerDeleter) {
            // Resend the original message to prevent deletion
            if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
                const mediaBuffer = fs.readFileSync(original.mediaPath);
                const mediaOptions = {
                    caption: `🔒 *PROTECTED MESSAGE (Cannot be deleted)*\n\nOriginal from: ${senderName}\nTime: ${time}`,
                    contextInfo: contextInfo
                };
                
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(chatId, { image: mediaBuffer, ...mediaOptions });
                        break;
                    case 'video':
                        await sock.sendMessage(chatId, { video: mediaBuffer, ...mediaOptions });
                        break;
                    case 'sticker':
                        await sock.sendMessage(chatId, { sticker: mediaBuffer });
                        break;
                    case 'voice':
                        await sock.sendMessage(chatId, { audio: mediaBuffer, ptt: true, mimetype: 'audio/ogg' });
                        break;
                    case 'audio':
                        await sock.sendMessage(chatId, { audio: mediaBuffer, mimetype: 'audio/mpeg' });
                        break;
                    case 'gif':
                        await sock.sendMessage(chatId, { video: mediaBuffer, gifPlayback: true, ...mediaOptions });
                        break;
                    case 'document':
                        await sock.sendMessage(chatId, { 
                            document: mediaBuffer,
                            fileName: original.fileName || 'protected_document',
                            mimetype: original.mimetype,
                            ...mediaOptions
                        });
                        break;
                }
            } else if (original.content) {
                await sock.sendMessage(chatId, {
                    text: `🔒 *PROTECTED MESSAGE (Cannot be deleted)*\n\nOriginal from: ${senderName}\nTime: ${time}\n\n"${original.content}"`,
                    contextInfo: contextInfo
                });
            }
            
            // Send warning to the deleter (mention them)
            await sock.sendMessage(chatId, {
                text: warningText,
                mentions: [deleter],
                contextInfo: contextInfo
            });
            
            console.log(`🛡️ Deletion prevented and message re-sent`);
        } else {
            // Owner can delete, just log it
            await sock.sendMessage(chatId, {
                text: `👑 *Owner deleted a protected message*\n\nSender: ${senderName}\nTime: ${time}`,
                contextInfo: contextInfo
            });
        }
        
        // Don't delete from store immediately, keep for future attempts
        // Clean up after 24 hours
        setTimeout(() => {
            protectedMessages.delete(deletedMessageId);
            if (original.mediaPath && fs.existsSync(original.mediaPath)) {
                try { fs.unlinkSync(original.mediaPath); } catch(e) {}
            }
        }, 24 * 60 * 60 * 1000);
        
    } catch (err) {
        console.error('handleDeletePrevention error:', err);
    }
}

// Handle message edit prevention
async function handleEditPrevention(sock, editMessage) {
    try {
        const protocolMessage = editMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 1) return; // Type 1 is edit
        
        const editedMessageId = protocolMessage.key?.id;
        if (!editedMessageId) return;
        
        const chatId = editMessage.key.remoteJid;
        
        // Check if protection is enabled
        if (!isProtectionEnabled(chatId)) return;
        
        // Get original message
        let original = protectedMessages.get(editedMessageId);
        if (!original) {
            original = loadFromBackup(editedMessageId, chatId);
            if (!original) return;
        }
        
        const editor = editMessage.key.participant || editMessage.key.remoteJid;
        const isOwnerEditor = await isOwnerOrSudo(editor, sock, chatId);
        
        if (!isOwnerEditor) {
            console.log(`✏️ Edit attempt detected for: ${editedMessageId}`);
            
            const editorName = await getContactName(sock, editor);
            const newText = protocolMessage.text || '';
            
            // Send warning
            await sock.sendMessage(chatId, {
                text: `🛡️ *EDIT PROTECTION ACTIVE* 🛡️\n\n<══════════════════>\n\n⚠️ *${editorName}* tried to edit a message!\n\n📝 *Original message:* "${original.content}"\n✏️ *Attempted edit:* "${newText}"\n\n❌ *Editing is disabled in this chat!*`,
                mentions: [editor],
                contextInfo: contextInfo
            });
        }
        
    } catch (err) {
        console.error('handleEditPrevention error:', err);
    }
}

// Main command handler
async function handleNoDeleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, {
            text: '*Only the bot owner can use this command.*',
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    const isGroup = chatId.endsWith('@g.us');
    const chatType = isGroup ? 'group' : 'personal chat';
    const isProtected = isProtectionEnabled(chatId);
    
    if (!match) {
        return sock.sendMessage(chatId, {
            text: `🛡️ *NO DELETE PROTECTION*\n\n<══════════════════>\n\n📌 *Current Status:* ${isProtected ? '✅ ENABLED' : '❌ DISABLED'}\n📍 *Chat Type:* ${chatType}\n\n*.nodelete on* - Enable protection\n*.nodelete off* - Disable protection\n\n<══════════════════>\n\n*What gets protected:*\n✅ Text messages\n✅ Images (including View Once)\n✅ Videos (including View Once)\n✅ Voice notes\n✅ Stickers\n✅ GIFs\n✅ Documents (PDF, DOC, APK, etc.)\n✅ Audio files\n\n<══════════════════>\n\n*Features:*\n🔒 No one can delete messages\n✏️ No one can edit messages\n🔄 Deleted messages auto-recover\n⚠️ Delete attempts get warnings\n\n<══════════════════>\n\n📞 *Contact Owner:* +92 3345216246\n👨‍💻 *Developer:* ${settings.author || 'S7 SAFWAN'}`,
            contextInfo: contextInfo
        }, { quoted: message });
    }
    
    if (match === 'on') {
        if (!isProtected) {
            addProtectedChat(chatId);
            await sock.sendMessage(chatId, {
                text: `🛡️ *NO DELETE PROTECTION ENABLED* 🛡️\n\n<══════════════════>\n\n✅ Protection is now ACTIVE in this ${chatType}!\n\n*What this means:*\n• 📝 No one can delete messages\n• ✏️ No one can edit messages\n• 👁️ View Once media will be saved\n• 🔄 Deleted messages will be restored automatically\n• ⚠️ Delete attempts will be reported\n\n<══════════════════>\n\n⚠️ *Note:* Only the bot owner can disable this feature.\n\n<══════════════════>\n\n📞 *Contact Owner:* +92 3345216246`,
                contextInfo: contextInfo
            });
        } else {
            await sock.sendMessage(chatId, {
                text: `⚠️ *Protection is already enabled in this ${chatType}!*`,
                contextInfo: contextInfo
            });
        }
    } 
    else if (match === 'off') {
        if (isProtected) {
            removeProtectedChat(chatId);
            await sock.sendMessage(chatId, {
                text: `🔓 *NO DELETE PROTECTION DISABLED* 🔓\n\n<══════════════════>\n\n❌ Protection has been REMOVED from this ${chatType}.\n\nMessages can now be deleted and edited normally.\n\n<══════════════════>\n\n📞 *Contact Owner:* +92 3345216246`,
                contextInfo: contextInfo
            });
        } else {
            await sock.sendMessage(chatId, {
                text: `⚠️ *Protection is not enabled in this ${chatType}!*`,
                contextInfo: contextInfo
            });
        }
    }
    else {
        return sock.sendMessage(chatId, {
            text: '*Invalid command. Use .nodelete on/off*',
            contextInfo: contextInfo
        }, { quoted: message });
    }
}

// Clean up old temp files on start
function cleanOldTempFiles() {
    try {
        const files = fs.readdirSync(TEMP_MEDIA_DIR);
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        
        for (const file of files) {
            const filePath = path.join(TEMP_MEDIA_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > oneDay) {
                fs.unlinkSync(filePath);
                console.log(`🧹 Cleaned old temp file: ${file}`);
            }
        }
    } catch (err) {
        console.error('Clean old files error:', err);
    }
}

// Run cleanup on start
cleanOldTempFiles();

module.exports = {
    handleNoDeleteCommand,
    handleDeletePrevention,
    handleEditPrevention,
    storeProtectedMessage
};