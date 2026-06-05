import { join } from 'path';

export async function loadRoomConfig(baseDir) {
    const configPath = join(baseDir, 'config.json');
    const examplePath = join(baseDir, 'config.example.json');

    let file = Bun.file(configPath);
    let configFile = configPath;
    if (!(await file.exists())) {
        console.warn('config.json not found, using config.example.json');
        file = Bun.file(examplePath);
        configFile = null;
    }

    const config = await file.json();

    return {
        ...config,
        token: process.env.HAXBALL_TOKEN ?? '',
        roomWebhook: process.env.ROOM_WEBHOOK ?? '',
        gameWebhook: process.env.GAME_WEBHOOK ?? '',
        configFile,
    };
}

/** Persist permanent admins to config.json (auth + display name pairs). */
export async function saveRoomAdmins(configFile, admins) {
    if (!configFile) return false;
    const file = Bun.file(configFile);
    if (!(await file.exists())) return false;
    const config = await file.json();
    config.admins = admins;
    await Bun.write(configFile, JSON.stringify(config, null, 2) + '\n');
    return true;
}
