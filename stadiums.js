import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const STADIUM_META_KEYS = ['scoreLimit', 'timeLimit'];

function stripStadiumMeta(parsed) {
    const stadium = { ...parsed };
    for (const key of STADIUM_META_KEYS) {
        delete stadium[key];
    }
    return stadium;
}

export async function loadStadiumCatalog(stadiumsDir) {
    const files = (await readdir(stadiumsDir))
        .filter((f) => f.endsWith('.hbs'))
        .sort((a, b) => a.localeCompare(b));

    const catalog = [];
    for (const file of files) {
        const raw = await readFile(join(stadiumsDir, file), 'utf8');
        try {
            const parsed = JSON.parse(raw);
            catalog.push({
                id: catalog.length + 1,
                file,
                key: file.replace(/\.hbs$/, ''),
                name: parsed.name ?? file.replace(/\.hbs$/, ''),
                scoreLimit: parsed.scoreLimit ?? null,
                timeLimit: parsed.timeLimit ?? null,
                data: JSON.stringify(stripStadiumMeta(parsed)),
            });
        } catch (e) {
            console.error(`Failed to parse stadium ${file}:`, e);
        }
    }
    return catalog;
}
