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
    const CACHE_MAX = 500;

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
    const selectAll = db.prepare('SELECT auth, data FROM player_stats');

    // LRU-ish: refresh position on read, evict oldest insertion when over cap.
    function cachePut(id, data) {
        if (cache.has(id)) cache.delete(id);
        cache.set(id, data);
        if (cache.size > CACHE_MAX) {
            cache.delete(cache.keys().next().value);
        }
    }

    return {
        get length() {
            return countAll.get().count;
        },
        getItem(key) {
            const id = String(key);
            if (cache.has(id)) {
                const hit = cache.get(id);
                cachePut(id, hit);
                return hit;
            }
            const row = selectOne.get(id);
            const data = row?.data ?? null;
            if (data !== null) cachePut(id, data);
            return data;
        },
        setItem(key, value) {
            const id = String(key);
            const data = String(value);
            cachePut(id, data);
            upsert.run(id, data);
        },
        /** All rows in one query — [auth, data] pairs. Bypasses cache (full-scan reads must not evict hot entries). */
        entries() {
            return selectAll.all().map((row) => [row.auth, row.data]);
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

const IDENTITY_SCHEMA = `
    CREATE TABLE IF NOT EXISTS identity_links (
        auth TEXT NOT NULL,
        conn TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (auth, conn)
    );
    CREATE INDEX IF NOT EXISTS idx_identity_conn ON identity_links(conn);

    CREATE TABLE IF NOT EXISTS auth_names (
        auth TEXT NOT NULL,
        name TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (auth, name)
    );

    CREATE TABLE IF NOT EXISTS conn_sightings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conn TEXT NOT NULL,
        auth TEXT NOT NULL,
        name TEXT NOT NULL,
        seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conn_sightings_conn ON conn_sightings(conn);
    CREATE INDEX IF NOT EXISTS idx_conn_sightings_auth ON conn_sightings(auth);

    CREATE TABLE IF NOT EXISTS player_ignores (
        owner_auth TEXT NOT NULL,
        target_auth TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (owner_auth, target_auth)
    );
`;

function openIdentityDatabase(dbPath) {
    const db = openDatabase(dbPath);
    db.run(IDENTITY_SCHEMA);
    return db;
}

/**
 * Persisted auth↔conn graph and per-auth name history for !whois.
 * @param {string} dbPath
 */
export function createIdentityStore(dbPath) {
    const db = openIdentityDatabase(dbPath);
    const now = () => Date.now();
    const ignoreCache = new Map();
    const IGNORE_CACHE_MAX = 5000;
    const IGNORE_LIMIT = 100;

    const upsertLink = db.prepare(`
        INSERT INTO identity_links (auth, conn, last_seen) VALUES (?, ?, ?)
        ON CONFLICT(auth, conn) DO UPDATE SET last_seen = excluded.last_seen
    `);
    const upsertName = db.prepare(`
        INSERT INTO auth_names (auth, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
        ON CONFLICT(auth, name) DO UPDATE SET last_seen = excluded.last_seen
    `);
    const nameCount = db.prepare('SELECT COUNT(*) AS count FROM auth_names WHERE auth = ?');
    const selectStatsName = db.prepare('SELECT data FROM player_stats WHERE auth = ?');
    const authsForConn = db.prepare('SELECT auth FROM identity_links WHERE conn = ?');
    const connsForAuth = db.prepare('SELECT conn FROM identity_links WHERE auth = ?');
    const nameHistory = db.prepare(`
        SELECT name, first_seen, last_seen FROM auth_names
        WHERE auth = ? ORDER BY last_seen DESC
    `);
    const insertSighting = db.prepare(`
        INSERT INTO conn_sightings (conn, auth, name, seen_at) VALUES (?, ?, ?, ?)
    `);
    const sightingsForConn = db.prepare(`
        SELECT auth, name, seen_at FROM conn_sightings
        WHERE conn = ? ORDER BY seen_at DESC
    `);
    const ignoredAuthsForOwner = db.prepare(`
        SELECT target_auth FROM player_ignores
        WHERE owner_auth = ? ORDER BY created_at, rowid
    `);
    const ignoredCountForOwner = db.prepare(`
        SELECT COUNT(*) AS count FROM player_ignores WHERE owner_auth = ?
    `);
    const hasIgnore = db.prepare(`
        SELECT 1 FROM player_ignores WHERE owner_auth = ? AND target_auth = ?
    `);
    const insertIgnore = db.prepare(`
        INSERT OR IGNORE INTO player_ignores (owner_auth, target_auth, created_at)
        VALUES (?, ?, ?)
    `);
    const deleteIgnore = db.prepare(`
        DELETE FROM player_ignores WHERE owner_auth = ? AND target_auth = ?
    `);

    function ignoreCacheKey(ownerAuth, targetAuth) {
        return JSON.stringify([ownerAuth, targetAuth]);
    }

    function cacheIgnore(ownerAuth, targetAuth, ignored) {
        const key = ignoreCacheKey(ownerAuth, targetAuth);
        if (ignoreCache.has(key)) ignoreCache.delete(key);
        ignoreCache.set(key, ignored);
        if (ignoreCache.size > IGNORE_CACHE_MAX) {
            ignoreCache.delete(ignoreCache.keys().next().value);
        }
    }

    function ignoreAuth(ownerAuth, targetAuth) {
        if (!ownerAuth || !targetAuth || ownerAuth === targetAuth) return false;
        if (isIgnoring(ownerAuth, targetAuth) || ignoreLimitReached(ownerAuth)) return false;
        const result = insertIgnore.run(ownerAuth, targetAuth, now());
        if (result.changes === 0) return false;
        cacheIgnore(ownerAuth, targetAuth, true);
        return true;
    }

    function unignoreAuth(ownerAuth, targetAuth) {
        if (!ownerAuth || !targetAuth) return false;
        const result = deleteIgnore.run(ownerAuth, targetAuth);
        if (result.changes === 0) return false;
        cacheIgnore(ownerAuth, targetAuth, false);
        return true;
    }

    function isIgnoring(ownerAuth, targetAuth) {
        if (!ownerAuth || !targetAuth) return false;
        const key = ignoreCacheKey(ownerAuth, targetAuth);
        if (ignoreCache.has(key)) {
            const ignored = ignoreCache.get(key);
            cacheIgnore(ownerAuth, targetAuth, ignored);
            return ignored;
        }
        const ignored = hasIgnore.get(ownerAuth, targetAuth) != null;
        cacheIgnore(ownerAuth, targetAuth, ignored);
        return ignored;
    }

    function ignoreLimitReached(ownerAuth) {
        if (!ownerAuth) return false;
        return ignoredCountForOwner.get(ownerAuth).count >= IGNORE_LIMIT;
    }

    function listIgnoredAuths(ownerAuth) {
        if (!ownerAuth) return [];
        return ignoredAuthsForOwner.all(ownerAuth).map((row) => row.target_auth);
    }

    function seedStatsName(auth, ts) {
        const row = selectStatsName.get(auth);
        if (!row?.data) return;
        try {
            const parsed = JSON.parse(row.data);
            const seed = parsed?.playerName;
            if (typeof seed === 'string' && seed.length > 0) {
                upsertName.run(auth, seed, ts, ts);
            }
        } catch {
            /* skip corrupt rows */
        }
    }

    function recordLink(auth, conn, name) {
        if (!auth || !conn) return;
        const ts = now();
        upsertLink.run(auth, conn, ts);
        if (name) insertSighting.run(conn, auth, name, ts);
    }

    function recordName(auth, name) {
        if (!auth || !name) return;
        const ts = now();
        if (nameCount.get(auth).count === 0) seedStatsName(auth, ts);
        upsertName.run(auth, name, ts, ts);
    }

    function getNameHistory(auth) {
        if (!auth) return [];
        return nameHistory.all(auth);
    }

    function latestName(auth) {
        const hist = getNameHistory(auth);
        return hist.length > 0 ? hist[0].name : '?';
    }

    function authsByConn(conn) {
        if (!conn) return [];
        const auths = new Set(authsForConn.all(conn).map((r) => r.auth));
        for (const row of sightingsForConn.all(conn)) auths.add(row.auth);
        return [...auths];
    }

    /** Every account + all names ever seen on this network. */
    function getConnAccounts(conn) {
        if (!conn) return [];
        const byAuth = new Map();

        function addName(auth, name, seenAt) {
            if (!auth || !name) return;
            if (!byAuth.has(auth)) byAuth.set(auth, { auth, names: new Map(), lastSeen: 0 });
            const entry = byAuth.get(auth);
            const prev = entry.names.get(name) ?? 0;
            if (seenAt > prev) entry.names.set(name, seenAt);
            if (seenAt > entry.lastSeen) entry.lastSeen = seenAt;
        }

        for (const row of sightingsForConn.all(conn)) {
            addName(row.auth, row.name, row.seen_at);
        }

        const auths = new Set(authsForConn.all(conn).map((r) => r.auth));
        for (const row of sightingsForConn.all(conn)) auths.add(row.auth);

        for (const auth of auths) {
            for (const nameRow of nameHistory.all(auth)) {
                addName(auth, nameRow.name, nameRow.last_seen);
            }
        }

        return [...byAuth.values()]
            .map((entry) => ({
                auth: entry.auth,
                names: [...entry.names.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([name]) => name),
                lastSeen: entry.lastSeen,
            }))
            .sort((a, b) => b.lastSeen - a.lastSeen);
    }

    function connsByAuth(auth) {
        if (!auth) return [];
        return connsForAuth.all(auth).map((r) => r.conn);
    }

    /** BFS over DB links plus optional live session pairs. */
    function getLinkedCluster(seedAuth, seedConn, extraLinks = []) {
        const auths = new Set();
        const conns = new Set();
        if (seedAuth) auths.add(seedAuth);
        if (seedConn) conns.add(seedConn);

        const liveByAuth = new Map();
        const liveByConn = new Map();
        for (const link of extraLinks) {
            if (!link?.auth || !link?.conn) continue;
            if (!liveByAuth.has(link.auth)) liveByAuth.set(link.auth, new Set());
            liveByAuth.get(link.auth).add(link.conn);
            if (!liveByConn.has(link.conn)) liveByConn.set(link.conn, new Set());
            liveByConn.get(link.conn).add(link.auth);
        }

        let changed = true;
        while (changed) {
            changed = false;
            for (const c of conns) {
                for (const row of authsForConn.all(c)) {
                    if (!auths.has(row.auth)) {
                        auths.add(row.auth);
                        changed = true;
                    }
                }
                const liveAuths = liveByConn.get(c);
                if (liveAuths) {
                    for (const a of liveAuths) {
                        if (!auths.has(a)) {
                            auths.add(a);
                            changed = true;
                        }
                    }
                }
            }
            for (const a of auths) {
                for (const row of connsForAuth.all(a)) {
                    if (!conns.has(row.conn)) {
                        conns.add(row.conn);
                        changed = true;
                    }
                }
                const liveConns = liveByAuth.get(a);
                if (liveConns) {
                    for (const c of liveConns) {
                        if (!conns.has(c)) {
                            conns.add(c);
                            changed = true;
                        }
                    }
                }
            }
        }
        return { auths, conns };
    }

    return {
        recordLink,
        recordName,
        getNameHistory,
        latestName,
        authsByConn,
        connsByAuth,
        getConnAccounts,
        getLinkedCluster,
        ignoreAuth,
        unignoreAuth,
        isIgnoring,
        ignoreLimit: IGNORE_LIMIT,
        ignoreLimitReached,
        listIgnoredAuths,
    };
}
