import HaxballJS from 'haxball.js';
import { createMemoryStorage } from './storage.js';

globalThis.localStorage = createMemoryStorage();
globalThis.HBInit = await HaxballJS();

await import('./room.js');
