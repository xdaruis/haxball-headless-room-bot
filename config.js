import { join } from 'path';

export async function loadRoomConfig(baseDir) {
    const configPath = join(baseDir, 'config.json');
    const examplePath = join(baseDir, 'config.example.json');

    let file = Bun.file(configPath);
    if (!(await file.exists())) {
        console.warn('config.json not found, using config.example.json');
        file = Bun.file(examplePath);
    }

    const config = await file.json();

    return {
        ...config,
        token: process.env.HAXBALL_TOKEN ?? '',
        roomWebhook: process.env.ROOM_WEBHOOK ?? '',
        gameWebhook: process.env.GAME_WEBHOOK ?? '',
    };
}
