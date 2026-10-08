const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');
const resolvePhone = require('../../lib/resolvePhone');

const messageStore = new Map();
const groupNameCache = new Map(); // chatId -> group subject (avoids repeated groupMetadata calls)
const contactNameCache = new Map(); // jid -> contact display name (avoids getContacts() per message)

// Unwrap container messages: disappearing/view-once/edited/device-sent/template etc.
function unwrapMessage(m) {
    if (!m) return m;
    if (m.ephemeralMessage?.message) return unwrapMessage(m.ephemeralMessage.message);
    if (m.viewOnceMessage?.message) return unwrapMessage(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return unwrapMessage(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension?.message) return unwrapMessage(m.viewOnceMessageV2Extension.message);
    if (m.documentWithCaptionMessage?.message) return unwrapMessage(m.documentWithCaptionMessage.message);
    if (m.editedMessage?.message) return unwrapMessage(m.editedMessage.message);
    if (m.deviceSentMessage?.message) return unwrapMessage(m.deviceSentMessage.message);
    if (m.templateMessage?.hydratedTemplate?.hydratedContent) return unwrapMessage(m.templateMessage.hydratedTemplate.hydratedContent);
    if (m.templateMessage?.fourRowTemplate?.content) return unwrapMessage(m.templateMessage.fourRowTemplate.content);
    return m;
}

// Cached contact display name (empty string cached too, so no refetch spam)
async function getCachedContactName(sock, jid) {
    if (!jid) return '';
    if (contactNameCache.has(jid)) return contactNameCache.get(jid);
    let name = '';
    try {
        const contacts = await sock.getContacts();
        const num = String(jid).split('@')[0].split(':')[0];
        const c = contacts.find(x => x && (x.id === jid || String(x.id || '').split('@')[0].split(':')[0] === num));
        name = c?.name || c?.notify || '';
    } catch {}
    contactNameCache.set(jid, name);
    return name;
}
const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

// Import settings
const settings = require('../../settings');

// OWNER NUMBER FROM SETTINGS - WHERE REPORTS WILL GO
const OWNER_NUMBER = settings.ownerNumber;
const OWNER_JID = OWNER_NUMBER ? OWNER_NUMBER + '@s.whatsapp.net' : '';

// Context info
const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
        newsletterName: settings.botName || 'S7 SAFWAN',
        serverMessageId: -1
    }
};

// Ensure tmp dir exists
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// Function to get file extension from mimetype
function getFileExtension(mimetype) {
    const extensions = {
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'application/x-rar-compressed': 'rar',
        'application/x-rar': 'rar',
        'application/vnd.rar': 'rar',
        'application/vnd.android.package-archive': 'apk',
        'application/x-apk': 'apk',
        'application/vnd.xapk': 'xapk',
        'application/x-xapk-package': 'xapk',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'text/plain': 'txt',
        'application/json': 'json',
        'application/xml': 'xml',
        'text/xml': 'xml',
        'application/javascript': 'js',
        'text/css': 'css',
        'text/html': 'html',
        'application/x-httpd-php': 'php',
        'application/x-python-code': 'py',
        'application/x-java-archive': 'jar',
        'application/x-7z-compressed': '7z',
        'application/x-tar': 'tar',
        'application/gzip': 'gz',
        'application/x-bzip2': 'bz2',
        'application/x-iso9660-image': 'iso',
        'application/x-msi': 'msi',
        'application/x-msdownload': 'exe',
        'application/x-shockwave-flash': 'swf',
        'application/x-www-form-urlencoded': 'url',
        'text/plain': 'bat',        
        'application/x-bat': 'bat', 
        'application/octet-stream': 'file'
    };
    return extensions[mimetype] || 'file';
}

// Function to get folder size in MB
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
        console.error('Error getting folder size:', err);
        return 0;
    }
};

// Function to clean temp folder if size exceeds 200MB
const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > 200) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                fs.unlinkSync(filePath);
            }
            console.log('🧹 Temp folder cleaned (exceeded 200MB)');
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

// Start periodic cleanup check every 1 minute
setInterval(cleanTempFolderIfLarge, 60 * 1000);

// Load config
function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: false };
    }
}

// Save config
function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

const isOwnerOrSudo = require('../../lib/isOwner');

// Function to get contact name
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

// Function to create message with proper mentions
function createMessageWithMentions(text, mentionJids) {
    return {
        text: text,
        mentions: mentionJids,
        contextInfo: contextInfo
    };
}

// Command Handler - Only ON/OFF
async function handleAntideleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, { 
            text: '*Only the bot owner can use this command.*',
            contextInfo: contextInfo 
        }, { quoted: message });
    }

    const config = loadAntideleteConfig();

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `*🔰 ANTIDELETE SETUP* 🔰\n\n` +
                  `══════════════════\n\n` +
                  `*Current Status:* ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                  `*.antidelete on* - Enable monitoring\n` +
                  `*.antidelete off* - Disable monitoring\n\n` +
                  `*Features:*\n` +
                  `• 📝 Text messages recovery\n` +
                  `• 📸 Image/Video recovery\n` +
                  `• 📄 Documents (PDF, ZIP, APK, etc.)\n` +
                  `• 🎵 Audio/Sticker recovery\n\n` +
                  `══════════════════\n\n` +
                  `📞 *Contact Owner:* +92 3345216246\n` +
                  `👨‍💻 *Developer:* S7 SAFWAN\n\n` +
                  `*All reports sent to owner only!*`,
            contextInfo: contextInfo
        }, { quoted: message });
    }

    if (match === 'on') {
        config.enabled = true;
        saveAntideleteConfig(config);
        return sock.sendMessage(chatId, { 
            text: `*✅ Antidelete enabled successfully!*\n\nAll deleted messages will be sent to owner.`,
            contextInfo: contextInfo 
        }, { quoted: message });
    } 
    else if (match === 'off') {
        config.enabled = false;
        saveAntideleteConfig(config);
        return sock.sendMessage(chatId, { 
            text: `*❌ Antidelete disabled successfully!*`,
            contextInfo: contextInfo 
        }, { quoted: message });
    }
    else {
        return sock.sendMessage(chatId, { 
            text: '*Invalid command. Use .antidelete on/off*',
            contextInfo: contextInfo 
        }, { quoted: message });
    }
}

// Safe media download - returns path or null if download fails
async function safeDownloadMedia(msg, type, messageId, ext) {
    try {
        const stream = await downloadContentFromMessage(msg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        const mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
        await writeFile(mediaPath, buffer);
        return mediaPath;
    } catch (err) {
        console.log(`⚠️ Media download skipped (${type}): ${err.message}`);
        return null;
    }
}

// Archive recovered media to organized folders on VPS: media/pic/, media/video/, media/audio/, media/document/
const MEDIA_ROOT = path.join(process.cwd(), 'media');
const FOLDER_MAP = {
    image: 'pic',
    sticker: 'pic',
    video: 'video',
    ptv: 'video',
    audio: 'audio',
    document: 'document'
};

async function archiveMedia(mediaType, messageId, mediaPath) {
    if (!mediaPath) return;
    const folder = FOLDER_MAP[mediaType] || 'document';
    const ext = path.extname(mediaPath) || '.bin';
    const dest = path.join(MEDIA_ROOT, folder, `${messageId}${ext}`);
    try {
        fs.mkdirSync(MEDIA_ROOT, { recursive: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(mediaPath, dest);
        console.log(`💾 Media archived: ${dest}`);
    } catch (err) {
        console.error(`⚠️ Media archive failed (${dest}): ${err.message}`);
    }
}

// Store incoming messages
async function storeMessage(sock, message) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;
        if (!message.key?.id) return;

        const messageId = message.key.id;
        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let fileName = '';
        let mimetype = '';

        const chatId = message.key.remoteJid;
        // fromMe messages are sent by the logged-in (owner/bot) account — in a DM
        // remoteJid is the chat partner, so use the account itself for correct From:
        const sender = message.key.fromMe
            ? (sock.user?.id || message.key.participant || message.key.remoteJid)
            : (message.key.participant || message.key.remoteJid);

        const m = unwrapMessage(message.message);

        if (m?.conversation) {
            content = m.conversation;
        } else if (m?.extendedTextMessage?.text) {
            content = m.extendedTextMessage.text;
        } else if (m?.imageMessage) {
            mediaType = 'image';
            content = m.imageMessage.caption || '';
            mediaPath = await safeDownloadMedia(m.imageMessage, 'image', messageId, 'jpg');
        } else if (m?.stickerMessage) {
            mediaType = 'sticker';
            mediaPath = await safeDownloadMedia(m.stickerMessage, 'sticker', messageId, 'webp');
        } else if (m?.videoMessage) {
            // Covers regular video AND GIF (gifPlayback) messages
            mediaType = 'video';
            content = m.videoMessage.caption || '';
            mediaPath = await safeDownloadMedia(m.videoMessage, 'video', messageId, 'mp4');
        } else if (m?.ptvMessage) {
            // Round video note
            mediaType = 'video';
            content = m.ptvMessage.caption || '';
            mediaPath = await safeDownloadMedia(m.ptvMessage, 'video', messageId, 'mp4');
        } else if (m?.audioMessage) {
            // Voice note (ptt) and regular audio
            mediaType = 'audio';
            const mime = m.audioMessage.mimetype || '';
            const ext = mime.includes('mpeg') ? 'mp3' : (mime.includes('ogg') ? 'ogg' : 'mp3');
            mediaPath = await safeDownloadMedia(m.audioMessage, 'audio', messageId, ext);
        } else if (m?.documentMessage) {
            mediaType = 'document';
            const docMsg = m.documentMessage;
            content = docMsg.caption || '';
            mimetype = docMsg.mimetype || 'application/octet-stream';
            fileName = docMsg.fileName || `document_${messageId}`;
            
            let ext = getFileExtension(mimetype);
            if (ext === 'file' && fileName.includes('.')) {
                ext = fileName.split('.').pop();
            }
            
            mediaPath = await safeDownloadMedia(docMsg, 'document', messageId, ext);
            if (mediaPath) console.log(`📄 Document stored: ${fileName} (${mimetype})`);
        } else if (m?.documentWithCaptionMessage?.message?.documentMessage) {
            mediaType = 'document';
            const docMsg = message.message.documentWithCaptionMessage.message.documentMessage;
            content = docMsg.caption || '';
            mimetype = docMsg.mimetype || 'application/octet-stream';
            fileName = docMsg.fileName || `document_${messageId}`;
            
            let ext = getFileExtension(mimetype);
            if (ext === 'file' && fileName.includes('.')) {
                ext = fileName.split('.').pop();
            }
            
            mediaPath = await safeDownloadMedia(docMsg, 'document', messageId, ext);
            if (mediaPath) console.log(`📄 Document stored: ${fileName} (${mimetype})`);
        }

        // Archive recovered media to organized folders on VPS
        if (mediaPath) { await archiveMedia(mediaType, messageId, mediaPath); }

        // Store only if we have content or media
        if (content || mediaPath) {
            messageStore.set(messageId, {
                content,
                mediaType,
                mediaPath,
                fileName,
                mimetype,
                sender,
                chatId: chatId,
                group: chatId.endsWith('@g.us') ? chatId : null,
                timestamp: new Date().toISOString()
            });
            const preview = content
                ? content.replace(/\s+/g, ' ').slice(0, 80)
                : (mediaType ? `(${mediaType})` : '');
            // Destination label: To: <number> ( name ) for private, group name for groups
            let chatLabel;
            if (chatId && chatId.endsWith('@g.us')) {
                let groupName = groupNameCache.get(chatId);
                if (!groupName) {
                    try {
                        groupName = (await sock.groupMetadata(chatId))?.subject || 'Group';
                        groupNameCache.set(chatId, groupName);
                    } catch { groupName = 'Group'; }
                }
                chatLabel = `( group: ${groupName} )`;
            } else {
                // Recipient = jis ko message bheja gaya (fromMe -> partner, else -> owner/bot account)
                const recipientJid = message.key.fromMe
                    ? chatId
                    : (sock.user?.id || chatId);
                const recipientNum = await resolvePhone(sock, recipientJid);
                const recipientName = await getCachedContactName(sock, recipientJid);
                chatLabel = recipientName
                    ? `To: ${recipientNum} ( ${recipientName} )`
                    : `To: ${recipientNum}`;
            }
            // Pakistani time (AM/PM)
            const time = new Date().toLocaleTimeString('en-US', {
                timeZone: 'Asia/Karachi',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
            });
            console.log(`From: ${await resolvePhone(sock, sender)} | Type: ${mediaType || 'text'} | Text: " ${preview} " | ${chatLabel} | 🕐 ${time}`);
        }
    } catch (err) {
        console.error('storeMessage error:', err);
    }
}

// Handle message deletion - SEND ONLY TO OWNER
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        if (!OWNER_JID) {
            console.log('⚠️ Owner number not configured in settings.js');
            return;
        }

        const protocolMessage = revocationMessage.message?.protocolMessage;
        if (!protocolMessage || protocolMessage.type !== 0) return;

        const deletedMessageId = protocolMessage.key?.id;
        if (!deletedMessageId) return;

        console.log(`🔄 Message deletion detected: ${deletedMessageId}`);

        // WHO DELETED THE MESSAGE
        let deletedBy = revocationMessage.key?.participant || 
                        revocationMessage.key?.remoteJid || 
                        protocolMessage.participant ||
                        revocationMessage.participant;
        // fromMe revocation = the logged-in (owner/bot) account did the deletion
        if (revocationMessage.key?.fromMe && sock.user?.id) {
            deletedBy = sock.user.id;
        }
        
        // NOTE: report ALL deletions now (owner/bot deletions included) so group
        // deletions and owner's own test deletions also recover to owner DM.
        const original = messageStore.get(deletedMessageId);
        if (!original) {
            console.log('Message not found in store:', deletedMessageId);
            return;
        }

        const ownerChatId = OWNER_JID;
        
        // Get names
        const senderName = await getContactName(sock, original.sender);
        const deleterName = await getContactName(sock, deletedBy);
        const senderNumber = await resolvePhone(sock, original.sender);
        const deleterNumber = await resolvePhone(sock, deletedBy);
        
        const isSelfDelete = (original.sender === deletedBy);
        
        let groupName = '';
        if (original.group) {
            try {
                const groupMetadata = await sock.groupMetadata(original.group);
                groupName = groupMetadata.subject;
            } catch (e) {
                groupName = 'Unknown Group';
            }
        }

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

        // Build report text for owner with proper mention placeholders
        let reportText = `🔰 *ANTIDELETE REPORT* 🔰\n\n`;
        reportText += `══════════════════\n\n`;

        if (isSelfDelete) {
            reportText += `⚠️ *User deleted their OWN message*\n\n`;
            reportText += `👤 *Name:* @${senderName}\n`;
            reportText += `📱 *Number:* ${senderNumber}\n`;
        } else {
            reportText += `🗑️ *DELETED BY*\n`;
            reportText += `👤 *Name:* @${deleterName}\n`;
            reportText += `📱 *Number:* ${deleterNumber}\n\n`;
            reportText += `══════════════════\n\n`;
            reportText += `👤 *ORIGINAL SENDER*\n`;
            reportText += `👤 *Name:* ${senderName}\n`;
            reportText += `📱 *Number:* ${senderNumber}\n`;
        }

        if (groupName) {
            reportText += `\n👥 *Group:* ${groupName}`;
        }

        reportText += `\n🕐 *Time:* ${time}`;
        reportText += `\n📍 *Chat ID:* ${original.chatId}`;
        reportText += `\n\n══════════════════\n\n`;
        reportText += `📞 *Contact Owner:* +92 3345216246\n`;
        reportText += `👨‍💻 *Developer:* S7 SAFWAN\n\n`;
        reportText += `══════════════════\n\n`;

        // Add deleted message content at the end
        if (original.content) {
            reportText += `💬 *Deleted Message:* ${original.content}`;
        }

        // Prepare mentions array - only the person who deleted (or sender if self-delete)
        const mentionJids = [];
        if (!isSelfDelete) {
            mentionJids.push(deletedBy);
        } else {
            mentionJids.push(original.sender);
        }

        // Send report with proper mentions
        await sock.sendMessage(ownerChatId, {
            text: reportText,
            mentions: mentionJids,
            contextInfo: contextInfo
        });

        console.log(`📤 Report sent to owner: ${ownerChatId}`);

        // Send media to owner if exists
        if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
            let mediaCaption = '';
            
            if (isSelfDelete) {
                mediaCaption = `*🔰 DELETED ${original.mediaType.toUpperCase()}* 🔰\n\n`;
                mediaCaption += `⚠️ User deleted their own media\n`;
                mediaCaption += `👤 From: @${senderName} (${senderNumber})`;
                if (original.content) {
                    mediaCaption += `\n\n💬 *Message:* ${original.content}`;
                }
            } else {
                mediaCaption = `*🔰 DELETED ${original.mediaType.toUpperCase()}* 🔰\n\n`;
                mediaCaption += `🗑️ Deleted by: @${deleterName} (${deleterNumber})\n`;
                mediaCaption += `👤 From: ${senderName} (${senderNumber})`;
                if (original.content) {
                    mediaCaption += `\n\n💬 *Message:* ${original.content}`;
                }
            }
            
            const mediaOptions = {
                caption: mediaCaption,
                mentions: mentionJids,
                contextInfo: contextInfo
            };

            try {
                const mediaBuffer = fs.readFileSync(original.mediaPath);
                
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(ownerChatId, { image: mediaBuffer, ...mediaOptions });
                        console.log(`📸 Image sent to owner`);
                        break;
                    case 'sticker':
                        await sock.sendMessage(ownerChatId, { sticker: mediaBuffer, ...mediaOptions });
                        console.log(`🎨 Sticker sent to owner`);
                        break;
                    case 'video':
                        await sock.sendMessage(ownerChatId, { video: mediaBuffer, ...mediaOptions });
                        console.log(`🎥 Video sent to owner`);
                        break;
                    case 'audio':
                        await sock.sendMessage(ownerChatId, { 
                            audio: mediaBuffer, 
                            mimetype: 'audio/mpeg', 
                            ptt: false, 
                            ...mediaOptions 
                        });
                        console.log(`🎵 Audio sent to owner`);
                        break;
                    case 'document':
                        await sock.sendMessage(ownerChatId, { 
                            document: mediaBuffer,
                            fileName: original.fileName || 'document',
                            mimetype: original.mimetype || 'application/octet-stream',
                            ...mediaOptions 
                        });
                        console.log(`📄 Document sent to owner: ${original.fileName}`);
                        break;
                }
            } catch (err) {
                console.error('Media send error:', err);
                await sock.sendMessage(ownerChatId, {
                    text: `⚠️ Error sending media: ${err.message}`,
                    contextInfo: contextInfo
                });
            }

            // Cleanup media file
            try {
                fs.unlinkSync(original.mediaPath);
                console.log(`🧹 Cleaned up temp file: ${original.mediaPath}`);
            } catch (err) {
                console.error('Media cleanup error:', err);
            }
        }

        messageStore.delete(deletedMessageId);
        console.log(`✅ Antidelete report sent to owner for message: ${deletedMessageId}`);

    } catch (err) {
        console.error('handleMessageRevocation error:', err);
    }
}

module.exports = {
    handleAntideleteCommand,
    handleMessageRevocation,
    storeMessage
};