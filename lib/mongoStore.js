const { MongoClient } = require('mongodb');
const settings = require('../settings');

const MONGO_URI = process.env.MONGO_URI || settings.mongoUri || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || settings.mongoDbName || 'gods_zeal_xmd';

let client;
let db;

function sanitizeMongoMessage(message) {
    return String(message || '')
        .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, '[MONGO_URI_REDACTED]')
        .replace(/password=[^&\s]+/gi, 'password=[REDACTED]');
}

async function ensureDb() {
    if (!MONGO_URI) return null;
    if (db) return db;
    client = new MongoClient(MONGO_URI, { maxPoolSize: 5 });
    await client.connect();
    db = client.db(MONGO_DB_NAME);
    return db;
}

async function upsertPayload(collectionName, identity, payload) {
    try {
        const mongo = await ensureDb();
        if (!mongo) return false;
        await mongo.collection(collectionName).updateOne(
            identity,
            {
                $set: {
                    identity,
                    payload,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error(`[mongoStore] ${collectionName} upsert failed:`, sanitizeMongoMessage(error.message));
        return false;
    }
}

async function initializeMongoStore() {
    if (!MONGO_URI) {
        console.log('[mongoStore] Mongo URI not set. Running without remote Mongo sync.');
        return false;
    }

    try {
        const mongo = await ensureDb();
        const [linkedUsers, economyUsers] = await Promise.all([
            mongo.collection('linked_users').countDocuments(),
            mongo.collection('economy_users').countDocuments()
        ]);
        console.log(`[mongoStore] Connected. Loaded existing users: linked=${linkedUsers}, economy=${economyUsers}`);
        return true;
    } catch (error) {
        console.error('[mongoStore] Connection failed:', sanitizeMongoMessage(error.message));
        return false;
    }
}

async function storeLinkedUser(entry) {
    if (!entry?.phone && !entry?.jid) return false;
    const identity = { key: entry.jid || entry.phone };
    return upsertPayload('linked_users', identity, entry);
}

async function storeEconomyUser(entry) {
    if (!entry?.user_id) return false;
    return upsertPayload('economy_users', { key: entry.user_id }, entry);
}

async function storeChannelAction(entry) {
    const key = `${entry?.action || 'unknown'}:${entry?.initiator || 'na'}:${entry?.target || 'na'}`;
    return upsertPayload('channel_actions', { key }, entry);
}

async function storeAutoTargets(entry) {
    return upsertPayload('auto_targets', { key: 'default' }, entry || {});
}

module.exports = {
    initializeMongoStore,
    storeLinkedUser,
    storeEconomyUser,
    storeChannelAction,
    storeAutoTargets,
};
