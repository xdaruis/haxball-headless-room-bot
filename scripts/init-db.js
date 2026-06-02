import { join } from 'path';
import { initPlayerStatsDb } from '../storage.js';

const dbPath = join(import.meta.dir, '..', 'data', 'stats.db');
const { playerCount } = initPlayerStatsDb(dbPath);

console.log(`Database ready: ${dbPath}`);
console.log(`Players stored: ${playerCount}`);
