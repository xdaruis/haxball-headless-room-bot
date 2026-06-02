import HaxballJS from 'haxball.js';
import { join } from 'path';
import { loadRoomConfig } from './config.js';
import { createSqliteStorage } from './storage.js';
import { loadStadiumCatalog } from './stadiums.js';

globalThis.localStorage = createSqliteStorage(join(import.meta.dir, 'data', 'stats.db'));
console.log(`Player stats loaded: ${globalThis.localStorage.length} players in database`);
globalThis.roomConfig = await loadRoomConfig(import.meta.dir);
globalThis.HBInit = await HaxballJS();
globalThis.stadiumCatalog = await loadStadiumCatalog(join(import.meta.dir, 'stadiums'));

await import('./room.js');
