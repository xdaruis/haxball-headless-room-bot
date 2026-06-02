import HaxballJS from 'haxball.js';
import { join } from 'path';
import { createMemoryStorage } from './storage.js';
import { loadStadiumCatalog } from './stadiums.js';

globalThis.localStorage = createMemoryStorage();
globalThis.HBInit = await HaxballJS();
globalThis.stadiumCatalog = await loadStadiumCatalog(join(import.meta.dir, 'stadiums'));

await import('./room.js');
