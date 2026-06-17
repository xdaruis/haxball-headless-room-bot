import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const STADIUM_META_KEYS = ['scoreLimit', 'timeLimit'];
const DEFAULT_PHYSICS_STADIUM_PATTERN = '^Futsal';

function stripStadiumMeta(parsed) {
    const stadium = { ...parsed };
    for (const key of STADIUM_META_KEYS) {
        delete stadium[key];
    }
    return stadium;
}

/** Apply shared physics.json to a stadium object (mutates in place). */
export function applyPhysicsToStadium(stadium, physics) {
    if (!physics || !stadium) return stadium;
    if (physics.playerPhysics) {
        stadium.playerPhysics = { ...physics.playerPhysics };
    }
    if (!physics.ballPhysics) return stadium;

    const ball = physics.ballPhysics;
    const ref = stadium.ballPhysics;
    if (typeof ref === 'string' && /^disc\d+$/.test(ref)) {
        const idx = Number(ref.slice(4));
        const disc = stadium.discs?.[idx];
        if (disc) {
            if (ball.radius != null) disc.radius = ball.radius;
            if (ball.bCoef != null) disc.bCoef = ball.bCoef;
            if (ball.invMass != null) disc.invMass = ball.invMass;
            if (ball.color != null) disc.color = ball.color;
            if (!disc.cGroup?.includes('ball')) {
                disc.cGroup = ['ball', 'kick', 'score'];
            }
        }
    } else {
        stadium.ballPhysics = { ...ball };
    }
    return stadium;
}

async function loadPhysicsFile(physicsFile) {
    if (!physicsFile) return null;
    try {
        return JSON.parse(await readFile(physicsFile, 'utf8'));
    } catch (e) {
        console.warn(`physics file not loaded (${physicsFile}):`, e.message);
        return null;
    }
}

export async function loadStadiumCatalog(stadiumsDir, options = {}) {
    const physics = await loadPhysicsFile(options.physicsFile);
    const physicsPattern = new RegExp(
        options.physicsStadiumPattern ?? DEFAULT_PHYSICS_STADIUM_PATTERN,
        'i'
    );

    const files = (await readdir(stadiumsDir))
        .filter((f) => f.endsWith('.hbs'))
        .sort((a, b) => a.localeCompare(b));

    const catalog = [];
    for (const file of files) {
        const raw = await readFile(join(stadiumsDir, file), 'utf8');
        try {
            const parsed = JSON.parse(raw);
            if (physics && physicsPattern.test(file)) {
                applyPhysicsToStadium(parsed, physics);
            }
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
