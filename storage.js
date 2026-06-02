/** @type {Map<string, string>} In-memory stats backing store (SQLite later). */
export const playerStatsStore = new Map();

/**
 * localStorage-shaped API over `playerStatsStore`.
 * @returns {Storage}
 */
export function createMemoryStorage() {
    return {
        get length() {
            return playerStatsStore.size;
        },
        getItem(key) {
            const value = playerStatsStore.get(String(key));
            return value === undefined ? null : value;
        },
        setItem(key, value) {
            playerStatsStore.set(String(key), String(value));
        },
        removeItem(key) {
            playerStatsStore.delete(String(key));
        },
        key(index) {
            return [...playerStatsStore.keys()][index] ?? null;
        },
        clear() {
            playerStatsStore.clear();
        },
    };
}
