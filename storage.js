import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS player_stats (
        auth TEXT PRIMARY KEY,
        data TEXT NOT NULL
    )
`;

function openDatabase(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.run(SCHEMA);
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
    return db;
}

/**
 * Create data dir + player_stats table. Safe to run multiple times.
 * @param {string} dbPath
 * @returns {{ dbPath: string, playerCount: number }}
 */
export function initPlayerStatsDb(dbPath) {
    const db = openDatabase(dbPath);
    const playerCount = db.prepare('SELECT COUNT(*) AS count FROM player_stats').get().count;
    db.close();
    return { dbPath, playerCount };
}

/**
 * localStorage-shaped API backed by SQLite (auth -> JSON string).
 * @param {string} dbPath
 * @returns {Storage}
 */
export function createSqliteStorage(dbPath) {
    const db = openDatabase(dbPath);
    const cache = new Map();

    const selectOne = db.prepare('SELECT data FROM player_stats WHERE auth = ?');
    const upsert = db.prepare(`
        INSERT INTO player_stats (auth, data) VALUES (?, ?)
        ON CONFLICT(auth) DO UPDATE SET data = excluded.data
    `);
    const remove = db.prepare('DELETE FROM player_stats WHERE auth = ?');
    const countAll = db.prepare('SELECT COUNT(*) AS count FROM player_stats');
    const keyAt = db.prepare(`
        SELECT auth FROM player_stats ORDER BY auth LIMIT 1 OFFSET ?
    `);

    return {
        get length() {
            return countAll.get().count;
        },
        getItem(key) {
            const id = String(key);
            if (cache.has(id)) return cache.get(id);
            const row = selectOne.get(id);
            const data = row?.data ?? null;
            if (data !== null) cache.set(id, data);
            return data;
        },
        setItem(key, value) {
            const id = String(key);
            const data = String(value);
            cache.set(id, data);
            upsert.run(id, data);
        },
        removeItem(key) {
            const id = String(key);
            cache.delete(id);
            remove.run(id);
        },
        key(index) {
            const row = keyAt.get(index);
            return row?.auth ?? null;
        },
        clear() {
            cache.clear();
            db.run('DELETE FROM player_stats');
        },
    };
}
