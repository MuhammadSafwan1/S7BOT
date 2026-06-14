const axios = require('axios');
const settings = require('../../settings');
const { sleep } = require('../../lib/myfunc');
const { storeLinkedUser } = require('../../lib/mongoStore');

function normalizeHost(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, '');
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return `https://${trimmed}`;
    return null;
}

function getDynamicPairHosts() {
    const hosts = [
        process.env.PAIR_API_BASE,
        settings.pairApiBase,
        process.env.DEPLOYMENT_HOST,
        process.env.RENDER_EXTERNAL_URL,
        process.env.RAILWAY_STATIC_URL,
        process.env.RAILWAY_PUBLIC_DOMAIN,
        process.env.KOYEB_PUBLIC_DOMAIN,
        process.env.CYCLIC_URL,
        process.env.URL,
        process.env.VERCEL_URL
    ];

    if (process.env.REPLIT_DOMAINS) {
        hosts.push(...String(process.env.REPLIT_DOMAINS).split(','));
    }

    // Public fallback pair servers — add your own hosted one here
    hosts.push(
        'https://knight-bot-paircode.onrender.com',
        'https://pair.bot-hosting.net'
    );

    const normalized = hosts.map(normalizeHost).filter(Boolean);
    return [...new Set(normalized)];
}

function channelContext() {
    return {
        contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
                newsletterName: 'Muhammad Safwan',
                serverMessageId: -1
            }
        }
    };
}

async function requestCodeFromHosts(number) {
    const pairHosts = getDynamicPairHosts();

    if (!pairHosts.length) {
        throw new Error('No pair hosts configured');
    }

    console.log(`🔍 Trying ${pairHosts.length} pair host(s) for: ${number}`);

    for (const base of pairHosts) {
        try {
            console.log(`   → Trying: ${base}`);

            const response = await axios.get(`${base.replace(/\/$/, '')}/code`, {
                params: { number },
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                }
            });

            const code = response?.data?.code;

            if (code && code !== 'Service Unavailable' && code !== 'null' && code !== 'undefined') {
                console.log(`   ✅ Success from: ${base}`);
                return String(code).trim();
            }

            console.log(`   ⚠️ Bad response from ${base}:`, response?.data);
        } catch (err) {
            console.log(`   ❌ ${base} — ${err.message}`);
        }
    }

    throw new Error('All pairing hosts failed or returned invalid codes');
}

async function pairCommand(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: [
                    '*📱 Pairing Code Generator*',
                    '',
                    'Provide a WhatsApp number with country code (no + or spaces).',
                    '',
                    'Example:',
                    '*.pair 923315546339*',
                    '*.pair 12025550123*'
                ].join('\n'),
                ...channelContext()
            }, { quoted: message });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length > 5 && v.length < 20);

        if (!numbers.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Invalid number format.\n\nExample: *.pair 923315546339*',
                ...channelContext()
            }, { quoted: message });
        }

        for (const number of numbers) {
            const whatsappID = `${number}@s.whatsapp.net`;

            // Check if number exists on WhatsApp
            try {
                const result = await sock.onWhatsApp(whatsappID);
                if (!result?.[0]?.exists) {
                    await sock.sendMessage(chatId, {
                        text: `❌ Number *${number}* is not registered on WhatsApp.`,
                        ...channelContext()
                    }, { quoted: message });
                    continue;
                }
            } catch (checkErr) {
                console.log(`⚠️ onWhatsApp check failed (continuing anyway): ${checkErr.message}`);
            }

            await sock.sendMessage(chatId, {
                text: `⏳ Generating pairing code for *${number}*...\nThis may take up to 20 seconds.`,
                ...channelContext()
            }, { quoted: message });

            let code = null;

            try {
                code = await requestCodeFromHosts(number);
            } catch (err) {
                console.error(`❌ Failed to get code for ${number}:`, err.message);
            }

            if (!code) {
                await sock.sendMessage(chatId, {
                    text: [
                        '❌ *Failed to generate pairing code*',
                        '',
                        `📱 Number: ${number}`,
                        '',
                        '*Possible reasons:*',
                        '• This number is already linked to WhatsApp Web/Desktop',
                        '• Multi-device is not enabled on this number',
                        '• Pair API server is temporarily down',
                        '',
                        'Please log out of all linked devices first, then try again.'
                    ].join('\n'),
                    ...channelContext()
                }, { quoted: message });
                continue;
            }

            await sleep(1000);

            // Store linked user (non-blocking)
            storeLinkedUser({
                phone: number,
                jid: whatsappID,
                source: 'pair_command',
                requestedBy: message.key.participant || message.key.remoteJid,
                chatId,
                requestedAt: new Date().toISOString()
            }).catch((e) => console.error('storeLinkedUser error:', e.message));

            await sock.sendMessage(chatId, {
                text: [
                    '✅ *Pairing Code Generated Successfully!*',
                    '',
                    `📱 Number: *${number}*`,
                    `🔐 Code: *${code}*`,
                    '',
                    '📋 *How to link:*',
                    '1. Open WhatsApp on your phone',
                    '2. Go to *Settings → Linked Devices*',
                    '3. Tap *"Link a Device"*',
                    '4. Tap *"Link with phone number instead"*',
                    '5. Enter the code above',
                    '',
                    '⏱️ Code expires in *60 seconds!*'
                ].join('\n'),
                buttons: [
                    { buttonId: `copy_pair:${code}`, buttonText: { displayText: '📋 Copy Code' }, type: 1 },
                    { buttonId: 'support', buttonText: { displayText: '👥 Join Support Group' }, type: 1 }
                ],
                headerType: 1,
                ...channelContext()
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Pair command error:', error);
        await sock.sendMessage(chatId, {
            text: '❌ An unexpected error occurred. Please try again later.',
            ...channelContext()
        }, { quoted: message });
    }
}

module.exports = pairCommand;