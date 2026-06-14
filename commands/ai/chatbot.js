// commands/ai/chatbot.js
// S7 SAFWAN AI Chatbot - Fixed Response Formatting

const settings = require('../../settings');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
// Settings file paths
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'chatbot-settings.json');
const GLOBAL_FILE = path.join(process.cwd(), 'data', 'chatbot-global.json');

// Owner number
const OWNER_NUMBER = settings.ownerNumber;
const BOT_NAME = 'S7 SAFWAN';

// Your OpenRouter API Key
// const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const apiKey = process.env.OPENROUTER_API_KEY;

// Conversation memory
const conversationMemory = new Map();

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return { enabledChats: [] };
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function loadGlobalMode() {
    try {
        if (fs.existsSync(GLOBAL_FILE)) {
            return JSON.parse(fs.readFileSync(GLOBAL_FILE, 'utf8'));
        }
    } catch (e) {}
    return { enabled: false, enabledSince: null };
}

function saveGlobalMode(global) {
    fs.writeFileSync(GLOBAL_FILE, JSON.stringify(global, null, 2));
}

function isOwner(senderId) {
    const cleanNumber = senderId.replace(/[^0-9]/g, '');
    const ownerClean = OWNER_NUMBER.replace(/[^0-9]/g, '');
    return cleanNumber === ownerClean;
}

function isChatEnabled(chatId) {
    const global = loadGlobalMode();
    if (global.enabled) return true;
    const settings = loadSettings();
    return settings.enabledChats.includes(chatId);
}

// Clean and format AI response properly
function cleanResponse(text) {
    if (!text) return '';
    
    // Remove JSON wrapper if present
    let cleaned = text;
    
    // Remove {{type:'text',text:'...'}} wrapper
    const jsonMatch = cleaned.match(/{{type:'text',text:'(.+)'}}/s);
    if (jsonMatch) {
        cleaned = jsonMatch[1];
    }
    
    // Remove escape sequences
    cleaned = cleaned.replace(/\\n/g, '\n');
    cleaned = cleaned.replace(/\\t/g, '\t');
    cleaned = cleaned.replace(/\\"/g, '"');
    cleaned = cleaned.replace(/\\'/g, "'");
    
    // Remove any remaining JSON-like structures
    cleaned = cleaned.replace(/\{\{.*?\}\}/g, '');
    cleaned = cleaned.replace(/\[OBJECT OBJECT\]/gi, '');
    
    // Fix common code block issues
    cleaned = cleaned.replace(/`{3}(\w*)\n?/g, (match, lang) => {
        return `\`\`\`${lang || 'cpp'}\n`;
    });
    
    // Ensure proper line breaks
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // Fix malformed C++ code patterns
    cleaned = cleaned.replace(/minit main/g, 'int main');
    cleaned = cleaned.replace(/#include \n/g, '#include <iostream>\n');
    cleaned = cleaned.replace(/cout << ""/g, 'cout <<');
    cleaned = cleaned.replace(/\n\}/g, '\n}');
    
    return cleaned.trim();
}

// ============ OPENROUTER AI API ============
async function getAIResponse(message, senderId, isGroup, senderName) {
    const memoryKey = isGroup ? `group_${senderId}` : `private_${senderId}`;
    let conversation = conversationMemory.get(memoryKey) || [];
    
    // Add user message to conversation
    conversation.push({ role: 'user', content: message });
    
    // Keep last 10 messages for context
    if (conversation.length > 10) {
        conversation = conversation.slice(-10);
    }
    
    const messages = conversation.map(msg => ({
        role: msg.role,
        content: msg.content
    }));
    
    try {
        console.log('🤖 Calling OpenRouter API...');
        
        const response = await axios({
            method: 'POST',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://whatsapp.com',
                'X-Title': 'S7 SAFWAN AI Bot'
            },
            data: {
                model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
                messages: messages,
                temperature: 0.7,
                max_tokens: 1500
            },
            timeout: 30000
        });
        
        if (response.data?.choices?.[0]?.message?.content) {
            let aiResponse = response.data.choices[0].message.content;
            
            // Clean and format the response
            aiResponse = cleanResponse(aiResponse);
            
            conversation.push({ role: 'assistant', content: aiResponse });
            conversationMemory.set(memoryKey, conversation);
            
            console.log('✅ OpenRouter API responded!');
            return aiResponse;
        }
        
        throw new Error('Invalid response from OpenRouter');
        
    } catch (error) {
        console.error('OpenRouter API Error:', error.response?.data || error.message);
        
        // Fallback to Gemini
        try {
            console.log('🔄 Trying Gemini fallback...');
            const fallbackResponse = await axios({
                method: 'POST',
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    model: 'google/gemini-2.0-flash-exp:free',
                    messages: [{ role: 'user', content: message }],
                    temperature: 0.7,
                    max_tokens: 1000
                },
                timeout: 25000
            });
            
            if (fallbackResponse.data?.choices?.[0]?.message?.content) {
                let content = fallbackResponse.data.choices[0].message.content;
                content = cleanResponse(content);
                conversation.push({ role: 'assistant', content: content });
                conversationMemory.set(memoryKey, conversation);
                console.log('✅ Gemini fallback worked!');
                return content;
            }
        } catch (fallbackError) {
            console.error('Fallback failed:', fallbackError.message);
        }
        
        return null;
    }
}

// Format message for WhatsApp (properly handles code blocks)
function formatWhatsAppMessage(text) {
    if (!text) return '';
    
    // Ensure code blocks are properly formatted for WhatsApp
    let formatted = text;
    
    // Fix code blocks - WhatsApp uses triple backticks
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `\`\`\`${lang || ''}\n${code.trim()}\`\`\``;
    });
    
    // Ensure proper spacing
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // Trim and limit length
    if (formatted.length > 4000) {
        formatted = formatted.substring(0, 3800) + '\n\n... (truncated)';
    }
    
    return formatted;
}

// Main auto-reply handler
async function handleAutoReply(sock, chatId, message, senderId, messageText) {
    try {
        if (message.key.fromMe) return false;
        if (messageText && messageText.startsWith('.')) return false;
        
        if (!isChatEnabled(chatId)) {
            return false;
        }
        
        const isGroup = chatId.endsWith('@g.us');
        
        // Get sender's name
        let senderName = message.pushName || 'User';
        try {
            if (isGroup) {
                const groupMeta = await sock.groupMetadata(chatId);
                const participant = groupMeta.participants.find(p => p.id === senderId);
                if (participant?.name) senderName = participant.name;
            }
        } catch(e) {}
        
        console.log(`🤖 Chatbot: "${messageText}" from ${senderName}`);
        
        // Show typing indicator
        await sock.sendPresenceUpdate('composing', chatId);
        
        // Get AI response
        let aiResponse = await getAIResponse(messageText, senderId, isGroup, senderName);
        
        // Retry once if failed
        if (!aiResponse) {
            console.log('Retrying API call...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            aiResponse = await getAIResponse(messageText, senderId, isGroup, senderName);
        }
        
        if (aiResponse && aiResponse.length > 0) {
            // Random typing delay
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
            
            // Format for WhatsApp
            const finalResponse = formatWhatsAppMessage(aiResponse);
            const formattedMessage = `🤖 *${BOT_NAME} AI:*\n\n${finalResponse}`;
            
            await sock.sendMessage(chatId, {
                text: formattedMessage,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363419197664425@newsletter',
                        newsletterName: BOT_NAME,
                        serverMessageId: -1
                    }
                }
            }, { quoted: message });
            
            console.log(`✅ Replied to: ${chatId}`);
            return true;
        }
        
        // If AI fails
        await sock.sendMessage(chatId, {
            text: `🤖 *${BOT_NAME} AI:*\n\nSorry, I'm having trouble right now. Please try again in a moment. 🙏`
        }, { quoted: message });
        
        return true;
        
    } catch (error) {
        console.error('Auto-reply error:', error);
        return false;
    }
}

// Command: .chatbot on/off
async function chatbotCommand(sock, chatId, message, args) {
    const isGroup = chatId.endsWith('@g.us');
    const chatType = isGroup ? 'group' : 'private chat';
    const action = args[0]?.toLowerCase();
    
    const senderId = message.key.participant || message.key.remoteJid;
    if (!isOwner(senderId) && !message.key.fromMe) {
        return sock.sendMessage(chatId, {
            text: '*❌ Only the bot owner can use this command!*'
        }, { quoted: message });
    }
    
    const settings = loadSettings();
    const isCurrentlyEnabled = settings.enabledChats.includes(chatId);
    
    if (action === 'on') {
        if (!isCurrentlyEnabled) {
            settings.enabledChats.push(chatId);
            saveSettings(settings);
        }
        await sock.sendMessage(chatId, {
            text: `✅ *Chatbot ENABLED for this ${chatType}!*\n\n🤖 I am powered by OpenRouter AI (Nemotron/Gemini).\n\n📝 *Example:* Just send me any message!\n💻 *Code blocks:* Properly formatted\n\nType \`.chatbot off\` to disable.`
        }, { quoted: message });
    } 
    else if (action === 'off') {
        if (isCurrentlyEnabled) {
            settings.enabledChats = settings.enabledChats.filter(id => id !== chatId);
            saveSettings(settings);
        }
        await sock.sendMessage(chatId, {
            text: `❌ *Chatbot DISABLED for this ${chatType}!*`
        }, { quoted: message });
    }
    else {
        const status = isCurrentlyEnabled ? '✅ ENABLED' : '❌ DISABLED';
        await sock.sendMessage(chatId, {
            text: `🤖 *Chatbot Status:* ${status}\n\n📌 *Commands:*\n• .chatbot on - Enable AI\n• .chatbot off - Disable\n• .chatbotall on - Global mode\n• .clearmemory - Reset chat history\n\n💡 *Tip:* Ask me anything! I can write code, answer questions, and more.`
        }, { quoted: message });
    }
}

// Command: .chatbotall on/off
async function chatbotAllCommand(sock, chatId, message, args) {
    const action = args[0]?.toLowerCase();
    
    const senderId = message.key.participant || message.key.remoteJid;
    if (!isOwner(senderId) && !message.key.fromMe) {
        return sock.sendMessage(chatId, {
            text: '*❌ Only the bot owner can use this command!*'
        }, { quoted: message });
    }
    
    const global = loadGlobalMode();
    
    if (action === 'on') {
        global.enabled = true;
        global.enabledSince = new Date().toISOString();
        saveGlobalMode(global);
        await sock.sendMessage(chatId, {
            text: `🌍 *GLOBAL CHATBOT ENABLED!*\n\n✅ All chats will now receive AI auto-replies.`
        }, { quoted: message });
    } 
    else if (action === 'off') {
        global.enabled = false;
        saveGlobalMode(global);
        await sock.sendMessage(chatId, {
            text: `🌍 *GLOBAL CHATBOT DISABLED*\n\n❌ AI replies have been turned off globally.`
        }, { quoted: message });
    }
    else {
        const status = global.enabled ? '✅ ACTIVE' : '❌ INACTIVE';
        await sock.sendMessage(chatId, {
            text: `🌍 *Global Mode:* ${status}\n\n📌 *Commands:*\n• .chatbotall on - Enable for everyone\n• .chatbotall off - Disable globally`
        }, { quoted: message });
    }
}

// Clear memory
async function clearMemory(sock, chatId, message, args) {
    const senderId = message.key.participant || message.key.remoteJid;
    
    const memoryKey1 = `private_${senderId}`;
    const memoryKey2 = `group_${senderId}`;
    
    let cleared = false;
    if (conversationMemory.has(memoryKey1)) {
        conversationMemory.delete(memoryKey1);
        cleared = true;
    }
    if (conversationMemory.has(memoryKey2)) {
        conversationMemory.delete(memoryKey2);
        cleared = true;
    }
    
    await sock.sendMessage(chatId, {
        text: cleared ? '🧹 *Conversation memory cleared!*\n\nI\'ve forgotten our previous conversation. Start fresh!' : 'ℹ️ *No conversation history found.*'
    }, { quoted: message });
}

module.exports = {
    handleAutoReply,
    chatbotCommand,
    chatbotAllCommand,
    clearMemory,
    isChatEnabled,
    loadGlobalMode
};