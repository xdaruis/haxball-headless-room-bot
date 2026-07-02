import { createDebouncedQueue } from './rosterQueue.js';
import { saveRoomAdmins } from './config.js';

/* VARIABLES */

const FONT_FORMAT = {
    bold: 'bold',
}
/* ROOM */

const cfg = globalThis.roomConfig;
const configFile = cfg.configFile ?? null;
const roomName = cfg.roomName;
const maxPlayers = cfg.maxPlayers;
const roomPublic = cfg.public;
const token = cfg.token;

var roomWebhook = cfg.roomWebhook;
var gameWebhook = cfg.gameWebhook;
var fetchRecordingVariable = cfg.fetchRecording;
var timeLimit = cfg.timeLimit;
var scoreLimit = cfg.scoreLimit;

var gameConfig = {
    roomName: roomName,
    maxPlayers: maxPlayers,
    public: roomPublic,
    noPlayer: true,
};

if (
    cfg.geo &&
    typeof cfg.geo.code === 'string' &&
    typeof cfg.geo.lat === 'number' &&
    typeof cfg.geo.lon === 'number'
) {
    gameConfig.geo = {
        code: cfg.geo.code,
        lat: cfg.geo.lat,
        lon: cfg.geo.lon,
    };
}

if (typeof token == 'string' && token.length == 39) {
    gameConfig.token = token;
}

var room = globalThis.HBInit(gameConfig);

var stadiumCatalog = globalThis.stadiumCatalog ?? [];
var currentStadium = '';

room.setScoreLimit(scoreLimit);
room.setTimeLimit(timeLimit);
room.setTeamsLock(true);
room.setKickRateLimit(6, 0, 0);

var masterPassword = 10000 + getRandomInt(90000);
var roomPassword = '';

/* OPTIONS */

var drawTimeLimit = 1; // golden-goal OT minutes after regulation tie; 0 = instant draw at full time
var teamSize = cfg.teamSize;
var stadiumKeys = cfg.stadiumKeys;
var maxAdmins = cfg.maxAdmins;
var disableBans = cfg.disableBans;
var debugMode = cfg.debugMode;
var kickoffAfkWarnSeconds = typeof cfg.kickoffAfkWarnSeconds === 'number' ? cfg.kickoffAfkWarnSeconds : 10;
var kickoffAfkForfeitSeconds = typeof cfg.kickoffAfkForfeitSeconds === 'number' ? cfg.kickoffAfkForfeitSeconds : 20;
var kickoffAfkWindowSeconds = typeof cfg.kickoffAfkWindowSeconds === 'number' ? cfg.kickoffAfkWindowSeconds : 30;
var forfeitGraceSeconds = typeof cfg.forfeitGraceSeconds === 'number' ? cfg.forfeitGraceSeconds : 10;
var afkInactivitySeconds = typeof cfg.afkInactivitySeconds === 'number' ? cfg.afkInactivitySeconds : 12;
var afkMinDurationMinutes = typeof cfg.afkMinDurationMinutes === 'number' ? cfg.afkMinDurationMinutes : 1;
var afkMaxDurationMinutes = typeof cfg.afkMaxDurationMinutes === 'number' ? cfg.afkMaxDurationMinutes : 30;
var afkCooldownMinutes = typeof cfg.afkCooldownMinutes === 'number' ? cfg.afkCooldownMinutes : 10;
var chooseTime = typeof cfg.chooseTimeSeconds === 'number' ? cfg.chooseTimeSeconds : 10;

var defaultSlowMode = 0.5;
var chooseModeSlowMode = 1;
var slowMode = defaultSlowMode;
var SMSet = new Set();

var hideClaimMessage = true;
var mentionPlayersUnpause = true;

/* OBJECTS */

class Goal {
    constructor(time, team, striker, assist) {
        this.time = time;
        this.team = team;
        this.striker = striker;
        this.assist = assist;
    }
}

class Game {
    constructor() {
        this.date = Date.now();
        this.scores = room.getScores();
        this.playerComp = getStartingLineups();
        this.compIndex = buildCompIndex(this.playerComp);
        this.goals = [];
        this.rec = room.startRecording();
        this.touchArray = [];
    }
}

class PlayerComposition {
    constructor(player, auth, timeEntry, timeExit) {
        this.player = player;
        this.auth = auth;
        this.timeEntry = timeEntry;
        this.timeExit = timeExit;
        this.inactivityTicks = 0;
        this.GKTicks = 0;
        this.goalsScoredTeam = 0;
        this.goalsConcededTeam = 0;
    }
}

class MutePlayer {
    constructor(name, id, auth) {
        this.id = MutePlayer.incrementId();
        this.name = name;
        this.playerId = id;
        this.auth = auth;
        this.unmuteTimeout = null;
    }

    static incrementId() {
        if (!this.latestId) this.latestId = 1
        else this.latestId++
        return this.latestId
    }

    setDuration(minutes) {
        this.unmuteTimeout = setTimeout(() => {
            room.sendAnnouncement(
                `Unmuted. Can chat again.`,
                this.playerId,
                announcementColor,
                FONT_FORMAT.bold,
                HaxNotification.CHAT
            );
            this.remove();
        }, minutes * 60 * 1000);
        muteArray.add(this);
    }

    remove() {
        clearTimeout(this.unmuteTimeout);
        this.unmuteTimeout = null;
        muteArray.removeById(this.id);
    }
}

class MuteList {
    constructor() {
        this.list = [];
    }

    add(mutePlayer) {
        this.list.push(mutePlayer);
        return mutePlayer;
    }

    getById(id) {
        var index = this.list.findIndex(mutePlayer => mutePlayer.id === id);
        if (index !== -1) {
            return this.list[index];
        }
        return null;
    }

    getByPlayerId(id) {
        var index = this.list.findIndex(mutePlayer => mutePlayer.playerId === id);
        if (index !== -1) {
            return this.list[index];
        }
        return null;
    }

    getByAuth(auth) {
        var index = this.list.findIndex(mutePlayer => mutePlayer.auth === auth);
        if (index !== -1) {
            return this.list[index];
        }
        return null;
    }

    removeById(id) {
        var index = this.list.findIndex(mutePlayer => mutePlayer.id === id);
        if (index !== -1) {
            this.list.splice(index, 1);
        }
    }

    removeByAuth(auth) {
        var index = this.list.findIndex(mutePlayer => mutePlayer.auth === auth);
        if (index !== -1) {
            this.list.splice(index, 1);
        }
    }
}

class BallTouch {
    constructor(player, time, goal, position) {
        this.player = player;
        this.time = time;
        this.goal = goal;
        this.position = position;
    }
}

class HaxStatistics {
    constructor(playerName = '') {
        this.playerName = playerName;
        this.games = 0;
        this.wins = 0;
        this.winrate = '0.00%';
        this.playtime = 0;
        this.goals = 0;
        this.assists = 0;
        this.CS = 0;
        this.ownGoals = 0;
    }
}

/* PLAYERS */

const Team = { SPECTATORS: 0, RED: 1, BLUE: 2 };
const State = { PLAY: 0, PAUSE: 1, STOP: 2 };
const Role = { PLAYER: 0, ADMIN_TEMP: 1, ADMIN_PERM: 2, MASTER: 3 };
const HaxNotification = { NONE: 0, CHAT: 1, MENTION: 2 };
const Situation = { STOP: 0, KICKOFF: 1, PLAY: 2, GOAL: 3 };

var gameState = State.STOP;
var playSituation = Situation.STOP;
var goldenGoal = false;

var playersAll = [];
var players = [];
var teamRed = [];
var teamBlue = [];
var teamSpec = [];

var teamRedStats = [];
var teamBlueStats = [];

var banList = [];

/* STATS */

var possession = [0, 0];
var actionZoneHalf = [0, 0];
var lastWinner = Team.SPECTATORS;
var streak = 0;
var pendingRebalance = false;
var pendingRebalanceFormat = null; // '2x2' | '3x3' cached at trigger — currentMatchFormat is null by reconcile time

const MATCH_FORMATS = ['1x1', '2x2', '3x3'];
const LEADERBOARD_TOP_HINT = '!top 2x2 · !elo · !stats · !ranks';
const ELO_DEFAULT = 1000;
const ELO_K = 24;
const ELO_PLACEMENT_GAMES = 10;
const ELO_TRUST_FLOOR = 0.33;
/** Compact ladder anchored at ELO_DEFAULT — tuned for ~200-player pools, not LoL-scale ceilings. */
const ELO_LADDER_BASE = ELO_DEFAULT;
const ELO_DIVISION_SPAN = 20;
const LOL_APEX_BASE = 1280;
const LOL_GRANDMASTER_BASE = 1320;
const CHALLENGER_SLOTS_PER_FORMAT = 3;
/** Forfeit tuning — 2× leaver / 0.5× winner on 90-Elo divisions; scale down with compact span. */
const ELO_FORFEIT_SPAN_REF = 90;
const ELO_FORFEIT_LEAVER_MULT = 1 + (ELO_DIVISION_SPAN / ELO_FORFEIT_SPAN_REF);
const ELO_FORFEIT_WINNER_MULT = 1 - 0.5 * (ELO_DIVISION_SPAN / ELO_FORFEIT_SPAN_REF);
const LOL_TIERS = [
    { name: 'Silver', emoji: '🥈', color: 0xc0c0c0 },
    { name: 'Gold', emoji: '🥇', color: 0xffca28 },
    { name: 'Platinum', emoji: '🍀', color: 0x26c6da },
    { name: 'Diamond', emoji: '💎', color: 0x42a5f5 },
];
const LOL_DIVISIONS = ['III', 'II', 'I'];
const LOL_APEX = [
    { name: 'Master', emoji: '🔮', color: 0xab47bc },
    { name: 'Grandmaster', emoji: '⚔', color: 0xef5350 },
    { name: 'Challenger', emoji: '👑', color: 0xffd54f },
];
const LOL_DIVISION_COUNT = LOL_TIERS.length * LOL_DIVISIONS.length;
var challengerAuthsByFormat = Object.fromEntries(MATCH_FORMATS.map((f) => [f, new Set()]));
const LADDER_VERSION = 2;
const LEGACY_LADDER = {
    span: 90,
    apexSpan: 90,
    divisionCount: 28,
    divisions: ['IV', 'III', 'II', 'I'],
    /** Iron/Bronze → Silver; Emerald → Diamond */
    tierToNew: [0, 0, 0, 1, 2, 3, 3],
};
const ELO_UNRANKED = {
    unranked: true,
    label: '🌀 Unranked',
    short: 'Unranked',
    emoji: '🌀',
    tierName: 'Unranked',
    color: 0x9e9e9e,
    tierIndex: 999,
};

function helpMore(cmd) {
    return `Bad command.\nMore: !help ${cmd}`;
}

var currentMatchFormat = null;

/* AUTH */

var authArray = [];
var adminList = [...cfg.admins];
var masterList = [...cfg.masters];

var masterSet = new Set();
var adminAuthSet = new Set();

function rebuildRoleSets() {
    masterSet = new Set(masterList);
    adminAuthSet = new Set(adminList.map((a) => a[0]));
}

rebuildRoleSets();

/* VOTE BAN */
const VOTEBAN_MIN_CONNS = 4;          // distinct connections (real people) required in room
const VOTEBAN_WINDOW_MS = 45000;      // time to gather all yes votes
const VOTEBAN_DURATION_MS = 300000;   // 5 min ban
const VOTEBAN_COOLDOWN_MS = 180000;   // 3 min between vote bans
const VOTEBAN_NEED_PLAYERS_MSG = `Need at least ${VOTEBAN_MIN_CONNS} players on different networks (not same IP/WiFi).`;

/* REJOIN ABUSE GUARD — leave twice within the window = short temp ban (stops lobby format flicker). */
const REJOIN_BAN_WINDOW_MS = 180000;   // 3 min: two leaves inside this window trigger the ban
const REJOIN_BAN_DURATION_MS = 180000; // 3 min temp ban

/* COMMANDS */

var commands = {
    help: {
        aliases: ['commands'],
        roles: Role.PLAYER,
        desc: `
All commands. One command: !help <name>
Example: !help bb`,
        function: helpCommand,
    },
    claim: {
        aliases: [],
        roles: Role.PLAYER,
        desc: false,
        function: masterCommand,
    },
    afk: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
Go AFK. Spec: immediate. On team: queued until match ends.
Min ${afkMinDurationMinutes} min · wait ${afkCooldownMinutes} min between uses.
Stay AFK as long as you want while the room is quiet; once it fills past half you have up to ${afkMaxDurationMinutes} min.`,
        function: afkCommand,
    },
    afks: {
        aliases: ['afklist'],
        roles: Role.PLAYER,
        desc: `List of AFK players.`,
        function: afkListCommand,
    },
    bb: {
        aliases: ['bye', 'gn', 'cya'],
        roles: Role.PLAYER,
        desc: `Leave room fast. Recommended.`,
        function: leaveCommand,
    },
    me: {
        aliases: ['stat', 'stats'],
        roles: Role.PLAYER,
        desc: `
Your stats. !stats or !stats 1x1 / 2x2 / 3x3`,
        function: globalStatsCommand,
    },
    rename: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Change name on leaderboard. !rename [name]`,
        function: renameCommand,
    },
    games: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 games. Optional: !games 2x2`,
        function: statsLeaderboardCommand,
    },
    wins: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 wins. Optional: !wins 2x2`,
        function: statsLeaderboardCommand,
    },
    goals: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 goals. Optional: !goals 2x2`,
        function: statsLeaderboardCommand,
    },
    assists: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 assists. Optional: !assists 2x2`,
        function: statsLeaderboardCommand,
    },
    cs: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 clean sheets (GK). Optional: !cs 2x2`,
        function: statsLeaderboardCommand,
    },
    playtime: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `Top 5 play time. Optional: !playtime 2x2`,
        function: statsLeaderboardCommand,
    },
    elo: {
        aliases: ['rank'],
        roles: Role.PLAYER,
        desc: `Top 5 Elo. Uses lobby format if omitted. Optional: !elo 2x2`,
        function: statsLeaderboardCommand,
    },
    ranks: {
        aliases: ['tiers'],
        roles: Role.PLAYER,
        desc: `Elo rank tiers — compact ladder, same thresholds per format.`,
        function: ranksCommand,
    },
    top: {
        aliases: ['lb', 'leaderboard'],
        roles: Role.PLAYER,
        desc: `
Top 5 wins by format: ${LEADERBOARD_TOP_HINT}
Also: !stats 2x2 · !wins 2x2 · !goals 2x2`,
        function: topCommand,
    },
    voteban: {
        aliases: ['vb'],
        roles: Role.PLAYER,
        desc: `
Start a 5 min vote ban. !voteban #ID
Example: !voteban #3
${VOTEBAN_NEED_PLAYERS_MSG}
Everyone else must type !yes within 45s.`,
        function: voteBanCommand,
    },
    yes: {
        aliases: ['voteyes'],
        roles: Role.PLAYER,
        desc: `Vote yes on a running vote ban. Alts on the same network count as one vote.`,
        function: voteYesCommand,
    },
    map: {
        aliases: ['maps'],
        roles: Role.ADMIN_TEMP,
        desc: `
Map list or load map. Game must be stopped.
!map — list · !map 2 — load map #2`,
        function: mapCommand,
    },
    rr: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `Restart game.`,
        function: restartCommand,
    },
    rrs: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `Swap teams and restart.`,
        function: restartSwapCommand,
    },
    swap: {
        aliases: ['s'],
        roles: Role.ADMIN_TEMP,
        desc: `Swap red/blue. Game must be stopped.`,
        function: swapCommand,
    },
    kickred: {
        aliases: ['kickr'],
        roles: Role.ADMIN_TEMP,
        desc: `Kick all red team. Optional reason after command.`,
        function: kickTeamCommand,
    },
    kickblue: {
        aliases: ['kickb'],
        roles: Role.ADMIN_TEMP,
        desc: `Kick all blue team. Optional reason after command.`,
        function: kickTeamCommand,
    },
    kickspec: {
        aliases: ['kicks'],
        roles: Role.ADMIN_TEMP,
        desc: `Kick all spectators. Optional reason after command.`,
        function: kickTeamCommand,
    },
    mute: {
        aliases: ['m'],
        roles: Role.ADMIN_TEMP,
        desc: `
Mute player chat. Default ${muteDuration} min.
!mute #ID [minutes]
Example: !mute #3 20`,
        function: muteCommand,
    },
    unmute: {
        aliases: ['um'],
        roles: Role.ADMIN_TEMP,
        desc: `
Unmute player.
!unmute #ID  or  !unmute <number from !mutes>
Example: !unmute #300 · !unmute 8`,
        function: unmuteCommand,
    },
    mutes: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `List muted players.`,
        function: muteListCommand,
    },
    clearbans: {
        aliases: [],
        roles: Role.MASTER,
        desc: `Unban all. Or: !clearbans <ban ID>`,
        function: clearbansCommand,
    },
    bans: {
        aliases: ['banlist'],
        roles: Role.MASTER,
        desc: `List banned players and IDs.`,
        function: banListCommand,
    },
    admins: {
        aliases: ['adminlist'],
        roles: Role.MASTER,
        desc: `List permanent admins.`,
        function: adminListCommand,
    },
    setadmin: {
        aliases: ['admin'],
        roles: Role.MASTER,
        desc: `
Give admin. !setadmin #ID
Example: !setadmin #3`,
        function: setAdminCommand,
    },
    setpermadmin: {
        aliases: ['permadmin'],
        roles: Role.MASTER,
        desc: `
Give permanent admin (saved to config). !setpermadmin #ID
Example: !setpermadmin #3`,
        function: setPermAdminCommand,
    },
    removeadmin: {
        aliases: ['unadmin'],
        roles: Role.MASTER,
        desc: `
Remove admin (saved to config). !removeadmin #ID  or  !removeadmin <number from !admins>
Example: !removeadmin #300 · !removeadmin 2`,
        function: removeAdminCommand,
    },
    password: {
        aliases: ['pw'],
        roles: Role.MASTER,
        desc: `
Set room password. !password <text>
Remove password: !password (empty)`,
        function: passwordCommand,
    },
};

/* GAME */

var lastTouches = Array(2).fill(null);
var lastTeamTouched;
var tickBallPosition = null;

var speedCoefficient = 100 / (5 * (0.99 ** 60 + 1));
var ballSpeed = 0;
var playerRadius = 15;
var ballRadius = 10;
var triggerDistance = playerRadius + ballRadius + 0.01;
var triggerDistanceSq = triggerDistance * triggerDistance;
var touchArrayMax = 5;

/* COLORS */

var welcomeColor = 0xc4ff65;
var announcementColor = 0xffefd6;
var infoColor = 0xbebebe;
var privateMessageColor = 0xffc933;
var redColor = 0xff4c4c;
var blueColor = 0x62cbff;
var warningColor = 0xffa135;
var errorColor = 0xa40000;
var successColor = 0x75ff75;
var defaultColor = null;

/* AUXILIARY */

var checkTimeVariable = false;
var checkStadiumVariable = true;
var endGameVariable = false;
var rankedForfeit = false;
var forfeitAuth = null;
var forfeitReason = null;
var formatBrokenMatch = false;
var matchLeavers = [];
var forfeitExemptLeaveIds = new Set();
var cancelGameVariable = false;
var kickFetchVariable = false;

var chooseMode = false;
var timeOutCap;
var capLeft = false;

var AFKSet = new Set();
var AFKQueuedSet = new Set();
var AFKMinSet = new Set();
var AFKCooldownSet = new Set();
var afkStartTime = new Map();   // playerId -> AFK entry timestamp
var afkMaxTimers = new Map();   // playerId -> max-duration timeout handle (absent = indefinite)

var voteBan = null;                   // { targetId, targetAuth, targetConn, targetName, yesConns:Set, timeout }
var voteBanCooldownUntil = 0;
var voteBannedAuths = new Map();      // auth -> expiry ms
var voteBannedConns = new Map();      // conn -> expiry ms

var recentLeaveTimes = new Map();     // auth|conn -> last leave/kick ts
var leaveBannedAuths = new Map();     // auth -> expiry ms
var leaveBannedConns = new Map();     // conn -> expiry ms
var guardExemptIds = new Set();       // ids bounced by the guard itself (don't re-count their leave)

var muteArray = new MuteList();
var muteDuration = 5;

var arranging = false;
var applyingTeams = false;
var lastSpecTime = new Map();

/* Deferred cleanup of per-id state (authArray, lastSpecTime) — ranked stats read leavers' auths after match end, so prune only once the game is stopped. */
var departedPlayerIds = new Set();
var pruneDepartedTimeout = null;

function schedulePruneDeparted(delayMs = 5000) {
    clearTimeout(pruneDepartedTimeout);
    pruneDepartedTimeout = setTimeout(pruneDepartedPlayers, delayMs);
}

function pruneDepartedPlayers() {
    pruneDepartedTimeout = null;
    if (departedPlayerIds.size === 0) return;
    if (gameState !== State.STOP) {
        schedulePruneDeparted(10000);
        return;
    }
    for (var id of departedPlayerIds) {
        delete authArray[id];
        lastSpecTime.delete(id);
        forfeitExemptLeaveIds.delete(id);
        guardExemptIds.delete(id);
    }
    departedPlayerIds.clear();
}

var stopTimeout;
var startTimeout;
var unpauseTimeout;
var fillTimeout;
var waitingForFill = false;
var kickOffTeam = Team.RED;
var kickoffWarnTimeout = null;
var kickoffWatchTimeout = null;
var kickoffClearTimeout = null;
var kickoffClockAtStart = 0;
var kickoffWatching = false;
var kickoffWatchPaused = false;
var kickoffPausedAt = 0;
var kickoffWarnFired = false;
var kickoffWarnDeadline = 0;
var kickoffForfeitDeadline = 0;
var kickoffClearDeadline = 0;
var emptyPlayer = {
    id: 0,
};
loadStadiumByKey(stadiumKeys.solo);

var game = new Game();

/* FUNCTIONS */

/* AUXILIARY FUNCTIONS */

function getDate() {
    let d = new Date();
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

/* MATH FUNCTIONS */

function getRandomInt(max) {
    // returns a random number between 0 and max-1
    return Math.floor(Math.random() * Math.floor(max));
}

function pointDistance(p1, p2) {
    var dx = p1.x - p2.x;
    var dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function pointDistanceSq(p1, p2) {
    var dx = p1.x - p2.x;
    var dy = p1.y - p2.y;
    return dx * dx + dy * dy;
}

/* TIME FUNCTIONS */

function getHoursStats(time) {
    return Math.floor(time / 3600);
}

function getMinutesGame(time) {
    var t = Math.floor(time / 60);
    return `${Math.floor(t / 10)}${Math.floor(t % 10)}`;
}

function getMinutesReport(time) {
    return Math.floor(Math.round(time) / 60);
}

function getMinutesEmbed(time) {
    var t = Math.floor(Math.round(time) / 60);
    return `${Math.floor(t / 10)}${Math.floor(t % 10)}`;
}

function getMinutesStats(time) {
    return Math.floor(time / 60) - getHoursStats(time) * 60;
}

function getSecondsGame(time) {
    var t = Math.floor(time - Math.floor(time / 60) * 60);
    return `${Math.floor(t / 10)}${Math.floor(t % 10)}`;
}

function getSecondsReport(time) {
    var t = Math.round(time);
    return Math.floor(t - getMinutesReport(t) * 60);
}

function getSecondsEmbed(time) {
    var t = Math.round(time);
    var t2 = Math.floor(t - Math.floor(t / 60) * 60);
    return `${Math.floor(t2 / 10)}${Math.floor(t2 % 10)}`;
}

function getTimeGame(time) {
    return `[${getMinutesGame(time)}:${getSecondsGame(time)}]`;
}

function getTimeEmbed(time) {
    return `[${getMinutesEmbed(time)}:${getSecondsEmbed(time)}]`;
}

function getTimeStats(time) {
    if (getHoursStats(time) > 0) {
        return `${getHoursStats(time)}h${getMinutesStats(time)}m`;
    } else {
        return `${getMinutesStats(time)}m`;
    }
}

function getGoalGame() {
    return game.scores.red + game.scores.blue;
}

/* REPORT FUNCTIONS */

function findFirstNumberCharString(str) {
    let str_number = str[str.search(/[0-9]/g)];
    return str_number === undefined ? "0" : str_number;
}

function getIdReport() {
    var d = new Date();
    return `${d.getFullYear() % 100}${d.getMonth() < 9 ? '0' : ''}${d.getMonth() + 1}${d.getDate() < 10 ? '0' : ''}${d.getDate()}${d.getHours() < 10 ? '0' : ''}${d.getHours()}${d.getMinutes() < 10 ? '0' : ''}${d.getMinutes()}${d.getSeconds() < 10 ? '0' : ''}${d.getSeconds()}${findFirstNumberCharString(roomName)}`;
}

function getRecordingName(game) {
    let d = new Date();
    let redCap = game.playerComp[0][0] != undefined ? game.playerComp[0][0].player.name : 'Red';
    let blueCap = game.playerComp[1][0] != undefined ? game.playerComp[1][0].player.name : 'Blue';
    let day = d.getDate() < 10 ? '0' + d.getDate() : d.getDate();
    let month = d.getMonth() < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1);
    let year = d.getFullYear() % 100 < 10 ? '0' + (d.getFullYear() % 100) : (d.getFullYear() % 100);
    let hour = d.getHours() < 10 ? '0' + d.getHours() : d.getHours();
    let minute = d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes();
    return `${day}-${month}-${year}-${hour}h${minute}-${redCap}vs${blueCap}.hbr2`;
}

/** Fire-and-forget JSON webhook post — never throws into the game loop. */
function postWebhook(url, payload) {
    if (!url) return;
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
    }).catch((err) => console.error('[webhook] post failed:', err?.message ?? err));
}

function fetchRecording(game) {
    if (gameWebhook != "") {
        let form = new FormData();
        form.append(null, new File([game.rec], getRecordingName(game), { "type": "text/plain" }));
        form.append("payload_json", JSON.stringify({
            "username": roomName
        }));

        fetch(gameWebhook, {
            method: 'POST',
            body: form,
        }).catch((err) => console.error('[webhook] recording upload failed:', err?.message ?? err));
    }
}

/* FEATURE FUNCTIONS */

var aliasToCommand = (function () {
    const map = new Map();
    for (const [key, value] of Object.entries(commands)) {
        for (let alias of value.aliases) {
            map.set(alias, key);
        }
    }
    return map;
})();

function getCommand(commandStr) {
    if (commands.hasOwnProperty(commandStr)) return commandStr;
    return aliasToCommand.get(commandStr) ?? false;
}

function buildCompIndex(playerComp) {
    // auth -> PlayerComposition. Blue inserted first so red overwrites it,
    // preserving the original red-priority lookup order.
    const index = new Map();
    for (let c of playerComp[1]) index.set(c.auth, c);
    for (let c of playerComp[0]) index.set(c.auth, c);
    return index;
}

function rebuildCompIndex() {
    game.compIndex = buildCompIndex(game.playerComp);
}

function getPlayerAuth(player) {
    if (player == null) return null;
    return authArray[player.id]?.[0] ?? player.auth ?? null;
}

function getPlayerConn(player) {
    if (player == null) return null;
    return authArray[player.id]?.[1] ?? player.conn ?? null;
}

function getPlayerComp(player) {
    if (player == null || player.id == 0) return null;
    var auth = getPlayerAuth(player);
    if (!auth) return null;
    return game.compIndex.get(auth) ?? null;
}

function getTeamArray(team, includeAFK = true) {
    if (team == Team.RED) return teamRed;
    if (team == Team.BLUE) return teamBlue;
    if (includeAFK) {
      return playersAll.filter((p) => p.team === Team.SPECTATORS);
    }
    return teamSpec;
}

function sendAnnouncementTeam(message, team, color, style, mention) {
    for (let player of team) {
        room.sendAnnouncement(message, player.id, color, style, mention);
    }
}

function teamChat(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var emoji = player.team == Team.RED ? '🔴' : player.team == Team.BLUE ? '🔵' : '⚪';
    var record = loadPlayerRecordFor(player);
    var message = `${emoji} Team · ${getRankChatPrefix(player, record)} ${player.name}: ${msgArray.join(' ')}`;
    var team = getTeamArray(player.team, true);
    var rank = getPlayerRankForLobby(player, record);
    var color = player.team == Team.RED ? redColor : player.team == Team.BLUE ? blueColor : rank.color;
    var style = null;
    var mention = HaxNotification.CHAT;
    sendAnnouncementTeam(message, team, color, style, mention);
}

function playerChat(player, message) {
    var msgArray = message.split(/ +/);
    var playerTargetIndex = playersAll.findIndex(
        (p) => p.name.replaceAll(' ', '_') == msgArray[0].substring(2)
    );
    if (playerTargetIndex == -1) {
        room.sendAnnouncement(
            `Player not found. Check name.`,
            player.id,
            errorColor,
            null,
            null
        );
        return false;
    }
    var playerTarget = playersAll[playerTargetIndex];
    if (player.id == playerTarget.id) {
        room.sendAnnouncement(
            `Cannot PM yourself.`,
            player.id,
            errorColor,
            null,
            null
        );
        return false;
    }
    var senderPrefix = getRankChatPrefix(player, loadPlayerRecordFor(player));
    var messageFrom = `📝 PM · ${senderPrefix} ${player.name} → ${playerTarget.name}: ${msgArray.slice(1).join(' ')}`;

    var messageTo = `📝 PM · ${senderPrefix} ${player.name}: ${msgArray.slice(1).join(' ')}`;

    room.sendAnnouncement(
        messageFrom,
        player.id,
        privateMessageColor,
        null,
        HaxNotification.CHAT
    );
    room.sendAnnouncement(
        messageTo,
        playerTarget.id,
        privateMessageColor,
        null,
        HaxNotification.CHAT
    );
}

/* PHYSICS FUNCTIONS */

function calculateStadiumVariables() {
    if (checkStadiumVariable && teamRed.length + teamBlue.length > 0) {
        checkStadiumVariable = false;
        setTimeout(() => {
            let ballDisc = room.getDiscProperties(0);
            let playerDisc = room.getPlayerDiscProperties(teamRed.concat(teamBlue)[0].id);
            if (ballDisc != null) {
                ballRadius = ballDisc.radius;
            }
            if (playerDisc != null) {
                playerRadius = playerDisc.radius;
            }
            triggerDistance = ballRadius + playerRadius + 0.01;
            triggerDistanceSq = triggerDistance * triggerDistance;
            if (ballDisc != null) {
                speedCoefficient = 100 / (5 * ballDisc.invMass * (ballDisc.damping ** 60 + 1));
            }
        }, 1);
    }
}

function checkGoalKickTouch(array, index, goal) {
    if (array != null && array.length >= index + 1) {
        var obj = array[index];
        if (obj != null && obj.goal != null && obj.goal == goal) return obj;
    }
    return null;
}

function pushBallTouch(player, time, ballPosition) {
    var goalIdx = getGoalGame();
    var touch = new BallTouch(player, time, goalIdx, ballPosition);
    game.touchArray.push(touch);
    if (game.touchArray.length > touchArrayMax) {
        game.touchArray.splice(0, game.touchArray.length - touchArrayMax);
    }
    lastTouches[0] = touch;
    lastTouches[1] = checkGoalKickTouch(game.touchArray, game.touchArray.length - 2, goalIdx);
}

/* BUTTONS */

function swapButton() {
    updateTeams();
    applyingTeams = true;
    for (let player of teamBlue) {
        room.setPlayerTeam(player.id, Team.RED);
    }
    for (let player of teamRed) {
        room.setPlayerTeam(player.id, Team.BLUE);
    }
    applyingTeams = false;
    updateTeams();
}

/* COMMAND FUNCTIONS */

/* PLAYER COMMANDS */

function leaveCommand(player, message) {
    room.kickPlayer(player.id, 'Bye!', false);
}

function helpCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length == 0) {
        var commandString = 'Commands:';
        for (const [key, value] of Object.entries(commands)) {
            if (value.desc && value.roles == Role.PLAYER) commandString += ` !${key},`;
        }
        commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        if (getRole(player) >= Role.ADMIN_TEMP) {
            commandString += `\nAdmin:`;
            for (const [key, value] of Object.entries(commands)) {
                if (value.desc && value.roles == Role.ADMIN_TEMP) commandString += ` !${key},`;
            }
            if (commandString.slice(commandString.length - 1) == ':')
                commandString += ` None,`;
            commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        }
        if (getRole(player) >= Role.MASTER) {
            commandString += `\nMaster:`;
            for (const [key, value] of Object.entries(commands)) {
                if (value.desc && value.roles == Role.MASTER) commandString += ` !${key},`;
            }
            if (commandString.slice(commandString.length - 1) == ':') commandString += ` None,`;
            commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        }
        commandString += "\nOne command: !help <name>";
        room.sendAnnouncement(
            commandString,
            player.id,
            infoColor,
            null,
            HaxNotification.CHAT
        );
    } else if (msgArray.length >= 1) {
        var commandName = getCommand(msgArray[0].toLowerCase());
        if (commandName != false && commands[commandName].desc != false)
            room.sendAnnouncement(
                `!${commandName}:\n${commands[commandName].desc}`,
                player.id,
                infoColor,
                null,
                HaxNotification.CHAT
            );
        else
            room.sendAnnouncement(
                `Unknown command. Type: !help`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
    }
}

function globalStatsCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var formatFilter = normalizeFormatArg(msgArray[0]) || getPlayerMatchFormat(player);
    var auth = authArray[player.id][0];
    var record = loadPlayerRecord(auth, player.name);
    if (!hasPlayedAnyFormat(record)) {
        var displayFormat = getPlayerMatchFormat(player);
        var rankLine = displayFormat
            ? `${displayFormat}: ${formatPlayerElo(record, displayFormat, auth)}`
            : `${formatPlayerElo(record, '2x2', auth)}`;
        room.sendAnnouncement(
            `No ranked games yet.\n\n` +
                `${rankLine}\n\n` +
                `Play one full ${displayFormat || 'ranked'} match to get placed.\n` +
                `Try: !ranks`,
            player.id,
            infoColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var statsString = printPlayerRecord(record, formatFilter, auth);
    room.sendAnnouncement(
        statsString,
        player.id,
        infoColor,
        null,
        HaxNotification.CHAT
    );
}

function renameCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var auth = authArray[player.id][0];
    if (localStorage.getItem(auth)) {
        var record = loadPlayerRecord(auth, player.name);
        if (msgArray.length == 0) {
            record.playerName = player.name;
        } else {
            record.playerName = msgArray.join(' ');
        }
        savePlayerRecord(auth, record);
        room.sendAnnouncement(
            `You successfully renamed to ${record.playerName}!`,
            player.id,
            successColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        room.sendAnnouncement(
            `No games in this room yet.`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function statsLeaderboardCommand(player, message) {
    var parts = message.split(/ +/);
    var key = parts[0].substring(1).toLowerCase();
    if (key === 'rank') key = 'elo';
    var formatFilter = normalizeFormatArg(parts[1]) || (key === 'elo' ? getPlayerMatchFormat(player) : null);
    printRankings(key, player.id, formatFilter);
}

function ranksCommand(player, message) {
    var formatFilter = normalizeFormatArg(message.split(/ +/)[1]) || getLobbyMatchFormat();
    var span = ELO_DIVISION_SPAN;
    var base = ELO_LADDER_BASE;
    var perTier = span * LOL_DIVISIONS.length;
    var lines = [
        '🏅 Rank ladder (compact)',
        `${span} Elo per division  ·  ±${ELO_K} typical swing per match`,
        '',
        `🥈 Silver     ${base}+   ← new players (${ELO_DEFAULT} Elo)`,
        `🥇 Gold       ${base + perTier}+`,
        `🍀 Platinum   ${base + perTier * 2}+`,
        `💎 Diamond    ${base + perTier * 3}+`,
        `🔮 Master     ${LOL_APEX_BASE}+`,
        `⚔ Grandmaster ${LOL_GRANDMASTER_BASE}+`,
        `👑 Challenger  top ${CHALLENGER_SLOTS_PER_FORMAT} per format · GM+`,
        '',
        `${ELO_UNRANKED.emoji} Unranked until your first full match`,
        `🛡 Placement: first ${ELO_PLACEMENT_GAMES} games = 2× Elo swing`,
        `🛡 Elo board needs ${ELO_PLACEMENT_GAMES}+ games`,
        `⛔ Leave/AFK after ${forfeitGraceSeconds}s = forfeit · ~${ELO_FORFEIT_LEAVER_MULT.toFixed(1)}× loss`,
        `👋 !bb counts as ragequit`,
    ];
    if (formatFilter) lines.push(`📍 ${formatFilter} rank shown in chat for this lobby size`);
    lines.push(`💡 !stats · !elo ${formatFilter || '2x2'}`);
    room.sendAnnouncement(
        lines.join('\n'),
        player.id,
        infoColor,
        null,
        HaxNotification.CHAT
    );
}

function topCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var formatFilter = normalizeFormatArg(msgArray[0]);
    if (!formatFilter) {
        room.sendAnnouncement(
            `📊 Leaderboards by format:\n` +
                `  !top 1x1 · !top 2x2 · !top 3x3\n` +
                `  !elo · !stats · !ranks`,
            player.id,
            infoColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    printFormatTop(formatFilter, player.id);
}

/** Room under 50% capacity — AFK can sit indefinitely while it's this quiet. Reads cached playersAll (refreshed by updateTeams on every join/leave/team event) instead of re-serializing the engine player list. */
function roomUnderHalf() {
    return playersAll.length < maxPlayers / 2;
}

function clearAfkMaxTimer(id) {
    if (afkMaxTimers.has(id)) {
        clearTimeout(afkMaxTimers.get(id));
        afkMaxTimers.delete(id);
    }
}

/** Arm the max-duration auto-expire for an AFK player (time already spent AFK counts). */
function armAfkMaxTimer(id) {
    clearAfkMaxTimer(id);
    var started = afkStartTime.get(id) ?? Date.now();
    var remaining = Math.max(0, afkMaxDurationMinutes * 60 * 1000 - (Date.now() - started));
    afkMaxTimers.set(id, setTimeout((pid) => {
        AFKSet.delete(pid);
        afkMaxTimers.delete(pid);
        afkStartTime.delete(pid);
        updateTeams();
    }, remaining, id));
}

function clearAfkState(id) {
    clearAfkMaxTimer(id);
    afkStartTime.delete(id);
}

/** Re-evaluate AFK max timers as the room fills/empties: indefinite while under half, timed once busy. */
function reconcileAfkTimers() {
    if (roomUnderHalf()) {
        for (var id of AFKSet) clearAfkMaxTimer(id);
    } else {
        for (var id of AFKSet) if (!afkMaxTimers.has(id)) armAfkMaxTimer(id);
    }
}

function startAfkTimers(playerId, isAdmin) {
    if (isAdmin) return;
    AFKMinSet.add(playerId);
    AFKCooldownSet.add(playerId);
    afkStartTime.set(playerId, Date.now());
    setTimeout((id) => { AFKMinSet.delete(id); }, afkMinDurationMinutes * 60 * 1000, playerId);
    setTimeout((id) => { AFKCooldownSet.delete(id); }, afkCooldownMinutes * 60 * 1000, playerId);
    if (!roomUnderHalf()) armAfkMaxTimer(playerId);
}

function enterAfkMode(player, reconcile = true) {
    AFKQueuedSet.delete(player.id);
    AFKSet.add(player.id);
    startAfkTimers(player.id, player.admin);
    room.setPlayerTeam(player.id, Team.SPECTATORS);
    room.sendAnnouncement(
        `😴 ${player.name} is AFK.`,
        null,
        announcementColor,
        null,
        null
    );
    updateTeams();
    if (reconcile) handlePlayersLeave();
}

function applyQueuedAfk() {
    if (AFKQueuedSet.size === 0) return;
    var queued = [...AFKQueuedSet];
    AFKQueuedSet.clear();
    for (let id of queued) {
        var p = room.getPlayer(id);
        if (p == null) continue;
        enterAfkMode(p, false);
    }
}

function afkCommand(player, message) {
    if (AFKQueuedSet.has(player.id)) {
        AFKQueuedSet.delete(player.id);
        room.sendAnnouncement(
            `AFK queue cancelled.`,
            player.id,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    if (player.team == Team.SPECTATORS || players.length == 1) {
        if (AFKSet.has(player.id)) {
            if (AFKMinSet.has(player.id)) {
                room.sendAnnouncement(
                    `AFK min ${afkMinDurationMinutes} min. Wait.`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            } else {
                AFKSet.delete(player.id);
                clearAfkState(player.id);
                room.sendAnnouncement(
                    `🌅 ${player.name} is back (not AFK).`,
                    null,
                    announcementColor,
                    null,
                    null
                );
                updateTeams();
                handlePlayersJoin();
            }
        } else {
            if (AFKCooldownSet.has(player.id)) {
                room.sendAnnouncement(
                    `AFK cooldown: ${afkCooldownMinutes} min. Wait.`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            } else {
                enterAfkMode(player);
            }
        }
    } else if (gameState !== State.STOP) {
        if (AFKCooldownSet.has(player.id)) {
            room.sendAnnouncement(
                `AFK cooldown: ${afkCooldownMinutes} min. Wait.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
            return;
        }
        AFKQueuedSet.add(player.id);
        room.sendAnnouncement(
            `😴 AFK queued — spec when this match ends.\n!afk again to cancel.`,
            player.id,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        room.sendAnnouncement(
            `Cannot AFK on a team. Go to spec first.`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function afkListCommand(player, message) {
    if (AFKSet.size == 0 && AFKQueuedSet.size == 0) {
        room.sendAnnouncement(
            "😴 No AFK players.",
            player.id,
            announcementColor,
            null,
            null
        );
        return;
    }
    var lines = [];
    if (AFKSet.size > 0) {
        var names = [];
        AFKSet.forEach((id) => {
            var p = room.getPlayer(id);
            if (p != null) names.push(p.name);
        });
        if (names.length > 0) lines.push(`😴 AFK: ${names.join(', ')}`);
    }
    if (AFKQueuedSet.size > 0) {
        var queued = [];
        AFKQueuedSet.forEach((id) => {
            var p = room.getPlayer(id);
            if (p != null) queued.push(p.name);
        });
        if (queued.length > 0) lines.push(`⏳ AFK queued: ${queued.join(', ')}`);
    }
    room.sendAnnouncement(lines.join('\n'), player.id, announcementColor, null, null);
}

function masterCommand(player, message) {
    console.log(`player ${player.name} is trying to claim the room`);
    return;
    var msgArray = message.split(/ +/).slice(1);
    if (parseInt(msgArray[0]) == masterPassword) {
        if (!masterList.includes(authArray[player.id][0])) {
            room.setPlayerAdmin(player.id, true);
            adminList = adminList.filter((a) => a[0] != authArray[player.id][0]);
            masterList.push(authArray[player.id][0]);
            rebuildRoleSets();
            room.sendAnnouncement(
                `${player.name} is now master!`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `Already master.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    }
}

/* ADMIN COMMANDS */

function restartCommand(player, message) {
    instantRestart();
}

function restartSwapCommand(player, message) {
    room.stopGame();
    swapButton();
    scheduleStart(10);
}

function swapCommand(player, message) {
    if (playSituation == Situation.STOP) {
        swapButton();
        room.sendAnnouncement(
            '✔️ Teams swapped.',
            null,
            announcementColor,
            null,
            null
        );
    } else {
        room.sendAnnouncement(
            `Stop game first.`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function kickTeamCommand(player, message) {
    var msgArray = message.split(/ +/);
    var reasonString = `Team kick by ${player.name}`;
    if (msgArray.length > 1) {
        reasonString = msgArray.slice(1).join(' ');
    }
    if (['!kickred', '!kickr'].includes(msgArray[0].toLowerCase())) {
        for (let i = 0; i < teamRed.length; i++) {
            setTimeout(() => {
                forfeitExemptLeaveIds.add(teamRed[0].id);
                room.kickPlayer(teamRed[0].id, reasonString, false);
            }, i * 20)
        }
    } else if (['!kickblue', '!kickb'].includes(msgArray[0].toLowerCase())) {
        for (let i = 0; i < teamBlue.length; i++) {
            setTimeout(() => {
                forfeitExemptLeaveIds.add(teamBlue[0].id);
                room.kickPlayer(teamBlue[0].id, reasonString, false);
            }, i * 20)
        }
    } else if (['!kickspec', '!kicks'].includes(msgArray[0].toLowerCase())) {
        for (let i = 0; i < teamSpec.length; i++) {
            setTimeout(() => {
                forfeitExemptLeaveIds.add(teamSpec[0].id);
                room.kickPlayer(teamSpec[0].id, reasonString, false);
            }, i * 20)
        }
    }
}

function findStadiumByKey(key) {
    return stadiumCatalog.find((s) => s.key === key);
}

function findStadiumById(id) {
    return stadiumCatalog.find((s) => s.id === id);
}

function loadStadium(stadium, announceId = 0) {
    if (!stadium) return false;
    room.setCustomStadium(stadium.data);
    room.setScoreLimit(stadium.scoreLimit ?? scoreLimit);
    room.setTimeLimit(stadium.timeLimit ?? timeLimit);
    currentStadium = stadium.key;
    if (announceId !== 0) {
        room.sendAnnouncement(
            `Loaded: ${stadium.name}`,
            announceId,
            successColor,
            null,
            HaxNotification.CHAT
        );
    }

    // Set custom team colors
    const TEAM_ID = { red: 1, blue: 2 };
    const teamColorConfig = {
        red: 0xbc0000,
        blue: 0x0069b9,
    };
    const white = 0xffffff;

    room.setTeamColors(TEAM_ID.red, 0, white, [teamColorConfig.red]);
    room.setTeamColors(TEAM_ID.blue, 0, white, [teamColorConfig.blue]);
    return true;
}

function loadStadiumByKey(key) {
    return loadStadium(findStadiumByKey(key));
}

function mapCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (stadiumCatalog.length === 0) {
        room.sendAnnouncement(
            'No maps in folder.',
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    if (msgArray.length === 0) {
        var list = stadiumCatalog.map((s) => {
            var limit = s.scoreLimit ?? scoreLimit;
            return `#${s.id} ${s.name} (${limit === 0 ? '∞' : limit}g)`;
        }).join(' | ');
        room.sendAnnouncement(
            `Maps> ${list}`,
            player.id,
            infoColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    if (gameState != State.STOP) {
        room.sendAnnouncement(
            'Stop game first.',
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var idx = parseInt(msgArray[0]);
    if (isNaN(idx) || idx < 1 || idx > stadiumCatalog.length) {
        room.sendAnnouncement(
            `Bad map number. !map (1-${stadiumCatalog.length})`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    loadStadium(findStadiumById(idx), player.id);
}

function muteCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray[0].length > 0 && msgArray[0][0] == '#') {
            msgArray[0] = msgArray[0].substring(1, msgArray[0].length);
            if (room.getPlayer(parseInt(msgArray[0])) != null) {
                var playerMute = room.getPlayer(parseInt(msgArray[0]));
                var minutesMute = muteDuration;
                if (msgArray.length > 1 && parseInt(msgArray[1]) > 0) {
                    minutesMute = parseInt(msgArray[1]);
                }
                if (!playerMute.admin) {
                    var muteObj = new MutePlayer(playerMute.name, playerMute.id, authArray[playerMute.id][0]);
                    muteObj.setDuration(minutesMute);
                    room.sendAnnouncement(
                        `Muted: ${playerMute.name} (${minutesMute} min)`,
                        null,
                        announcementColor,
                        null,
                        null
                    );
                } else {
                    room.sendAnnouncement(
                        `Cannot mute admin.`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `No player with that ID.\n${helpMore('mute')}`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else {
            room.sendAnnouncement(
                helpMore('mute'),
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            helpMore('mute'),
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function unmuteCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray[0].length > 0 && msgArray[0][0] == '#') {
            msgArray[0] = msgArray[0].substring(1, msgArray[0].length);
            if (room.getPlayer(parseInt(msgArray[0])) != null) {
                var playerUnmute = room.getPlayer(parseInt(msgArray[0]));
                if (muteArray.getByPlayerId(playerUnmute.id) != null) {
                    var muteObj = muteArray.getByPlayerId(playerUnmute.id);
                    muteObj.remove()
                    room.sendAnnouncement(
                        `Unmuted: ${playerUnmute.name}`,
                        null,
                        announcementColor,
                        null,
                        HaxNotification.CHAT
                    );
                } else {
                    room.sendAnnouncement(
                        `Player not muted.`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `No player with that ID.\n${helpMore('unmute')}`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else if (msgArray[0].length > 0 && parseInt(msgArray[0]) > 0 && muteArray.getById(parseInt(msgArray[0])) != null) {
            var playerUnmute = muteArray.getById(parseInt(msgArray[0]));
            playerUnmute.remove();
            room.sendAnnouncement(
                `${playerUnmute.name} — unmuted`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                helpMore('unmute'),
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            helpMore('unmute'),
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function muteListCommand(player, message) {
    if (muteArray.list.length == 0) {
        room.sendAnnouncement(
            "🔇 No muted players.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '🔇 Muted: ';
    for (let mute of muteArray.list) {
        cstm += mute.name + `[${mute.id}], `;
    }
    cstm = cstm.substring(0, cstm.length - 2) + '.';
    room.sendAnnouncement(
        cstm,
        player.id,
        announcementColor,
        null,
        null
    );
}

/* REJOIN ABUSE GUARD */

/** Record ANY exit (leave, bb, AFK kick, pick timeout, kickoff forfeit, etc.); second within the window triggers a short temp ban (auth + conn). */
function registerLeaveForRejoinGuard(player) {
    if (guardExemptIds.has(player.id)) {
        guardExemptIds.delete(player.id);
        return;
    }
    var auth = getPlayerAuth(player);
    var conn = getPlayerConn(player);
    var key = auth || conn;
    if (!key) return;
    var now = Date.now();
    var prev = recentLeaveTimes.get(key);
    if (prev != null && now - prev <= REJOIN_BAN_WINDOW_MS) {
        recentLeaveTimes.delete(key);
        var expiry = now + REJOIN_BAN_DURATION_MS;
        if (auth) leaveBannedAuths.set(auth, expiry);
        if (conn) leaveBannedConns.set(conn, expiry);
        setTimeout(() => {
            if (auth) leaveBannedAuths.delete(auth);
            if (conn) leaveBannedConns.delete(conn);
        }, REJOIN_BAN_DURATION_MS);
        room.sendAnnouncement(
            `⛔ ${player.name} left too often — ${Math.round(REJOIN_BAN_DURATION_MS / 60000)} min rejoin cooldown.`,
            null,
            warningColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    recentLeaveTimes.set(key, now);
    setTimeout(() => {
        if (recentLeaveTimes.get(key) === now) recentLeaveTimes.delete(key);
    }, REJOIN_BAN_WINDOW_MS);
}

/* VOTE BAN */

/** Distinct connections among active (non-AFK) players, optionally excluding one connection (alts on a shared conn collapse to 1). */
function distinctConns(playerList, excludeConn) {
    var conns = new Set();
    for (var p of playerList) {
        if (AFKSet.has(p.id)) continue;
        var conn = getPlayerConn(p);
        if (conn == null) continue;
        if (excludeConn != null && conn === excludeConn) continue;
        conns.add(conn);
    }
    return conns;
}

/** Connections allowed to decide the active vote: everyone except the target's connection. */
function voteBanEligibleConns() {
    if (voteBan == null) return new Set();
    return distinctConns(room.getPlayerList(), voteBan.targetConn);
}

function resolveVoteBanTarget(token) {
    if (token == null || token.length < 2 || token[0] !== '#') return null;
    var id = parseInt(token.substring(1), 10);
    if (Number.isNaN(id)) return null;
    return room.getPlayer(id);
}

function voteBanProgress() {
    var eligible = voteBanEligibleConns();
    var have = 0;
    for (var c of eligible) if (voteBan.yesConns.has(c)) have++;
    return { have, needed: eligible.size };
}

function checkVoteBan() {
    if (voteBan == null) return;
    var eligible = voteBanEligibleConns();
    if (eligible.size === 0) return;
    for (var c of eligible) {
        if (!voteBan.yesConns.has(c)) return;
    }
    executeVoteBan();
}

function clearVoteBan() {
    if (voteBan != null) clearTimeout(voteBan.timeout);
    voteBan = null;
}

function registerVoteBanned(auth, conn) {
    var now = Date.now();
    var expiry = now + VOTEBAN_DURATION_MS;
    if (auth) voteBannedAuths.set(auth, expiry);
    if (conn) voteBannedConns.set(conn, expiry);
    voteBanCooldownUntil = now + VOTEBAN_COOLDOWN_MS;
    setTimeout(() => {
        if (auth) voteBannedAuths.delete(auth);
        if (conn) voteBannedConns.delete(conn);
    }, VOTEBAN_DURATION_MS);
}

function executeVoteBan() {
    var vb = voteBan;
    clearVoteBan();
    registerVoteBanned(vb.targetAuth, vb.targetConn);
    room.sendAnnouncement(
        `⛔ ${vb.targetName} vote banned for 5 min.`,
        null,
        errorColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
    if (room.getPlayer(vb.targetId) != null) {
        room.kickPlayer(vb.targetId, 'Vote banned (5 min)', true);
    }
    setTimeout(() => {
        room.clearBan(vb.targetId);
        banList = banList.filter((b) => b[1] !== vb.targetId);
        room.sendAnnouncement(
            `✅ ${vb.targetName} vote ban expired.`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    }, VOTEBAN_DURATION_MS);
}

function voteBanCommand(player, message) {
    if (voteBan != null) {
        room.sendAnnouncement(
            `🗳️ Vote ban already running on ${voteBan.targetName}. Type !yes.`,
            player.id,
            warningColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var now = Date.now();
    if (now < voteBanCooldownUntil) {
        room.sendAnnouncement(
            `Vote ban on cooldown. Wait ${Math.ceil((voteBanCooldownUntil - now) / 1000)}s.`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length === 0) {
        room.sendAnnouncement(helpMore('voteban'), player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    var target = resolveVoteBanTarget(msgArray[0]);
    if (target == null) {
        room.sendAnnouncement(
            `No player with that ID.\n${helpMore('voteban')}`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    if (target.id === player.id) {
        room.sendAnnouncement(`Cannot vote ban yourself.`, player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    if (getRole(target) >= Role.ADMIN_TEMP) {
        room.sendAnnouncement(`Cannot vote ban staff.`, player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    var roomConns = distinctConns(room.getPlayerList(), null);
    if (roomConns.size < VOTEBAN_MIN_CONNS) {
        room.sendAnnouncement(
            VOTEBAN_NEED_PLAYERS_MSG,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var targetConn = getPlayerConn(target);
    if (getPlayerConn(player) === targetConn) {
        room.sendAnnouncement(`You share a network with them — can't vote ban.`, player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    voteBan = {
        targetId: target.id,
        targetAuth: getPlayerAuth(target),
        targetConn: targetConn,
        targetName: target.name,
        yesConns: new Set(),
        timeout: null,
    };
    var starterConn = getPlayerConn(player);
    if (starterConn) voteBan.yesConns.add(starterConn);
    voteBan.timeout = setTimeout(() => {
        if (voteBan == null) return;
        var failName = voteBan.targetName;
        clearVoteBan();
        room.sendAnnouncement(
            `🗳️ Vote ban on ${failName} failed (not enough yes votes).`,
            null,
            warningColor,
            null,
            HaxNotification.CHAT
        );
    }, VOTEBAN_WINDOW_MS);
    var progress = voteBanProgress();
    room.sendAnnouncement(
        `🗳️ ${player.name} started a vote ban on ${target.name} (#${target.id})\n` +
            `Everyone else: type !yes (${progress.have}/${progress.needed}, ${Math.round(VOTEBAN_WINDOW_MS / 1000)}s)\n` +
            `Same network/IP counts as one player.`,
        null,
        warningColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
    checkVoteBan();
}

function voteYesCommand(player, message) {
    if (voteBan == null) {
        room.sendAnnouncement(`No vote ban running.`, player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    var conn = getPlayerConn(player);
    if (conn == null) return;
    if (conn === voteBan.targetConn) {
        room.sendAnnouncement(`You share a network with them — can't vote.`, player.id, errorColor, null, HaxNotification.CHAT);
        return;
    }
    voteBan.yesConns.add(conn);
    var targetName = voteBan.targetName;
    checkVoteBan();
    if (voteBan != null) {
        var progress = voteBanProgress();
        room.sendAnnouncement(
            `🗳️ ${progress.have}/${progress.needed} yes to ban ${targetName}`,
            null,
            warningColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function handleVoteBanLeave(player) {
    if (voteBan == null) return;
    if (player.id === voteBan.targetId) {
        var vb = voteBan;
        clearVoteBan();
        registerVoteBanned(vb.targetAuth, vb.targetConn);
        room.sendAnnouncement(
            `⛔ ${vb.targetName} left during the vote — banned 5 min on return.`,
            null,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    checkVoteBan();
}

/* MASTER COMMANDS */

function clearbansCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length == 0) {
        room.clearBans();
        room.sendAnnouncement(
            '✔️ All bans cleared.',
            null,
            announcementColor,
            null,
            null
        );
        banList = [];
    } else if (msgArray.length == 1) {
        if (parseInt(msgArray[0]) > 0) {
            var ID = parseInt(msgArray[0]);
            room.clearBan(ID);
            if (banList.length != banList.filter((p) => p[1] != ID).length) {
                room.sendAnnouncement(
                    `✔️ Unbanned: ${banList.filter((p) => p[1] == ID)[0][0]}`,
                    null,
                    announcementColor,
                    null,
                    null
                );
            } else {
                room.sendAnnouncement(
                    `No ban for that ID.\n${helpMore('clearbans')}`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
            banList = banList.filter((p) => p[1] != ID);
        } else {
            room.sendAnnouncement(
                `Bad ban ID.\n${helpMore('clearbans')}`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            helpMore('clearbans'),
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function banListCommand(player, message) {
    if (banList.length == 0) {
        room.sendAnnouncement(
            "📢 No banned players.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '📢 Banned: ';
    for (let ban of banList) {
        cstm += ban[0] + `[${ban[1]}], `;
    }
    cstm = cstm.substring(0, cstm.length - 2) + '.';
    room.sendAnnouncement(
        cstm,
        player.id,
        announcementColor,
        null,
        null
    );
}

function adminListCommand(player, message) {
    if (adminList.length == 0) {
        room.sendAnnouncement(
            "📢 No admins.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '📢 Admins: ';
    for (let i = 0; i < adminList.length; i++) {
        cstm += adminList[i][1] + `[${i}], `;
    }
    cstm = cstm.substring(0, cstm.length - 2) + '.';
    room.sendAnnouncement(
        cstm,
        player.id,
        announcementColor,
        null,
        null
    );
}

function persistAdminList() {
    if (!configFile) {
        console.warn('[config] config.json missing — admin list not saved');
        return Promise.resolve(false);
    }
    return saveRoomAdmins(configFile, adminList).catch((err) => {
        console.error('[config] failed to save admins:', err);
        return false;
    });
}

function announceAdminPersist(byPlayer, playerName, saved, added) {
    if (saved) {
        room.sendAnnouncement(
            added
                ? `${playerName} is now permanent admin. Saved to config.`
                : `${playerName} — admin removed. Saved to config.`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    room.sendAnnouncement(
        added
            ? `${playerName} is now permanent admin.`
            : `${playerName} — admin removed.`,
        null,
        announcementColor,
        null,
        HaxNotification.CHAT
    );
    room.sendAnnouncement(
        'Config save failed — check server logs.',
        byPlayer.id,
        errorColor,
        null,
        HaxNotification.CHAT
    );
}

function promotePermanentAdmin(byPlayer, playerAdmin) {
    var auth = authArray[playerAdmin.id][0];
    if (adminList.map((a) => a[0]).includes(auth)) {
        room.sendAnnouncement(
            `Already permanent admin.`,
            byPlayer.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    if (masterList.includes(auth)) {
        room.sendAnnouncement(
            `Already master.`,
            byPlayer.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    room.setPlayerAdmin(playerAdmin.id, true);
    adminList.push([auth, playerAdmin.name]);
    rebuildRoleSets();
    persistAdminList().then((saved) => {
        announceAdminPersist(byPlayer, playerAdmin.name, saved, true);
    });
}

function setPermAdminByIdCommand(player, message, helpKey) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray[0].length > 0 && msgArray[0][0] == '#') {
            msgArray[0] = msgArray[0].substring(1, msgArray[0].length);
            if (room.getPlayer(parseInt(msgArray[0])) != null) {
                promotePermanentAdmin(player, room.getPlayer(parseInt(msgArray[0])));
            } else {
                room.sendAnnouncement(
                    `No player with that ID.\n${helpMore(helpKey)}`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else {
            room.sendAnnouncement(
                helpMore(helpKey),
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            helpMore(helpKey),
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function setPermAdminCommand(player, message) {
    setPermAdminByIdCommand(player, message, 'setpermadmin');
}

function setAdminCommand(player, message) {
    setPermAdminByIdCommand(player, message, 'setadmin');
}

function removePermanentAdmin(byPlayer, auth) {
    var entry = adminList.find((a) => a[0] == auth);
    if (entry == null) return false;
    adminList = adminList.filter((a) => a[0] != auth);
    rebuildRoleSets();
    persistAdminList().then((saved) => {
        announceAdminPersist(byPlayer, entry[1], saved, false);
    });
    return true;
}

function removeAdminCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray[0].length > 0 && msgArray[0][0] == '#') {
            msgArray[0] = msgArray[0].substring(1, msgArray[0].length);
            if (room.getPlayer(parseInt(msgArray[0])) != null) {
                var playerAdmin = room.getPlayer(parseInt(msgArray[0]));

                if (adminList.map((a) => a[0]).includes(authArray[playerAdmin.id][0])) {
                    room.setPlayerAdmin(playerAdmin.id, false);
                    removePermanentAdmin(player, authArray[playerAdmin.id][0]);
                } else {
                    room.sendAnnouncement(
                        `Not a permanent admin.`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `No player with that ID.\n${helpMore('removeadmin')}`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else if (msgArray[0].length > 0 && parseInt(msgArray[0]) < adminList.length) {
            var index = parseInt(msgArray[0]);
            var playerAdmin = adminList[index];
            if (playersAll.findIndex((p) => authArray[p.id][0] == playerAdmin[0]) != -1) {
                // check if there is the removed admin in the room
                var indexRem = playersAll.findIndex((p) => authArray[p.id][0] == playerAdmin[0]);
                room.setPlayerAdmin(playersAll[indexRem].id, false);
            }
            adminList.splice(index, 1);
            rebuildRoleSets();
            persistAdminList().then((saved) => {
                announceAdminPersist(player, playerAdmin[1], saved, false);
            });
        } else {
            room.sendAnnouncement(
                helpMore('removeadmin'),
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            helpMore('removeadmin'),
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function passwordCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray.length == 1 && msgArray[0] == '') {
            roomPassword = '';
            room.setPassword(null);
            room.sendAnnouncement(
                `Password removed.`,
                player.id,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        }
        roomPassword = msgArray.join(' ');
        room.setPassword(roomPassword);
        room.sendAnnouncement(
            `Password set: ${roomPassword}`,
            player.id,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        if (roomPassword != '') {
            roomPassword = '';
            room.setPassword(null);
            room.sendAnnouncement(
                `Password removed.`,
                player.id,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `No password set.\n${helpMore('password')}`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    }
}

/* GAME FUNCTIONS */

function kickoffAfkEnabled() {
    var scores = room.getScores();
    return scores != null && scores.timeLimit !== 0;
}

function clearKickoffWatchTimeoutsOnly() {
    clearTimeout(kickoffWarnTimeout);
    clearTimeout(kickoffWatchTimeout);
    clearTimeout(kickoffClearTimeout);
    kickoffWarnTimeout = null;
    kickoffWatchTimeout = null;
    kickoffClearTimeout = null;
}

function clearKickoffWatch() {
    clearKickoffWatchTimeoutsOnly();
    kickoffWatching = false;
    kickoffWatchPaused = false;
    kickoffPausedAt = 0;
    kickoffWarnFired = false;
    kickoffWarnDeadline = 0;
    kickoffForfeitDeadline = 0;
    kickoffClearDeadline = 0;
}

function kickoffWarnHandler() {
    kickoffWarnTimeout = null;
    if (gameState !== State.PLAY || !kickoffWatching || kickoffWatchPaused) return;
    var warnScores = room.getScores();
    if (warnScores != null && warnScores.time !== kickoffClockAtStart) return;
    kickoffWarnFired = true;
    var teamName = kickOffTeam === Team.RED ? 'Red' : 'Blue';
    room.sendAnnouncement(
        `⛔ ${teamName} — kick off in ${kickoffAfkForfeitSeconds - kickoffAfkWarnSeconds}s or forfeit`,
        null,
        warningColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
}

function kickoffForfeitHandler() {
    kickoffWatchTimeout = null;
    if (gameState !== State.PLAY || !kickoffWatching || kickoffWatchPaused) return;
    var scores = room.getScores();
    if (scores != null && scores.time === kickoffClockAtStart) {
        forfeitKickoffTeam();
    }
}

function scheduleKickoffWatchTimers() {
    clearKickoffWatchTimeoutsOnly();
    if (!kickoffWatching || kickoffWatchPaused) return;
    var now = Date.now();
    var clearLeft = kickoffClearDeadline - now;
    if (clearLeft <= 0) {
        clearKickoffWatch();
        return;
    }
    kickoffClearTimeout = setTimeout(clearKickoffWatch, clearLeft);

    var forfeitLeft = kickoffForfeitDeadline - now;
    if (forfeitLeft <= 0) {
        kickoffForfeitHandler();
        return;
    }
    kickoffWatchTimeout = setTimeout(kickoffForfeitHandler, forfeitLeft);

    if (!kickoffWarnFired) {
        var warnLeft = kickoffWarnDeadline - now;
        if (warnLeft <= 0) {
            kickoffWarnHandler();
        } else {
            kickoffWarnTimeout = setTimeout(kickoffWarnHandler, warnLeft);
        }
    }
}

function pauseKickoffWatch() {
    if (!kickoffWatching || kickoffWatchPaused) return;
    kickoffWatchPaused = true;
    kickoffPausedAt = Date.now();
    clearKickoffWatchTimeoutsOnly();
}

function resumeKickoffWatch() {
    if (!kickoffWatching || !kickoffWatchPaused) return;
    if (kickoffPausedAt > 0) {
        var pausedMs = Date.now() - kickoffPausedAt;
        kickoffWarnDeadline += pausedMs;
        kickoffForfeitDeadline += pausedMs;
        kickoffClearDeadline += pausedMs;
        kickoffPausedAt = 0;
    }
    kickoffWatchPaused = false;
    if (gameState !== State.PLAY || !kickoffAfkEnabled()) {
        clearKickoffWatch();
        return;
    }
    scheduleKickoffWatchTimers();
}

function forfeitKickoffTeam() {
    if (gameState === State.STOP) return;
    var winner = opponentTeam(kickOffTeam);
    var name = kickOffTeam === Team.RED ? 'Red' : 'Blue';
    clearKickoffWatch();
    rankedForfeit = true;
    forfeitReason = 'AFK';
    updateTeams();
    var kickoffPlayers = kickOffTeam === Team.RED ? [...teamRed] : [...teamBlue];
    if (kickoffPlayers.length > 0) forfeitAuth = getPlayerAuth(kickoffPlayers[0]);
    room.sendAnnouncement(
        `⛔ ${name} kickoff timeout — forfeit (ranked)`,
        null,
        warningColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
    endGame(winner);
    for (var p of kickoffPlayers) {
        forfeitExemptLeaveIds.add(p.id);
        room.kickPlayer(p.id, 'Kickoff AFK', false);
    }
    stopTimeout = setTimeout(() => room.stopGame(), 100);
}

/** Kickoff team must start play within kickoffAfkForfeitSeconds or match clock stays frozen → forfeit. */
function startKickoffWatch(team) {
    clearKickoffWatch();
    if (gameState === State.STOP || !kickoffAfkEnabled()) return;
    kickOffTeam = team;
    kickoffClockAtStart = room.getScores().time;
    kickoffWatching = true;
    kickoffWatchPaused = false;
    kickoffWarnFired = false;
    var now = Date.now();
    kickoffWarnDeadline = now + kickoffAfkWarnSeconds * 1000;
    kickoffForfeitDeadline = now + kickoffAfkForfeitSeconds * 1000;
    kickoffClearDeadline = now + kickoffAfkWindowSeconds * 1000;
    scheduleKickoffWatchTimers();
}

function checkTime() {
    const scores = room.getScores();
    if (game != undefined) game.scores = scores;
    if (Math.abs(scores.time - scores.timeLimit) <= 0.01 && scores.timeLimit != 0 && playSituation == Situation.PLAY) {
        if (scores.red != scores.blue) {
            if (!checkTimeVariable) {
                checkTimeVariable = true;
                setTimeout(() => {
                    checkTimeVariable = false;
                }, 3000);
                scores.red > scores.blue ? endGame(Team.RED) : endGame(Team.BLUE);
                stopTimeout = setTimeout(() => {
                    room.stopGame();
                }, 2000);
            }
            return;
        }
        if (drawTimeLimit != 0) {
            if (!goldenGoal) {
                goldenGoal = true;
                room.sendAnnouncement(
                    `⚽ Golden goal — next goal wins (${drawTimeLimit} min OT)`,
                    null,
                    announcementColor,
                    FONT_FORMAT.bold,
                    HaxNotification.CHAT
                );
            }
        }
    }
    if (Math.abs(scores.time - drawTimeLimit * 60 - scores.timeLimit) <= 0.01 && scores.timeLimit != 0) {
        if (!checkTimeVariable) {
            checkTimeVariable = true;
            setTimeout(() => {
                checkTimeVariable = false;
            }, 10);
            endGame(Team.SPECTATORS);
            room.stopGame();
            goldenGoal = false;
        }
    }
}

/** Single entry point for auto-starting a game. Clears any pending start (avoids stale double-starts) and locks `arranging` until kickoff. */
function scheduleStart(ms) {
    arranging = true;
    clearTimeout(startTimeout);
    startTimeout = setTimeout(() => {
        room.startGame();
    }, ms);
}

function instantRestart() {
    room.stopGame();
    scheduleStart(10);
}

function resumeGame() {
    scheduleStart(1000);
    setTimeout(() => {
        room.pauseGame(false);
    }, 500);
}

/** Ranked forfeit applies after a 30s grace window — leave/AFK inside it = unranked restart. */
function isRankedForfeitEligible() {
    if (gameState === State.STOP || !currentMatchFormat || !game?.scores) return false;
    return game.scores.time >= forfeitGraceSeconds;
}

function opponentTeam(team) {
    return team === Team.RED ? Team.BLUE : Team.RED;
}

function formatSideSize(format) {
    if (!format) return 0;
    var m = format.match(/^(\d)x\1$/);
    return m ? parseInt(m[1], 10) : 0;
}

/** Both sides below the format the match started as — but equal 1v1 is an OK downgrade, not a broken match. */
function isLiveFormatBroken() {
    if (!currentMatchFormat || gameState === State.STOP) return false;
    var required = formatSideSize(currentMatchFormat);
    if (required < 2) return false;
    if (teamRed.length === 1 && teamBlue.length === 1) return false;
    return teamRed.length < required || teamBlue.length < required;
}

/** Grace-window leaver: match continues but player exits before forfeitGraceSeconds — no Elo, no game counted. Stats roster only; playerComp stays intact for playtime/goal attribution (credited via orphan path, games unchanged). */
function removeFromEloRosters(player) {
    var auth = getPlayerAuth(player);
    if (!auth) return;
    teamRedStats = teamRedStats.filter((p) => getPlayerAuth(p) !== auth);
    teamBlueStats = teamBlueStats.filter((p) => getPlayerAuth(p) !== auth);
}

function recordMatchLeaver(player, reason) {
    if (!currentMatchFormat || gameState === State.STOP) return;
    if (player.team !== Team.RED && player.team !== Team.BLUE) return;
    if (!isRankedForfeitEligible()) return;
    var auth = getPlayerAuth(player);
    if (!auth || matchLeavers.some((l) => l.auth === auth)) return;
    matchLeavers.push({
        auth,
        name: player.name,
        team: player.team,
        reason,
    });
}

function handleFormatBrokenMatch() {
    if (endGameVariable || gameState === State.STOP || !isLiveFormatBroken()) return;
    cancelFillWait();
    if (!isRankedForfeitEligible() || matchLeavers.length < 1) {
        if (!chooseMode) instantRestart();
        else room.stopGame();
        return;
    }
    formatBrokenMatch = true;
    rankedForfeit = true;
    forfeitReason = 'left';
    forfeitAuth = matchLeavers[0].auth;
    var scores = room.getScores();
    var winner = Team.SPECTATORS;
    if (scores.red > scores.blue) winner = Team.RED;
    else if (scores.blue > scores.red) winner = Team.BLUE;
    room.sendAnnouncement(
        `⛔ ${currentMatchFormat} roster broken — leavers penalized · remaining players Elo unchanged`,
        null,
        warningColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
    endGame(winner);
    stopTimeout = setTimeout(() => room.stopGame(), 100);
}

/** Leave / AFK forfeit — award ranked Elo to both sides (leaver included via stats roster). */
function tryRankedForfeit(forfeitingPlayer, reason) {
    if (endGameVariable || !isRankedForfeitEligible()) return false;
    if (forfeitingPlayer.team !== Team.RED && forfeitingPlayer.team !== Team.BLUE) return false;

    rankedForfeit = true;
    forfeitAuth = getPlayerAuth(forfeitingPlayer);
    forfeitReason = reason;
    var winner = opponentTeam(forfeitingPlayer.team);
    endGame(winner);
    var penaltyNote =
        reason === 'left' ? ` · ~${ELO_FORFEIT_LEAVER_MULT.toFixed(1)}× leave loss` :
        reason === 'AFK' ? ` · ~${ELO_FORFEIT_LEAVER_MULT.toFixed(1)}× AFK loss` : '';
    room.sendAnnouncement(
        `⛔ ${forfeitingPlayer.name} ${reason} — ${winner === Team.RED ? '🔴 Red' : '🔵 Blue'} wins (ranked)${penaltyNote}`,
        null,
        infoColor,
        FONT_FORMAT.bold,
        HaxNotification.MENTION
    );
    cancelFillWait();
    stopTimeout = setTimeout(() => room.stopGame(), 100);
    return true;
}

function endGame(winner) {
    const scores = room.getScores();
    game.scores = scores;
    lastWinner = winner;
    endGameVariable = true;
    if (winner == Team.RED) {
        streak++;
        room.sendAnnouncement(
            `🔴 Red wins  ${scores.red}-${scores.blue}  ·  streak ${streak}`,
            null,
            redColor,
            null,
            HaxNotification.CHAT
        );
    } else if (winner == Team.BLUE) {
        streak = 1;
        room.sendAnnouncement(
            `🔵 Blue wins  ${scores.blue}-${scores.red}  ·  streak ${streak}`,
            null,
            blueColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        streak = 0;
        room.sendAnnouncement(
            '💤 Draw — golden goal OT expired · Elo unchanged',
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    }
    let possessionTotal = possession[0] + possession[1];
    let possessionRedPct = possessionTotal > 0 ? (possession[0] / possessionTotal) * 100 : 50;
    let possessionBluePct = 100 - possessionRedPct;
    let possessionString = `Possession  🔴 ${possessionRedPct.toFixed(0)}%  ·  🔵 ${possessionBluePct.toFixed(0)}%`;
    let actionTotal = actionZoneHalf[0] + actionZoneHalf[1];
    let actionRedPct = actionTotal > 0 ? (actionZoneHalf[0] / actionTotal) * 100 : 50;
    let actionBluePct = 100 - actionRedPct;
    let actionString = `Attack zone  🔴 ${actionRedPct.toFixed(0)}%  ·  🔵 ${actionBluePct.toFixed(0)}%`;
    let CSString = getCSString(scores);
    room.sendAnnouncement(
        `📊 Match stats\n` +
        `${possessionString}\n` +
        `${actionString}\n` +
        `${CSString}`,
        null,
        announcementColor,
        null,
        HaxNotification.NONE
    );
    if (winner !== Team.SPECTATORS && streak % 3 === 0 && isRebalanceEligible(currentMatchFormat)) {
        pendingRebalance = true;
        pendingRebalanceFormat = currentMatchFormat;
        room.sendAnnouncement(
            `⚖️ ${streak}-win streak — teams rebalanced by Elo next match`,
            null,
            announcementColor,
            FONT_FORMAT.bold,
            HaxNotification.CHAT
        );
    }
    scheduleRankedStats();
}

/* CHOOSING FUNCTIONS */

function activateChooseMode() {
    chooseMode = true;
    slowMode = chooseModeSlowMode;
    room.sendAnnouncement(
        `🐢 Slow mode: ${chooseModeSlowMode}s (pick)`,
        null,
        announcementColor,
        null,
        HaxNotification.CHAT
    );
}

function deactivateChooseMode() {
    chooseMode = false;
    clearTimeout(timeOutCap);
    if (slowMode != defaultSlowMode) {
        slowMode = defaultSlowMode;
        room.sendAnnouncement(
            `🐢 Slow mode: ${defaultSlowMode}s (normal)`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    }
}

/** Per-team target for current player count (caps at config teamSize). 4-5p => 2, 6+ => 3, etc. */
function getEffectiveSize() {
    return Math.min(teamSize, Math.floor(players.length / 2));
}

/** Both teams reached the effective target size — leftover players stay in spec. */
function teamsFull() {
    var e = getEffectiveSize();
    return teamRed.length >= e && teamBlue.length >= e;
}

/** A captain still owes a pick: a team is below target and someone waits in spec. */
function needCaptainPick() {
    var e = getEffectiveSize();
    return teamSpec.length > 0 && (teamRed.length < e || teamBlue.length < e);
}

/** Choose mode done once both teams are full at the effective size. */
function chooseComplete() {
    return chooseMode && teamsFull();
}

function afterTopButtonAtFivePlayers() {
    updateTeams();
    if (teamSpec.length > 0) {
        activateChooseMode();
        choosePlayer();
    } else {
        deactivateChooseMode();
        scheduleStart(2000);
    }
}

/** Format used to rank Elo during captain picks — lobby target size, falling back to the live match format. */
function getChooseModeFormat() {
    return getLobbyMatchFormat() || currentMatchFormat || '2x2';
}

function getSpecPlayerElo(player, format) {
    var auth = getPlayerAuth(player);
    return auth ? getFormatElo(loadPlayerRecord(auth, player.name), format) : ELO_DEFAULT;
}

/** Index of the highest-Elo spec player. Ties resolve to whoever is earlier in the queue. */
function pickTopEloIndex(format) {
    var bestIdx = -1;
    var bestElo = -Infinity;
    for (let i = 0; i < teamSpec.length; i++) {
        var elo = getSpecPlayerElo(teamSpec[i], format);
        if (elo > bestElo) {
            bestElo = elo;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function getSpecList(player, captainPick) {
    if (player == null) return null;
    var format = getChooseModeFormat();
    var body = '';
    for (let i = 0; i < teamSpec.length; i++) {
        var p = teamSpec[i];
        var record = loadPlayerRecordFor(p);
        var rank = getPlayerRankForFormat(p, format, record);
        var elo = record ? getFormatElo(record, format) : ELO_DEFAULT;
        var rankStr = rank.unranked ? `${rank.emoji} · ${ELO_DEFAULT}` : `${rank.emoji} ${rank.short} · ${elo}`;
        body += `${i + 1}. ${p.name} — ${rankStr}\n`;
    }
    var n = teamSpec.length;
    var hint = n > 1 ? `Type 1–${n} · elo · random · bottom` : 'Type 1 to pick';
    var title = captainPick ? `⭐ Pick a teammate (${format})` : `👥 Pick list (${format})`;
    room.sendAnnouncement(
        `${title}\n\n${body}${hint}`,
        player.id,
        infoColor,
        captainPick ? FONT_FORMAT.bold : null,
        captainPick ? HaxNotification.MENTION : HaxNotification.CHAT
    );
}

function choosePlayer() {
    clearTimeout(timeOutCap);
    if (!needCaptainPick()) {
        deactivateChooseMode();
        resumeGame();
        return;
    }
    let captain;
    if (teamRed.length <= teamBlue.length && teamRed.length != 0) {
        captain = teamRed[0];
    } else if (teamBlue.length < teamRed.length && teamBlue.length != 0) {
        captain = teamBlue[0];
    }
    if (captain != null) {
        getSpecList(captain, true);
        timeOutCap = setTimeout(
            (player) => {
                if (gameState !== State.STOP || !chooseMode || !needCaptainPick()) return;
                room.sendAnnouncement(
                    `⏰ ${chooseTime / 2 | 0}s left — type a number or you'll be kicked`,
                    player.id,
                    warningColor,
                    FONT_FORMAT.bold,
                    HaxNotification.MENTION
                );
                timeOutCap = setTimeout(
                    (player) => {
                        if (gameState !== State.STOP || !chooseMode || !needCaptainPick()) return;
                        room.kickPlayer(
                            player.id,
                            "Pick timeout",
                            false
                        );
                    },
                    chooseTime * 500,
                    captain
                );
            },
            chooseTime * 1000,
            captain
        );
    }
}

/** Resolve a captain's keyword/number to a teamSpec index. recognized=false means "not a pick attempt" (falls through to normal chat). */
function resolveChoosePickIndex(keyword) {
    var lower = keyword.toLowerCase();
    if (lower === 'top') return { idx: 0, recognized: true };
    if (lower === 'elo' || lower === 'auto') return { idx: pickTopEloIndex(getChooseModeFormat()), recognized: true };
    if (lower === 'random' || lower === 'rand') return { idx: getRandomInt(teamSpec.length), recognized: true };
    if (lower === 'bottom' || lower === 'bot') return { idx: teamSpec.length - 1, recognized: true };
    var n = Number.parseInt(keyword);
    if (!Number.isNaN(n)) {
        return { idx: n >= 1 && n <= teamSpec.length ? n - 1 : -1, recognized: true };
    }
    return { idx: -1, recognized: false };
}

function pickLabelForKeyword(lower, pickedName) {
    if (lower === 'top') return 'Top';
    if (lower === 'elo' || lower === 'auto') return 'Elo';
    if (lower === 'random' || lower === 'rand') return 'Random';
    if (lower === 'bottom' || lower === 'bot') return 'Bottom';
    return pickedName;
}

/** Applies one captain's pick keyword to the given team. Returns true if the message was consumed as a pick attempt. */
function applyChoosePick(captain, team, keyword) {
    var result = resolveChoosePickIndex(keyword);
    if (!result.recognized) return false;
    var picked = result.idx >= 0 ? teamSpec[result.idx] : null;
    if (picked == null) {
        room.sendAnnouncement(
            `Bad number. Check list.`,
            captain.id,
            errorColor,
            FONT_FORMAT.bold,
            HaxNotification.CHAT
        );
        return true;
    }
    room.setPlayerTeam(picked.id, team);
    clearTimeout(timeOutCap);
    room.sendAnnouncement(
        `${captain.name} picked: ${pickLabelForKeyword(keyword.toLowerCase(), picked.name)}`,
        null,
        announcementColor,
        null,
        HaxNotification.CHAT
    );
    return true;
}

function chooseModeFunction(player, message) {
    var msgArray = message.split(/ +/);
    if (player.id == teamRed[0].id || player.id == teamBlue[0].id) {
        if (teamRed.length <= teamBlue.length && player.id == teamRed[0].id) {
            return applyChoosePick(player, Team.RED, msgArray[0]);
        }
        if (teamRed.length > teamBlue.length && player.id == teamBlue[0].id) {
            return applyChoosePick(player, Team.BLUE, msgArray[0]);
        }
    }
}

function checkCaptainLeave(player) {
    if (
        (teamRed.findIndex((red) => red.id == player.id) == 0 && chooseMode && teamRed.length <= teamBlue.length) ||
        (teamBlue.findIndex((blue) => blue.id == player.id) == 0 && chooseMode && teamBlue.length < teamRed.length)
    ) {
        choosePlayer();
        capLeft = true;
        setTimeout(() => {
            capLeft = false;
        }, 10);
    }
}

function slowModeFunction(player, message) {
    if (!player.admin) {
        if (!SMSet.has(player.id)) {
            SMSet.add(player.id);
            setTimeout(
                (number) => {
                    SMSet.delete(number);
                },
                slowMode * 1000,
                player.id
            );
        } else {
            return true;
        }
    }
    return false;
}

/* PLAYER FUNCTIONS */

/* Rebuild teamRed / teamBlue / teamSpec from room. Call on join, leave, team change, and before bot team buttons — not onGameTick. Admin UI drags fire onPlayerTeamChange too. */
function updateTeams() {
    playersAll = room.getPlayerList();
    players = [];
    teamRed = [];
    teamBlue = [];
    teamSpec = [];
    for (let p of playersAll) {
        if (AFKSet.has(p.id)) continue;
        players.push(p);
        if (p.team == Team.RED) teamRed.push(p);
        else if (p.team == Team.BLUE) teamBlue.push(p);
        else teamSpec.push(p);
    }
}

function updateAdmins(excludedPlayerID = 0) {
    if (players.length != 0 && players.filter((p) => p.admin).length < maxAdmins) {
        let playerArray = players.filter((p) => p.id != excludedPlayerID && !p.admin);
        let arrayID = playerArray.map((player) => player.id);
        room.setPlayerAdmin(Math.min(...arrayID), true);
    }
}

function getRole(player) {
    var auth = authArray[player.id][0];
    return (
        masterSet.has(auth) * 2 +
        adminAuthSet.has(auth) * 1 +
        player.admin * 1
    );
}

function ghostKickHandle(oldP, newP) {
    var teamArrayId = getTeamArray(oldP.team, true).map((p) => p.id);
    teamArrayId.splice(teamArrayId.findIndex((id) => id == oldP.id), 1, newP.id);

    room.kickPlayer(oldP.id, 'Reconnect', false);
    room.setPlayerTeam(newP.id, oldP.team);
    room.setPlayerAdmin(newP.id, oldP.admin);
    room.reorderPlayers(teamArrayId, true);

    if (oldP.team != Team.SPECTATORS && playSituation != Situation.STOP) {
        var discProp = room.getPlayerDiscProperties(oldP.id);
        room.setPlayerDiscProperties(newP.id, discProp);
    }
}

/* ACTIVITY FUNCTIONS */

function handleActivityPlayer(player) {
    let pComp = getPlayerComp(player);
    if (pComp != null) {
        if (debugMode) return;
        pComp.inactivityTicks++;
        if (pComp.inactivityTicks == 60 * ((2 / 3) * afkInactivitySeconds)) {
            room.sendAnnouncement(
                `⛔ ${player.name} — move or chat in ${Math.floor(afkInactivitySeconds / 3)} sec or kick (AFK)`,
                player.id,
                warningColor,
                FONT_FORMAT.bold,
                HaxNotification.MENTION
            );
            return;
        }
        if (pComp.inactivityTicks >= 60 * afkInactivitySeconds) {
            pComp.inactivityTicks = 0;
            recordMatchLeaver(player, 'AFK');
            room.kickPlayer(player.id, 'AFK', false);
        }
    }
}

function handleActivityPlayerTeamChange(changedPlayer) {
    if (changedPlayer.team == Team.SPECTATORS) {
        let pComp = getPlayerComp(changedPlayer);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
}

function handleActivityStop() {
    for (let player of players) {
        let pComp = getPlayerComp(player);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
}

function handleActivity() {
    if (gameState === State.PLAY && players.length > 1) {
        for (let player of teamRed) {
            handleActivityPlayer(player);
        }
        for (let player of teamBlue) {
            handleActivityPlayer(player);
        }
    }
}

/* LINEUP FUNCTIONS */

function getStartingLineups() {
    var compositions = [[], []];
    for (let player of teamRed) {
        compositions[0].push(
            new PlayerComposition(player, authArray[player.id][0], [0], [])
        );
    }
    for (let player of teamBlue) {
        compositions[1].push(
            new PlayerComposition(player, authArray[player.id][0], [0], [])
        );
    }
    return compositions;
}

function handleLineupChangeTeamChange(changedPlayer) {
    if (gameState != State.STOP) {
        var playerLineup;
        if (changedPlayer.team == Team.RED) {
            // player gets in red team
            var redLineupAuth = game.playerComp[0].map((p) => p.auth);
            var ind = redLineupAuth.findIndex((auth) => auth == authArray[changedPlayer.id][0]);
            if (ind != -1) {
                // Player goes back in
                playerLineup = game.playerComp[0][ind];
                if (playerLineup.timeExit.includes(game.scores.time)) {
                    // gets subbed off then in at the exact same time -> no sub
                    playerLineup.timeExit = playerLineup.timeExit.filter((t) => t != game.scores.time);
                } else {
                    playerLineup.timeEntry.push(game.scores.time);
                }
            } else {
                playerLineup = new PlayerComposition(
                    changedPlayer,
                    authArray[changedPlayer.id][0],
                    [game.scores.time],
                    []
                );
                game.playerComp[0].push(playerLineup);
            }
        } else if (changedPlayer.team == Team.BLUE) {
            // player gets in blue team
            var blueLineupAuth = game.playerComp[1].map((p) => p.auth);
            var ind = blueLineupAuth.findIndex((auth) => auth == authArray[changedPlayer.id][0]);
            if (ind != -1) {
                // Player goes back in
                playerLineup = game.playerComp[1][ind];
                if (playerLineup.timeExit.includes(game.scores.time)) {
                    // gets subbed off then in at the exact same time -> no sub
                    playerLineup.timeExit = playerLineup.timeExit.filter((t) => t != game.scores.time);
                } else {
                    playerLineup.timeEntry.push(game.scores.time);
                }
            } else {
                playerLineup = new PlayerComposition(
                    changedPlayer,
                    authArray[changedPlayer.id][0],
                    [game.scores.time],
                    []
                );
                game.playerComp[1].push(playerLineup);
            }
        }
        if (teamRed.some((r) => r.id == changedPlayer.id)) {
            // player leaves red team
            var redLineupAuth = game.playerComp[0].map((p) => p.auth);
            var ind = redLineupAuth.findIndex((auth) => auth == authArray[changedPlayer.id][0]);
            playerLineup = game.playerComp[0][ind];
            if (playerLineup.timeEntry.includes(game.scores.time)) {
                // gets subbed off then in at the exact same time -> no sub
                if (game.scores.time == 0) {
                    game.playerComp[0].splice(ind, 1);
                } else {
                    playerLineup.timeEntry = playerLineup.timeEntry.filter((t) => t != game.scores.time);
                }
            } else {
                playerLineup.timeExit.push(game.scores.time);
            }
        } else if (teamBlue.some((r) => r.id == changedPlayer.id)) {
            // player leaves blue team
            var blueLineupAuth = game.playerComp[1].map((p) => p.auth);
            var ind = blueLineupAuth.findIndex((auth) => auth == authArray[changedPlayer.id][0]);
            playerLineup = game.playerComp[1][ind];
            if (playerLineup.timeEntry.includes(game.scores.time)) {
                // gets subbed off then in at the exact same time -> no sub
                if (game.scores.time == 0) {
                    game.playerComp[1].splice(ind, 1);
                } else {
                    playerLineup.timeEntry = playerLineup.timeEntry.filter((t) => t != game.scores.time);
                }
            } else {
                playerLineup.timeExit.push(game.scores.time);
            }
        }
        rebuildCompIndex();
    }
}

function handleLineupChangeLeave(player) {
    if (playSituation != Situation.STOP) {
        if (player.team == Team.RED) {
            // player gets in red team
            var redLineupAuth = game.playerComp[0].map((p) => p.auth);
            var ind = redLineupAuth.findIndex((auth) => auth == authArray[player.id][0]);
            var playerLineup = game.playerComp[0][ind];
            if (playerLineup.timeEntry.includes(game.scores.time)) {
                // gets subbed off then in at the exact same time -> no sub
                if (game.scores.time == 0) {
                    game.playerComp[0].splice(ind, 1);
                } else {
                    playerLineup.timeEntry = playerLineup.timeEntry.filter((t) => t != game.scores.time);
                }
            } else {
                playerLineup.timeExit.push(game.scores.time);
            }
        } else if (player.team == Team.BLUE) {
            // player gets in blue team
            var blueLineupAuth = game.playerComp[1].map((p) => p.auth);
            var ind = blueLineupAuth.findIndex((auth) => auth == authArray[player.id][0]);
            var playerLineup = game.playerComp[1][ind];
            if (playerLineup.timeEntry.includes(game.scores.time)) {
                // gets subbed off then in at the exact same time -> no sub
                if (game.scores.time == 0) {
                    game.playerComp[1].splice(ind, 1);
                } else {
                    playerLineup.timeEntry = playerLineup.timeEntry.filter((t) => t != game.scores.time);
                }
            } else {
                playerLineup.timeExit.push(game.scores.time);
            }
        }
        rebuildCompIndex();
    }
}

/* TEAM BALANCE FUNCTIONS */

/** Stadium key for the current player count: solo / duel / small / full. */
function desiredStadiumKey() {
    if (players.length <= 1) return stadiumKeys.solo;
    var e = getEffectiveSize();
    if (e <= 1) return stadiumKeys.duel;
    if (e === 2) return stadiumKeys.small;
    return stadiumKeys.full;
}

/** Max players per side for the current headcount (1 for 1v1/duel, 2 for 2v2, etc.). */
function getTargetSideSize() {
    var N = players.length;
    if (N <= 1) return 0;
    return Math.min(teamSize, Math.floor(N / 2));
}

/** Full 2v2 or 3v3 only — match format matches headcount and everyone is on a team (no specs). */
function isRebalanceEligible(format) {
    if (!format || format === '1x1') return false;
    var sideSize = formatSideSize(format);
    if (sideSize < 2) return false;
    updateTeams();
    var need = 2 * sideSize;
    return players.length === need
        && teamRed.length === sideSize
        && teamBlue.length === sideSize
        && teamSpec.length === 0;
}

/** Winner-stay if someone from the winning side is still in the room (not full lobby required). */
function canUseWinnerStay(winner) {
    if (winner === Team.SPECTATORS) return false;
    updateTeams();
    var E = getTargetSideSize();
    if (E < 1) return false;
    var winSide = winner === Team.RED ? teamRed : teamBlue;
    return winSide.length > 0;
}

/** Lobby only: map + teams + optional kickoff. */
function arrangeRoster(winner) {
    updateTeams();
    var N = players.length;
    if (N === 0) {
        room.stopGame();
        return;
    }
    var key = desiredStadiumKey();
    if (currentStadium !== key) loadStadiumByKey(key);
    if (N === 1) {
        applyingTeams = true;
        room.setPlayerTeam(players[0].id, Team.RED);
        applyingTeams = false;
        updateTeams();
        scheduleStart(2000);
        return;
    }
    var useWinnerStay = canUseWinnerStay(winner);
    if (!useWinnerStay) winner = Team.SPECTATORS;
    var E = getTargetSideSize();
    // Winners always take red slots next (Haxball / Wazarr convention); blue win = blues → red.
    var redKeep = useWinnerStay
        ? (winner === Team.RED ? teamRed : teamBlue).slice(0, E)
        : [];
    var blueKeep = [];
    var keptIds = new Set(redKeep.map((p) => p.id));
    var pool = players.filter((p) => !keptIds.has(p.id));
    var now = Date.now();
    for (var p of pool) {
        if (p.team !== Team.SPECTATORS) lastSpecTime.set(p.id, now++);
    }
    pool.sort((a, b) => (lastSpecTime.get(a.id) || 0) - (lastSpecTime.get(b.id) || 0));
    var isCaptainPick = E >= 2 && N - 2 * E > 0 && players.length >= 2 * teamSize - 1;
    var redTarget = isCaptainPick ? 1 : E;
    var blueTarget = isCaptainPick ? 1 : E;
    var red = redKeep.slice();
    var blue = blueKeep.slice();
    for (var p of pool) {
        if (red.length >= redTarget && blue.length >= blueTarget) break;
        if (red.length < redTarget && red.length <= blue.length) red.push(p);
        else if (blue.length < blueTarget) blue.push(p);
        else red.push(p);
    }
    var playIds = new Set([...red, ...blue].map((p) => p.id));
    var spec = players.filter((p) => !playIds.has(p.id));
    applyingTeams = true;
    for (var rp of red) room.setPlayerTeam(rp.id, Team.RED);
    for (var bp of blue) room.setPlayerTeam(bp.id, Team.BLUE);
    for (var sp of spec) room.setPlayerTeam(sp.id, Team.SPECTATORS);
    applyingTeams = false;
    updateTeams();
    if (isCaptainPick) {
        setTimeout(() => {
            updateTeams();
            activateChooseMode();
            choosePlayer();
        }, 100);
    } else {
        if (chooseMode) deactivateChooseMode();
        scheduleStart(2000);
    }
}

/** Anti-snowball: silently rebalance both teams by Elo via snake draft. Bypasses winner-stay for one restart. */
function rebalanceTeamsByElo() {
    var format = pendingRebalanceFormat;
    if (!format || !isRebalanceEligible(format)) {
        pendingRebalance = false;
        pendingRebalanceFormat = null;
        requestArrange(Team.SPECTATORS);
        return;
    }
    var E = formatSideSize(format);
    var ranked = players.map((p) => {
        var auth = getPlayerAuth(p);
        var elo = auth ? getFormatElo(loadPlayerRecord(auth, p.name), format) : ELO_DEFAULT;
        return { player: p, elo };
    });
    ranked.sort((a, b) => b.elo - a.elo);
    var picked = ranked.slice(0, 2 * E);
    var red = [];
    var blue = [];
    // Snake draft (R, B, B, R, R, B, …) keeps team-average Elo near-equal.
    for (var i = 0; i < picked.length; i++) {
        var toBlue = i % 4 === 1 || i % 4 === 2;
        if (toBlue && blue.length < E) blue.push(picked[i].player);
        else if (!toBlue && red.length < E) red.push(picked[i].player);
        else if (red.length < E) red.push(picked[i].player);
        else blue.push(picked[i].player);
    }
    var playIds = new Set([...red, ...blue].map((p) => p.id));
    var now = Date.now();
    var spec = players.filter((p) => !playIds.has(p.id));
    for (var sp of spec) lastSpecTime.set(sp.id, now++);
    applyingTeams = true;
    for (var rp of red) room.setPlayerTeam(rp.id, Team.RED);
    for (var bp of blue) room.setPlayerTeam(bp.id, Team.BLUE);
    for (var spp of spec) room.setPlayerTeam(spp.id, Team.SPECTATORS);
    applyingTeams = false;
    updateTeams();
    streak = 0;
    pendingRebalance = false;
    pendingRebalanceFormat = null;
    endGameVariable = false;
    if (chooseMode) deactivateChooseMode();
    var key = desiredStadiumKey();
    if (currentStadium !== key) loadStadiumByKey(key);
    scheduleStart(2000);
}

function requestArrange(winner) {
    updateTeams();
    if (players.length === 0) {
        room.stopGame();
        return;
    }
    if (gameState !== State.STOP) {
        room.stopGame();
        setTimeout(() => arrangeRoster(winner), 100);
    } else {
        arrangeRoster(winner);
    }
}

function cancelFillWait() {
    clearTimeout(fillTimeout);
    if (waitingForFill) {
        waitingForFill = false;
        room.pauseGame(false);
    }
}

/** During live play, may specs replace a missing player? Never in 1v1. */
function canFillFromSpecLive() {
    if (gameState === State.STOP || endGameVariable) return false;
    if (currentMatchFormat === '1x1') return false;
    var required = currentMatchFormat ? formatSideSize(currentMatchFormat) : 0;
    if (required < 2) return false;
    updateTeams();
    return teamSpec.length > 0;
}

/** Live short-handed: fill from spec if possible, else 10s pause then win for fuller side → stop → lobby map downgrade. */
function handleLiveShortHanded() {
    if (endGameVariable) return;
    updateTeams();
    var diff = teamRed.length - teamBlue.length;
    if (diff === 0) {
        if (isLiveFormatBroken()) {
            handleFormatBrokenMatch();
            return;
        }
        cancelFillWait();
        return;
    }
    if (teamSpec.length > 0 && canFillFromSpecLive()) {
        var shortTeam = diff > 0 ? Team.BLUE : Team.RED;
        var need = Math.abs(diff);
        applyingTeams = true;
        for (var i = 0; i < need && i < teamSpec.length; i++) {
            room.setPlayerTeam(teamSpec[i].id, shortTeam);
        }
        applyingTeams = false;
        updateTeams();
        if (Math.abs(teamRed.length - teamBlue.length) === 0) {
            if (isLiveFormatBroken()) {
                handleFormatBrokenMatch();
                return;
            }
            room.sendAnnouncement(
                '✅ Spec joined team.',
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
            cancelFillWait();
            return;
        }
    }
    if (!waitingForFill) {
        waitingForFill = true;
        room.pauseGame(true);
        room.sendAnnouncement(
            '⏳ Team missing player. Wait 10 sec…\nOr fuller team wins.',
            null,
            warningColor,
            FONT_FORMAT.bold,
            HaxNotification.CHAT
        );
    }
    clearTimeout(fillTimeout);
    fillTimeout = setTimeout(() => {
        updateTeams();
        if (gameState === State.STOP) {
            waitingForFill = false;
            return;
        }
        if (players.length <= 1) {
            waitingForFill = false;
            return;
        }
        if (teamRed.length === teamBlue.length) {
            if (isLiveFormatBroken()) {
                handleFormatBrokenMatch();
                return;
            }
            cancelFillWait();
            return;
        }
        waitingForFill = false;
        if (isRankedForfeitEligible()) {
            rankedForfeit = true;
            if (matchLeavers.length > 0) {
                forfeitAuth = matchLeavers[0].auth;
                forfeitReason = matchLeavers[0].reason;
            }
        }
        endGame(teamRed.length > teamBlue.length ? Team.RED : Team.BLUE);
        stopTimeout = setTimeout(() => room.stopGame(), 100);
    }, 10000);
}

/** Single entry: join / leave / kick / stop → debounced reconcile. */
function reconcileRoster() {
    if (applyingTeams) return;
    updateTeams();
    var N = players.length;
    if (N === 0) {
        room.stopGame();
        var emptyStadium = findStadiumByKey(currentStadium);
        room.setScoreLimit(emptyStadium?.scoreLimit ?? scoreLimit);
        room.setTimeLimit(emptyStadium?.timeLimit ?? timeLimit);
        return;
    }

    if (gameState !== State.STOP) {
        if (chooseMode) return;
        if (endGameVariable) return;
        if (N <= 1) {
            cancelFillWait();
            room.stopGame();
            return;
        }
        if (N <= 2 && (teamRed.length === 0 || teamBlue.length === 0)) {
            cancelFillWait();
            room.stopGame();
            return;
        }
        // Short-handed / broken format before 0-0 stadium downgrade — otherwise a leave at 0-0 skips fill.
        if (teamRed.length !== teamBlue.length || isLiveFormatBroken()) {
            handleLiveShortHanded();
            return;
        }
        var scores = room.getScores();
        var isZeroZero = scores != null && scores.red === 0 && scores.blue === 0;
        if ((currentStadium === stadiumKeys.solo && N >= 2) || (isZeroZero && desiredStadiumKey() !== currentStadium)) {
            cancelFillWait();
            room.stopGame();
            return;
        }
        cancelFillWait();
        return;
    }

    if (chooseMode) {
        if (chooseComplete()) {
            deactivateChooseMode();
            resumeGame();
            return;
        }
        if (needCaptainPick()) {
            choosePlayer();
            return;
        }
        deactivateChooseMode();
    }

    if (pendingRebalance) {
        rebalanceTeamsByElo();
        return;
    }

    var winner = endGameVariable && canUseWinnerStay(lastWinner) ? lastWinner : Team.SPECTATORS;
    if (endGameVariable) endGameVariable = false;
    requestArrange(winner);
}

var rosterQueue = createDebouncedQueue(reconcileRoster, 50);

function scheduleRosterReconcile() {
    rosterQueue.schedule();
}

/** A join/leave landed in the pre-kickoff window. Cancel the pending start and re-arrange deterministically for the new count. */
function reArrangeDuringStart() {
    arranging = false;
    clearTimeout(startTimeout);
    scheduleRosterReconcile();
}

function handlePlayersJoin() {
    if (arranging) {
        reArrangeDuringStart();
        return;
    }
    if (chooseMode) {
        if (teamSize >= 3 && players.length == 6) {
            setTimeout(() => {
                loadStadiumByKey(stadiumKeys.full);
            }, 5);
        }
        if (chooseComplete()) {
            deactivateChooseMode();
            resumeGame();
        } else {
            getSpecList(teamRed.length <= teamBlue.length ? teamRed[0] : teamBlue[0]);
        }
    }
    scheduleRosterReconcile();
}

function handlePlayersLeave() {
    if (arranging) {
        reArrangeDuringStart();
        return;
    }
    if (chooseMode) {
        if (teamSize >= 2 && players.length == 5) {
            setTimeout(() => {
                    loadStadiumByKey(stadiumKeys.small);
            }, 5);
        }
        if (teamRed.length == 0 || teamBlue.length == 0) {
            if (teamSpec.length > 0) {
                applyingTeams = true;
                room.setPlayerTeam(teamSpec[0].id, teamRed.length == 0 ? Team.RED : Team.BLUE);
                applyingTeams = false;
            }
            scheduleRosterReconcile();
            return;
        }
        if (Math.abs(teamRed.length - teamBlue.length) == teamSpec.length) {
            deactivateChooseMode();
            var shortTeam = teamRed.length > teamBlue.length ? Team.BLUE : Team.RED;
            applyingTeams = true;
            for (var sp of teamSpec) room.setPlayerTeam(sp.id, shortTeam);
            applyingTeams = false;
            updateTeams();
            resumeGame();
            return;
        }
        if (streak == 0 && gameState == State.STOP) {
            if (Math.abs(teamRed.length - teamBlue.length) == 2) {
                var teamIn = teamRed.length > teamBlue.length ? teamRed : teamBlue;
                room.setPlayerTeam(teamIn[teamIn.length - 1].id, Team.SPECTATORS)
            }
        }
        if (chooseComplete()) {
            deactivateChooseMode();
            resumeGame();
            return;
        }

        if (capLeft) {
            choosePlayer();
        } else {
            getSpecList(teamRed.length <= teamBlue.length ? teamRed[0] : teamBlue[0]);
        }
    }
    scheduleRosterReconcile();
}

function handlePlayersTeamChange(byPlayer) {
    if (applyingTeams) return;
    if (chooseMode && byPlayer == null) {
        if (Math.abs(teamRed.length - teamBlue.length) == teamSpec.length) {
            deactivateChooseMode();
            var shortTeam = teamRed.length > teamBlue.length ? Team.BLUE : Team.RED;
            applyingTeams = true;
            for (var sp of teamSpec) room.setPlayerTeam(sp.id, shortTeam);
            applyingTeams = false;
            updateTeams();
            resumeGame();
            return;
        } else if (teamsFull()) {
            deactivateChooseMode();
            resumeGame();
        } else {
            choosePlayer();
        }
    }
}

function handlePlayersStop(byPlayer) {
    scheduleRosterReconcile();
}

/* STATS FUNCTIONS */

/* GK FUNCTIONS */

function handleGKTeam(team) {
    if (team == Team.SPECTATORS) {
        return null;
    }
    let teamArray = team == Team.RED ? teamRed : teamBlue;
    let playerGK = teamArray.reduce((prev, current) => {
        if (current.position == null) return prev;
        if (prev == null || prev.position == null) return current;
        if (team == Team.RED) {
            return prev.position.x < current.position.x ? prev : current;
        }
        return prev.position.x > current.position.x ? prev : current;
    }, null);
    if (playerGK == null) return null;
    let playerCompGK = getPlayerComp(playerGK);
    return playerCompGK;
}

function handleGK() {
    let redGK = handleGKTeam(Team.RED);
    if (redGK != null) {
        redGK.GKTicks++;
    }
    let blueGK = handleGKTeam(Team.BLUE);
    if (blueGK != null) {
        blueGK.GKTicks++;
    }
}

function getGK(team) {
    if (team == Team.SPECTATORS) {
        return null;
    }
    let teamArray = team == Team.RED ? game.playerComp[0] : game.playerComp[1];
    let playerGK = teamArray.reduce((prev, current) => {
        return (prev?.GKTicks > current.GKTicks) ? prev : current
    }, null);
    return playerGK;
}

function getCS(scores) {
    let playersNameCS = [];
    let redGK = getGK(Team.RED);
    let blueGK = getGK(Team.BLUE);
    if (redGK != null && scores.blue == 0) {
        playersNameCS.push(redGK.player.name);
    }
    if (blueGK != null && scores.red == 0) {
        playersNameCS.push(blueGK.player.name);
    }
    return playersNameCS;
}

function getCSString(scores) {
    let playersCS = getCS(scores);
    if (playersCS.length == 0) {
        return "🥅 No clean sheet";
    } else if (playersCS.length == 1) {
        return `🥅 ${playersCS[0]} — clean sheet (0 goals against)`;
    } else {
        return `🥅 ${playersCS[0]} & ${playersCS[1]} — clean sheet`;
    }
}

/* GLOBAL STATS FUNCTIONS */

function getLastTouchOfTheBall() {
    const ballPosition = tickBallPosition;
    let playerTouch = null;
    let minDistSq = triggerDistanceSq;
    for (let team of [teamRed, teamBlue]) {
        for (let player of team) {
            if (player.position == null) continue;
            var distanceToBallSq = pointDistanceSq(player.position, ballPosition);
            if (distanceToBallSq < triggerDistanceSq) {
                if (playSituation == Situation.KICKOFF && !kickoffWatching) playSituation = Situation.PLAY;
                if (distanceToBallSq < minDistSq) {
                    minDistSq = distanceToBallSq;
                    playerTouch = player;
                }
            }
        }
    }
    if (playerTouch != null) {
        if (lastTouches[0] == null || lastTouches[0].player.id != playerTouch.id) {
            pushBallTouch(playerTouch, game.scores.time, ballPosition);
        }
        lastTeamTouched = playerTouch.team;
    }
}

function getBallSpeed() {
    var ballProp = room.getDiscProperties(0);
    return Math.sqrt(ballProp.xspeed ** 2 + ballProp.yspeed ** 2) * speedCoefficient;
}

function getGameStats() {
    if (playSituation == Situation.PLAY && gameState == State.PLAY) {
        lastTeamTouched == Team.RED ? possession[0]++ : possession[1]++;
        var ballPosition = tickBallPosition;
        ballPosition.x < 0 ? actionZoneHalf[0]++ : actionZoneHalf[1]++;
        handleGK();
    }
}

/* GOAL ATTRIBUTION FUNCTIONS */

function getGoalAttribution(team) {
    var goalAttribution = Array(2).fill(null);
    if (lastTouches[0] != null) {
        if (lastTouches[0].player.team == team) {
            // Direct goal scored by player
            if (lastTouches[1] != null && lastTouches[1].player.team == team) {
                goalAttribution = [lastTouches[0].player, lastTouches[1].player];
            } else {
                goalAttribution = [lastTouches[0].player, null];
            }
        } else {
            // Own goal
            goalAttribution = [lastTouches[0].player, null];
        }
    }
    return goalAttribution;
}

function getGoalString(team) {
    var goalString;
    var scores = game.scores;
    var goalAttribution = getGoalAttribution(team);
    if (goalAttribution[0] != null) {
        if (goalAttribution[0].team == team) {
            if (goalAttribution[1] != null && goalAttribution[1].team == team) {
                goalString = `⚽ ${getTimeGame(scores.time)} Goal: ${goalAttribution[0].name} · Assist: ${goalAttribution[1].name} · ${ballSpeed.toFixed(2)} km/h`;
                game.goals.push(
                    new Goal(
                        scores.time,
                        team,
                        goalAttribution[0],
                        goalAttribution[1]
                    )
                );
            } else {
                goalString = `⚽ ${getTimeGame(scores.time)} Goal: ${goalAttribution[0].name} · ${ballSpeed.toFixed(2)} km/h`;
                game.goals.push(
                    new Goal(scores.time, team, goalAttribution[0], null)
                );
            }
        } else {
            goalString = `😂 ${getTimeGame(scores.time)} Own goal: ${goalAttribution[0].name} · ${ballSpeed.toFixed(2)} km/h`;
            game.goals.push(
                new Goal(scores.time, team, goalAttribution[0], null)
            );
        }
    } else {
        goalString = `⚽ ${getTimeGame(scores.time)} Goal for ${team == Team.RED ? 'red' : 'blue'} · ${ballSpeed.toFixed(2)} km/h`;
        game.goals.push(
            new Goal(scores.time, team, null, null)
        );
    }

    return goalString;
}

/* ROOM STATS FUNCTIONS */

function emptyFormatStats() {
    return {
        games: 0,
        wins: 0,
        winrate: '0.0%',
        playtime: 0,
        goals: 0,
        assists: 0,
        CS: 0,
        ownGoals: 0,
        elo: ELO_DEFAULT,
    };
}

function newPlayerRecord(playerName) {
    var formats = {};
    for (let f of MATCH_FORMATS) {
        formats[f] = emptyFormatStats();
    }
    return { playerName: playerName, formats: formats, ladderVersion: LADDER_VERSION };
}

function legacyDivisionToNewIndex(divLabel) {
    if (divLabel === 'I') return 2;
    if (divLabel === 'II') return 1;
    return 0;
}

function eloFromCompactDivIndex(divIndex, progress) {
    var start = ELO_LADDER_BASE + divIndex * ELO_DIVISION_SPAN;
    var p = Math.max(0, Math.min(1, progress));
    return Math.round(start + p * Math.max(0, ELO_DIVISION_SPAN - 1));
}

/** Map v1 ladder Elo → v2 while keeping the same tier/division label where possible. */
function migrateLegacyElo(oldElo) {
    var clamped = Math.max(0, Math.floor(oldElo));
    var legacyApexBase = LEGACY_LADDER.divisionCount * LEGACY_LADDER.span;

    if (clamped >= legacyApexBase + 2 * LEGACY_LADDER.apexSpan) {
        return LOL_GRANDMASTER_BASE;
    }
    if (clamped >= legacyApexBase + LEGACY_LADDER.apexSpan) {
        return LOL_GRANDMASTER_BASE;
    }
    if (clamped >= legacyApexBase) {
        return LOL_APEX_BASE;
    }

    var oldDivIndex = Math.min(
        LEGACY_LADDER.divisionCount - 1,
        Math.floor(clamped / LEGACY_LADDER.span)
    );
    var oldTierIndex = Math.floor(oldDivIndex / LEGACY_LADDER.divisions.length);
    var oldDivLabel = LEGACY_LADDER.divisions[oldDivIndex % LEGACY_LADDER.divisions.length];
    var oldDivStart = oldDivIndex * LEGACY_LADDER.span;
    var progress = (clamped - oldDivStart) / LEGACY_LADDER.span;

    var newTierIndex = LEGACY_LADDER.tierToNew[oldTierIndex];
    var newDivIndex = newTierIndex * LOL_DIVISIONS.length + legacyDivisionToNewIndex(oldDivLabel);

    return Math.min(LOL_APEX_BASE - 1, eloFromCompactDivIndex(newDivIndex, progress));
}

function migratePlayerRecordLadder(record) {
    if ((record.ladderVersion ?? 1) >= LADDER_VERSION) return false;
    for (let f of MATCH_FORMATS) {
        var fs = record.formats[f];
        if (fs && fs.games > 0) {
            fs.elo = migrateLegacyElo(fs.elo);
        }
    }
    record.ladderVersion = LADDER_VERSION;
    return true;
}

function migrateAllPlayerLadderRecords() {
    var migrated = 0;
    for (var [key, raw] of localStorage.entries()) {
        if (key.length !== 43) continue;
        if (!raw) continue;
        try {
            var parsed = JSON.parse(raw);
            if (!parsed.formats) continue;
            if (migratePlayerRecordLadder(parsed)) {
                savePlayerRecord(key, parsed);
                migrated++;
            }
        } catch (e) {
            /* skip corrupt rows */
        }
    }
    if (migrated > 0) {
        console.log(`Ladder v${LADDER_VERSION}: migrated ${migrated} player record(s)`);
    }
}

function loadPlayerRecord(auth, playerName) {
    return loadPlayerRecordFromRaw(auth, localStorage.getItem(auth), playerName);
}

function loadPlayerRecordFromRaw(auth, raw, playerName) {
    if (!raw) return newPlayerRecord(playerName);
    try {
        var parsed = JSON.parse(raw);
        if (parsed.formats) {
            for (let f of MATCH_FORMATS) {
                if (!parsed.formats[f]) parsed.formats[f] = emptyFormatStats();
                if (parsed.formats[f].elo === undefined) parsed.formats[f].elo = ELO_DEFAULT;
            }
            if (!parsed.playerName) parsed.playerName = playerName;
            if (migratePlayerRecordLadder(parsed)) {
                savePlayerRecord(auth, parsed);
            }
            return parsed;
        }
        var record = newPlayerRecord(parsed.playerName || playerName);
        if (parsed.games > 0) {
            var legacy = emptyFormatStats();
            for (let k of Object.keys(legacy)) {
                if (parsed[k] !== undefined) legacy[k] = parsed[k];
            }
            record.formats['3x3'] = legacy;
        }
        return record;
    } catch (e) {
        return newPlayerRecord(playerName);
    }
}

function savePlayerRecord(auth, record) {
    localStorage.setItem(auth, JSON.stringify(record));
}

function hasPlayedAnyFormat(record) {
    return MATCH_FORMATS.some((f) => record.formats[f].games > 0);
}

function normalizeFormatArg(arg) {
    if (!arg) return null;
    var a = arg.toLowerCase().replace('v', 'x');
    if (MATCH_FORMATS.includes(a)) return a;
    return null;
}

function formatKeyFromPlayerCounts(redCount, blueCount) {
    var n = Math.min(redCount, blueCount);
    if (redCount !== blueCount || n < 1 || n > 3) return null;
    return `${n}x${n}`;
}

function formatKeyFromTeamSizes() {
    return formatKeyFromPlayerCounts(teamRed.length, teamBlue.length);
}

/** Next/target format from lobby headcount — not the live game size. */
function getLobbyMatchFormat() {
    var e = getTargetSideSize();
    if (e <= 1) return '1x1';
    if (e === 2) return '2x2';
    if (e >= 3) return '3x3';
    return null;
}

/** Format for rank chat/stats default: on-field players use live game, specs use lobby target. */
function getPlayerMatchFormat(player) {
    if (
        gameState !== State.STOP &&
        currentMatchFormat &&
        player &&
        (player.team === Team.RED || player.team === Team.BLUE)
    ) {
        return currentMatchFormat;
    }
    return getLobbyMatchFormat() || currentMatchFormat || '2x2';
}

function getFormatElo(record, format) {
    return record.formats[format]?.elo ?? ELO_DEFAULT;
}

function buildLolRank(tier, division, elo, tierIndex) {
    var tierName = division ? `${tier.name} ${division}` : tier.name;
    return {
        unranked: false,
        label: `${tier.emoji} ${tierName}`,
        short: tierName,
        emoji: tier.emoji,
        tierName,
        division,
        color: tier.color,
        tierIndex,
    };
}

function ladderDivIndex(elo) {
    return Math.max(
        0,
        Math.min(
            LOL_DIVISION_COUNT - 1,
            Math.floor((Math.max(0, elo) - ELO_LADDER_BASE) / ELO_DIVISION_SPAN)
        )
    );
}

function parseStoredPlayerRecord(raw) {
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/** GM+ candidate pools per format, kept in memory so post-match updates never rescan the DB. */
var challengerCandidatesByFormat = Object.fromEntries(MATCH_FORMATS.map((f) => [f, new Map()]));

function challengerCandidateEntry(format, record) {
    var fs = record?.formats?.[format];
    if (!fs || fs.games < ELO_PLACEMENT_GAMES) return null;
    var elo = fs.elo ?? ELO_DEFAULT;
    if (elo < LOL_GRANDMASTER_BASE) return null;
    return elo;
}

function recomputeChallengerSet(format) {
    var candidates = [...challengerCandidatesByFormat[format]].map(([auth, elo]) => ({ auth, elo }));
    candidates.sort((a, b) => b.elo - a.elo || a.auth.localeCompare(b.auth));
    var next = new Set();
    for (let j = 0; j < Math.min(CHALLENGER_SLOTS_PER_FORMAT, candidates.length); j++) {
        next.add(candidates[j].auth);
    }
    challengerAuthsByFormat[format] = next;
}

/** Startup only: single full pass over all records. */
function rebuildChallengerSets() {
    for (let f of MATCH_FORMATS) challengerCandidatesByFormat[f] = new Map();
    for (var [auth, raw] of localStorage.entries()) {
        if (auth.length !== 43) continue;
        var record = parseStoredPlayerRecord(raw);
        if (!record) continue;
        for (let f of MATCH_FORMATS) {
            var elo = challengerCandidateEntry(f, record);
            if (elo != null) challengerCandidatesByFormat[f].set(auth, elo);
        }
    }
    for (let f of MATCH_FORMATS) recomputeChallengerSet(f);
}

/** Post-match: only touched records can change the top-3 — no DB scan. */
function updateChallengerSetsForRecords(format, recordByAuth) {
    var pool = challengerCandidatesByFormat[format];
    for (let entry of recordByAuth.values()) {
        var elo = challengerCandidateEntry(format, entry.record);
        if (elo != null) pool.set(entry.auth, elo);
        else pool.delete(entry.auth);
    }
    recomputeChallengerSet(format);
}

function isChallengerAuth(format, auth) {
    return Boolean(format && auth && challengerAuthsByFormat[format]?.has(auth));
}

function getEloRank(elo, options = {}) {
    var format = options.format ?? null;
    var auth = options.auth ?? null;
    var clamped = Math.max(0, Math.floor(elo));
    if (format && auth && clamped >= LOL_GRANDMASTER_BASE && isChallengerAuth(format, auth)) {
        return buildLolRank(LOL_APEX[2], null, clamped, 0);
    }
    if (clamped >= LOL_GRANDMASTER_BASE) {
        return buildLolRank(LOL_APEX[1], null, clamped, 1);
    }
    if (clamped >= LOL_APEX_BASE) {
        return buildLolRank(LOL_APEX[0], null, clamped, 2);
    }
    var divIndex = ladderDivIndex(clamped);
    var tier = LOL_TIERS[Math.floor(divIndex / LOL_DIVISIONS.length)];
    var division = LOL_DIVISIONS[divIndex % LOL_DIVISIONS.length];
    return buildLolRank(tier, division, clamped, LOL_DIVISION_COUNT - 1 - divIndex + LOL_APEX.length);
}

function formatRankPrefix(rank, elo) {
    if (rank.unranked) return `[${rank.emoji} Unranked • ${ELO_DEFAULT}]`;
    return `[${rank.emoji} ${rank.tierName} • ${elo}]`;
}

function formatRankDisplay(rank, elo) {
    if (rank.unranked) return `${rank.emoji} Unranked · starts at ${ELO_DEFAULT} Elo`;
    return `${rank.emoji} ${rank.tierName} · ${elo} Elo`;
}

function formatEloDelta(delta) {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `${delta}`;
    return '±0';
}

function getNextRankProgress(elo, options = {}) {
    var format = options.format ?? null;
    var auth = options.auth ?? null;
    var clamped = Math.max(0, Math.floor(elo));
    if (isChallengerAuth(format, auth)) return null;
    if (clamped >= LOL_GRANDMASTER_BASE) {
        return { challengerOnly: true };
    }
    var nextBoundary;
    if (clamped >= LOL_APEX_BASE) {
        nextBoundary = LOL_GRANDMASTER_BASE;
    } else {
        var divIndex = ladderDivIndex(clamped);
        nextBoundary =
            divIndex >= LOL_DIVISION_COUNT - 1
                ? LOL_APEX_BASE
                : ELO_LADDER_BASE + (divIndex + 1) * ELO_DIVISION_SPAN;
    }
    var needed = nextBoundary - clamped;
    if (needed <= 0) return null;
    return { needed, next: getEloRank(nextBoundary, options) };
}

function formatProgressHint(elo, options = {}) {
    var progress = getNextRankProgress(elo, options);
    if (!progress) return '🏆 Top rank — keep winning';
    if (progress.challengerOnly) {
        return `👑 Top ${CHALLENGER_SLOTS_PER_FORMAT} on ${options.format || 'format'} board for Challenger`;
    }
    return `⬆ ${progress.needed} Elo to ${progress.next.emoji} ${progress.next.tierName}`;
}

function formatPlayerElo(record, format, auth = null) {
    var fs = record.formats[format];
    if (!fs || fs.games < 1) return formatRankDisplay(ELO_UNRANKED, ELO_DEFAULT);
    var elo = getFormatElo(record, format);
    return formatRankDisplay(getEloRank(elo, { format, auth }), elo);
}

function getEloRankTierIndex(elo, options = {}) {
    return getEloRank(elo, options).tierIndex;
}

function getPlayerRankForFormat(player, format, preloadedRecord = null) {
    var auth = authArray[player.id]?.[0];
    if (!auth) return ELO_UNRANKED;
    var record = preloadedRecord ?? loadPlayerRecord(auth, player.name);
    var fs = record.formats[format];
    if (!fs || fs.games < 1) return ELO_UNRANKED;
    return getEloRank(getFormatElo(record, format), { format, auth });
}

function getPlayerRankForLobby(player, preloadedRecord = null) {
    return getPlayerRankForFormat(player, getPlayerMatchFormat(player), preloadedRecord);
}

function getRankChatPrefix(player, preloadedRecord = null) {
    var format = getPlayerMatchFormat(player);
    var auth = authArray[player.id]?.[0];
    if (!auth) return formatRankPrefix(ELO_UNRANKED, ELO_DEFAULT);
    var record = preloadedRecord ?? loadPlayerRecord(auth, player.name);
    var fs = record.formats[format];
    if (!fs || fs.games < 1) return formatRankPrefix(ELO_UNRANKED, ELO_DEFAULT);
    var elo = getFormatElo(record, format);
    return formatRankPrefix(getEloRank(elo, { format, auth }), elo);
}

function getRankChatName(player, preloadedRecord = null) {
    return `${getRankChatPrefix(player, preloadedRecord)} ${player.name}`;
}

function getPublicChatColor(player, preloadedRecord = null) {
    return getPlayerRankForLobby(player, preloadedRecord).color ?? defaultColor;
}

function loadPlayerRecordFor(player) {
    var auth = authArray[player.id]?.[0];
    return auth ? loadPlayerRecord(auth, player.name) : null;
}

function broadcastPublicChat(player, message) {
    var record = loadPlayerRecordFor(player);
    room.sendAnnouncement(
        `${getRankChatName(player, record)}: ${message}`,
        null,
        getPublicChatColor(player, record),
        null,
        HaxNotification.CHAT
    );
}

function announcePlayerJoin(player, preloadedRecord = null) {
    var auth = authArray[player.id][0];
    var format = getPlayerMatchFormat(player);
    var record = preloadedRecord ?? loadPlayerRecord(auth, player.name);
    room.sendAnnouncement(
        `➡️ ${getRankChatName(player, record)} joined (${format})\n` +
            `   ${formatPlayerElo(record, format, auth)}`,
        null,
        welcomeColor,
        null,
        HaxNotification.CHAT
    );
}

/** hax-standard-elo win-probability helper (individual vs enemy team average). */
function haxStandardEloP1(elo, enemyTeamElo) {
    return 1 / (1 + Math.pow(10, (elo - enemyTeamElo) / 400));
}

function isRankedGameComplete() {
    if (!endGameVariable) return false;
    const scores = game.scores;
    // Forfeit eligibility was validated when the flag was set; game state is torn down by now.
    if (rankedForfeit) return true;
    return (
        (scores.timeLimit != 0 && scores.time >= (5 / 6) * scores.timeLimit) ||
        (scores.scoreLimit != 0 &&
            (scores.red == scores.scoreLimit || scores.blue == scores.scoreLimit)) ||
        (scores.timeLimit == 0 && scores.scoreLimit == 0 && scores.time > 0)
    );
}

function averageTeamEloFromRecords(players, format, recordByAuth) {
    var sum = 0;
    var count = 0;
    for (let player of players) {
        var auth = getPlayerAuth(player);
        if (!auth || !recordByAuth.has(auth)) continue;
        sum += getFormatElo(recordByAuth.get(auth).record, format);
        count++;
    }
    return count > 0 ? sum / count : ELO_DEFAULT;
}

function eloTrustFactorFromRecords(players, format, recordByAuth) {
    if (players.length < 1) return 1;
    var sum = 0;
    for (let player of players) {
        var auth = getPlayerAuth(player);
        if (!auth || !recordByAuth.has(auth)) continue;
        var games = recordByAuth.get(auth).record.formats[format].games;
        sum += Math.min(1, games / ELO_PLACEMENT_GAMES);
    }
    return sum / players.length;
}

function captureCleanSheetAuths(scores) {
    var auths = [];
    if (scores == null) return auths;
    var redGK = getGK(Team.RED);
    var blueGK = getGK(Team.BLUE);
    if (redGK != null && scores.blue === 0) auths.push(redGK.auth);
    if (blueGK != null && scores.red === 0) auths.push(blueGK.auth);
    return auths;
}

function emptyPlayerMatchStats() {
    return { goals: 0, assists: 0, ownGoals: 0, playtime: 0 };
}

/** Per-auth match totals frozen at whistle (goals/assists/playtime defer-safe). */
function capturePlayerStatsMap(matchTime) {
    var map = {};
    if (!game?.playerComp) return map;
    function capture(pComp) {
        if (pComp == null || !pComp.auth) return;
        map[pComp.auth] = {
            goals: getGoalsPlayer(pComp),
            assists: getAssistsPlayer(pComp),
            ownGoals: getOwnGoalsPlayer(pComp),
            playtime: getGametimePlayer(pComp, matchTime),
        };
    }
    for (let pComp of game.playerComp[0]) capture(pComp);
    for (let pComp of game.playerComp[1]) capture(pComp);
    return map;
}

function captureRankedStatsSnapshot() {
    if (!isRankedGameComplete()) return null;
    var redPlayers = getStatsRoster(Team.RED, teamRedStats);
    var bluePlayers = getStatsRoster(Team.BLUE, teamBlueStats);
    if (redPlayers.length < 1 && bluePlayers.length < 1) return null;
    var matchFormat = currentMatchFormat ||
        formatKeyFromPlayerCounts(redPlayers.length, bluePlayers.length);
    if (!matchFormat) return null;
    var scores = game.scores;
    var matchTime = scores?.time ?? 0;
    var redConnByAuth = captureConnByAuth(redPlayers);
    var blueConnByAuth = captureConnByAuth(bluePlayers);
    return {
        redPlayers,
        bluePlayers,
        matchFormat,
        rankedForfeit,
        forfeitAuth,
        forfeitReason,
        lastWinner,
        formatBrokenMatch,
        matchLeavers: matchLeavers.map((l) => ({ ...l })),
        cleanSheetAuths: captureCleanSheetAuths(scores),
        playerStatsByAuth: capturePlayerStatsMap(matchTime),
        redConnByAuth,
        blueConnByAuth,
        crossTeamSameConn: hasCrossTeamSameConnFromSnapshot(redConnByAuth, blueConnByAuth),
    };
}

function scheduleRankedStats() {
    var snapshot = captureRankedStatsSnapshot();
    if (!snapshot) return;
    setTimeout(() => applyRankedStats(snapshot), 0);
}

/**
 * One load + one save per player. Deferred off the game tick so match I/O does not hitch ping.
 * Anti-alt Elo: provisional K×2, trust dampening, forfeit scaling, floor 0.
 */
function applyRankedStats(snapshot) {
    var redPlayers = snapshot.redPlayers;
    var bluePlayers = snapshot.bluePlayers;
    var matchFormat = snapshot.matchFormat;
    var recordByAuth = new Map();

    function getEntry(player) {
        var auth = getPlayerAuth(player);
        if (!auth) return null;
        if (!recordByAuth.has(auth)) {
            var record = loadPlayerRecord(auth, player.name);
            recordByAuth.set(auth, {
                auth,
                record,
                placedNow: record.formats[matchFormat].games === 0,
            });
        }
        return recordByAuth.get(auth);
    }

    function saveAllRecords() {
        for (let entry of recordByAuth.values()) {
            savePlayerRecord(entry.auth, entry.record);
        }
    }

    for (let player of redPlayers) {
        var entry = getEntry(player);
        if (!entry) continue;
        entry.record.playerName = entry.record.playerName || player.name;
        var playerStats = snapshot.playerStatsByAuth[entry.auth] || emptyPlayerMatchStats();
        applyGameToFormatStats(entry.record.formats[matchFormat], Team.RED, entry.auth, playerStats, snapshot);
    }
    for (let player of bluePlayers) {
        var entry = getEntry(player);
        if (!entry) continue;
        entry.record.playerName = entry.record.playerName || player.name;
        var playerStats = snapshot.playerStatsByAuth[entry.auth] || emptyPlayerMatchStats();
        applyGameToFormatStats(entry.record.formats[matchFormat], Team.BLUE, entry.auth, playerStats, snapshot);
    }

    creditOrphanMatchStats(snapshot, matchFormat, redPlayers, bluePlayers, recordByAuth);

    if (!debugMode && snapshot.crossTeamSameConn) {
        saveAllRecords();
        room.sendAnnouncement(
            '⚠ Unranked match — same network on both teams. Elo unchanged.',
            null,
            warningColor,
            FONT_FORMAT.bold,
            HaxNotification.CHAT
        );
        return;
    }

    var eloChanges = [];
    if (snapshot.formatBrokenMatch && snapshot.matchLeavers.length > 0) {
        var redElo = averageTeamEloFromRecords(redPlayers, matchFormat, recordByAuth);
        var blueElo = averageTeamEloFromRecords(bluePlayers, matchFormat, recordByAuth);
        for (let leaver of snapshot.matchLeavers) {
            if (recordByAuth.has(leaver.auth)) continue;
            var record = loadPlayerRecord(leaver.auth, leaver.name);
            record.playerName = record.playerName || leaver.name;
            var fs = record.formats[matchFormat];
            var placedNow = fs.games === 0;
            fs.games++;
            fs.winrate = ((100 * fs.wins) / (fs.games || 1)).toFixed(1) + `%`;
            var elo = getFormatElo(record, matchFormat);
            var rankOpts = { format: matchFormat, auth: leaver.auth };
            var oldRank = getEloRank(elo, rankOpts);
            var oldTier = getEloRankTierIndex(elo, rankOpts);
            var enemyElo = leaver.team === Team.RED ? blueElo : redElo;
            var provisional = fs.games <= ELO_PLACEMENT_GAMES;
            var k = provisional ? ELO_K * 2 : ELO_K;
            var p1 = haxStandardEloP1(elo, enemyElo);
            var delta = Math.round(-k * (1 - p1) * ELO_FORFEIT_LEAVER_MULT);
            var newElo = Math.max(0, elo + delta);
            delta = newElo - elo;
            fs.elo = newElo;
            recordByAuth.set(leaver.auth, { auth: leaver.auth, record, placedNow });
            eloChanges.push({
                auth: leaver.auth,
                name: leaver.name,
                delta,
                oldRank,
                newElo,
                oldTier,
                placedNow,
                rageQuit: true,
            });
        }
        saveAllRecords();
        finalizeRankedEloChanges(eloChanges, matchFormat, recordByAuth);
        announceRankedResults(eloChanges, matchFormat, snapshot.forfeitReason, { survivorsUnchanged: true });
        return;
    }

    if (snapshot.lastWinner !== Team.SPECTATORS) {
        var winnerIsRed = snapshot.lastWinner === Team.RED;
        var winners = winnerIsRed ? redPlayers : bluePlayers;
        var losers = winnerIsRed ? bluePlayers : redPlayers;
        if (winners.length > 0 && losers.length > 0) {
            var winnerTeamElo = averageTeamEloFromRecords(winners, matchFormat, recordByAuth);
            var loserTeamElo = averageTeamEloFromRecords(losers, matchFormat, recordByAuth);
            var winnerTrust = eloTrustFactorFromRecords(winners, matchFormat, recordByAuth);
            var loserTrust = eloTrustFactorFromRecords(losers, matchFormat, recordByAuth);

            function applyEloChange(player, won) {
                var entry = getEntry(player);
                if (!entry) return;
                var record = entry.record;
                var fs = record.formats[matchFormat];
                var elo = getFormatElo(record, matchFormat);
                var rankOpts = { format: matchFormat, auth: entry.auth };
                var oldRank = getEloRank(elo, rankOpts);
                var oldTier = getEloRankTierIndex(elo, rankOpts);
                var provisional = fs.games <= ELO_PLACEMENT_GAMES;
                var k = provisional ? ELO_K * 2 : ELO_K;
                var enemyTrust = won ? loserTrust : winnerTrust;
                var scale = provisional ? 1 : Math.max(ELO_TRUST_FLOOR, enemyTrust);
                var rageQuit = !won && snapshot.forfeitAuth != null && entry.auth === snapshot.forfeitAuth;
                if (snapshot.rankedForfeit) {
                    scale *= rageQuit ? ELO_FORFEIT_LEAVER_MULT : ELO_FORFEIT_WINNER_MULT;
                }
                var p1 = haxStandardEloP1(elo, won ? loserTeamElo : winnerTeamElo);
                var raw = won ? k * p1 : -k * (1 - p1);
                var delta = Math.round(raw * scale);
                var newElo = Math.max(0, elo + delta);
                delta = newElo - elo;
                fs.elo = newElo;
                eloChanges.push({
                    auth: entry.auth,
                    name: player.name,
                    delta,
                    oldRank,
                    newElo,
                    oldTier,
                    placedNow: entry.placedNow,
                    rageQuit,
                });
            }

            for (let player of losers) applyEloChange(player, false);
            for (let player of winners) applyEloChange(player, true);
        }
    }

    saveAllRecords();
    finalizeRankedEloChanges(eloChanges, matchFormat, recordByAuth);
    announceRankedResults(eloChanges, matchFormat, snapshot.forfeitReason);
}

function finalizeRankedEloChanges(changes, format, recordByAuth) {
    updateChallengerSetsForRecords(format, recordByAuth);
    for (let c of changes) {
        if (!c.auth) continue;
        c.newRank = getEloRank(c.newElo, { format, auth: c.auth });
        c.newTier = c.newRank.tierIndex;
    }
}

function formatRankChangeTag(change) {
    if (change.placedNow) return ' · 🎖 placed';
    if (
        change.delta > 0 &&
        change.oldRank.tierName !== change.newRank.tierName &&
        change.newTier < change.oldTier
    ) {
        return ` · 🎉 ${change.oldRank.tierName} → ${change.newRank.tierName}`;
    }
    return '';
}

/** Single end-of-match Elo summary — deltas, ranks, promos/placements inline. */
function announceRankedResults(changes, format, forfeitReasonLabel, options = {}) {
    if (changes.length < 1 && !options.survivorsUnchanged) return;
    var reason = forfeitReasonLabel ?? forfeitReason;
    var lines = [`📊 ${format} Elo`];
    if (options.survivorsUnchanged) lines.push('On-field: no change');
    var sorted = [...changes].sort((a, b) => b.delta - a.delta);
    for (let c of sorted) {
        var forfeitTag = c.rageQuit
            ? (reason === 'AFK'
                ? ` · ~${ELO_FORFEIT_LEAVER_MULT.toFixed(1)}× AFK`
                : ` · ~${ELO_FORFEIT_LEAVER_MULT.toFixed(1)}× leave`)
            : '';
        lines.push(
            `${c.name}  ${formatEloDelta(c.delta)}  →  ${formatRankDisplay(c.newRank, c.newElo)}` +
            `${formatRankChangeTag(c)}${forfeitTag}`
        );
    }
    room.sendAnnouncement(
        lines.join('\n'),
        null,
        announcementColor,
        null,
        HaxNotification.NONE
    );
}

function applyGameToFormatStats(formatStats, teamStats, auth, playerStats, snapshot) {
    formatStats.games++;
    if (snapshot.lastWinner == teamStats) formatStats.wins++;
    formatStats.winrate = ((100 * formatStats.wins) / (formatStats.games || 1)).toFixed(1) + `%`;
    formatStats.goals += playerStats.goals;
    formatStats.assists += playerStats.assists;
    formatStats.ownGoals += playerStats.ownGoals;
    formatStats.CS += snapshot.cleanSheetAuths.includes(auth) ? 1 : 0;
    formatStats.playtime += playerStats.playtime;
}

/** Sub / leaver with match stats but not on kickoff roster — credit stats without games++. */
function creditOrphanMatchStats(snapshot, matchFormat, redPlayers, bluePlayers, recordByAuth) {
    var rosterAuths = new Set();
    for (let player of redPlayers) {
        var auth = getPlayerAuth(player);
        if (auth) rosterAuths.add(auth);
    }
    for (let player of bluePlayers) {
        var auth = getPlayerAuth(player);
        if (auth) rosterAuths.add(auth);
    }
    for (let auth of Object.keys(snapshot.playerStatsByAuth)) {
        if (rosterAuths.has(auth)) continue;
        var playerStats = snapshot.playerStatsByAuth[auth];
        var hasStats = playerStats.goals > 0 || playerStats.assists > 0 ||
            playerStats.ownGoals > 0 || playerStats.playtime > 0;
        var hasCS = snapshot.cleanSheetAuths.includes(auth);
        if (!hasStats && !hasCS) continue;
        if (!recordByAuth.has(auth)) {
            var record = loadPlayerRecord(auth, '');
            recordByAuth.set(auth, {
                auth,
                record,
                placedNow: record.formats[matchFormat].games === 0,
            });
        }
        var fs = recordByAuth.get(auth).record.formats[matchFormat];
        fs.goals += playerStats.goals;
        fs.assists += playerStats.assists;
        fs.ownGoals += playerStats.ownGoals;
        fs.playtime += playerStats.playtime;
        if (hasCS) fs.CS += 1;
    }
}

/** Conn for roster player — auth must match slot (avoids recycled player.id false positives). */
function resolvePlayerConn(player) {
    var auth = getPlayerAuth(player);
    if (!auth) return null;
    var row = authArray[player.id];
    if (row && row[0] === auth && row[1]) {
        return { auth, conn: row[1] };
    }
    if (game?.compIndex) {
        var comp = game.compIndex.get(auth);
        if (comp?.player) {
            row = authArray[comp.player.id];
            if (row && row[0] === auth && row[1]) {
                return { auth, conn: row[1] };
            }
        }
    }
    if (player.conn) {
        return { auth, conn: player.conn };
    }
    return null;
}

function captureConnByAuth(players) {
    var map = {};
    for (let p of players) {
        var resolved = resolvePlayerConn(p);
        if (resolved) map[resolved.auth] = resolved.conn;
    }
    return map;
}

/** Same connection on red and blue rosters ⇒ likely alt on one network. Same-team shared WiFi OK. */
function hasCrossTeamSameConnFromSnapshot(redConnByAuth, blueConnByAuth) {
    var redConns = new Set(Object.values(redConnByAuth));
    for (let conn of Object.values(blueConnByAuth)) {
        if (conn && redConns.has(conn)) return true;
    }
    return false;
}

/** Kickoff roster, or game compositions if arrays were cleared mid-rearrange. */
function getStatsRoster(team, storedRoster) {
    if (storedRoster.length > 0) return storedRoster;
    if (!game?.playerComp) return [];
    var comps = team === Team.RED ? game.playerComp[0] : game.playerComp[1];
    return comps.map((c) => c.player).filter((p) => p != null);
}

function getRecordStatValue(record, statKey, formatFilter) {
    statKey = statKey == 'cs' ? 'CS' : statKey;
    if (formatFilter) {
        return record.formats[formatFilter][statKey] ?? 0;
    }
    if (statKey === 'elo') {
        return 0;
    }
    var total = 0;
    for (let f of MATCH_FORMATS) {
        total += record.formats[f][statKey] ?? 0;
    }
    return total;
}

function hasFormatStat(record, statKey, formatFilter) {
    if (!formatFilter) return hasPlayedAnyFormat(record);
    var fs = record.formats[formatFilter];
    if (statKey === 'elo') return fs.games > 0;
    if (statKey === 'games') return fs.games > 0;
    return (fs[statKey] ?? 0) > 0;
}

function printRankings(statKey, id = 0, formatFilter = null) {
    var leaderboard = [];
    statKey = statKey == 'cs' ? 'CS' : statKey;
    if (statKey === 'elo' && !formatFilter) formatFilter = getLobbyMatchFormat();
    for (var [key, raw] of localStorage.entries()) {
        if (key.length == 43) {
            var record = loadPlayerRecordFromRaw(key, raw, '');
            if (statKey === 'elo' && !formatFilter) continue;
            if (statKey === 'elo' && record.formats[formatFilter].games < ELO_PLACEMENT_GAMES) continue;
            if (!hasFormatStat(record, statKey, formatFilter)) continue;
            var value = getRecordStatValue(record, statKey, formatFilter);
            if (value > 0 || (statKey === 'games' && hasPlayedAnyFormat(record))) {
                if (statKey === 'elo') {
                    leaderboard.push({ name: record.playerName, value, auth: key });
                } else {
                    leaderboard.push([record.playerName, value]);
                }
            }
        }
    }
    if (leaderboard.length < 1) {
        if (id != 0) {
            room.sendAnnouncement(
                formatFilter
                    ? statKey === 'elo'
                        ? `No ${formatFilter} ranked players yet.\nElo board needs ${ELO_PLACEMENT_GAMES}+ games.`
                        : `No ${formatFilter} stats yet.\nPlay a full match to appear here.`
                    : 'Not enough games yet.',
                id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
        return;
    }
    leaderboard.sort(function (a, b) {
        var av = a.value ?? a[1];
        var bv = b.value ?? b[1];
        return bv - av;
    });
    var statLabels = {
        elo: 'Elo',
        wins: 'Wins',
        goals: 'Goals',
        assists: 'Assists',
        cs: 'Clean sheets',
        playtime: 'Play time',
        games: 'Games',
    };
    var label = statLabels[statKey] || statKey.charAt(0).toUpperCase() + statKey.slice(1);
    if (formatFilter) label += ` · ${formatFilter}`;
    var limit = Math.min(5, leaderboard.length);
    var lines = [`── ${label} top ${limit} ──`];
    for (let i = 0; i < limit; i++) {
        let entry = leaderboard[i];
        let playerName = entry.name ?? entry[0];
        let playerStat = entry.value ?? entry[1];
        if (statKey == 'playtime') playerStat = getTimeStats(playerStat);
        if (statKey === 'elo') {
            var rank = getEloRank(playerStat, { format: formatFilter, auth: entry.auth });
            lines.push(`${rankMedal(i)} ${playerName}`);
            lines.push(`   ${formatRankDisplay(rank, playerStat)}`);
        } else {
            lines.push(`${rankMedal(i)} ${playerName} — ${playerStat}`);
        }
    }
    lines.push(`💡 ${LEADERBOARD_TOP_HINT}`);
    room.sendAnnouncement(
        lines.join('\n'),
        id,
        infoColor,
        null,
        HaxNotification.CHAT
    );
}

function printFormatTop(formatFilter, id = 0) {
    var leaderboard = [];
    for (var [key, raw] of localStorage.entries()) {
        if (key.length == 43) {
            var record = loadPlayerRecordFromRaw(key, raw, '');
            var fs = record.formats[formatFilter];
            if (fs.games > 0) {
                leaderboard.push({
                    name: record.playerName,
                    wins: fs.wins,
                    games: fs.games,
                    winrate: fs.winrate,
                    goals: fs.goals,
                });
            }
        }
    }
    if (leaderboard.length == 0) {
        if (id != 0) {
            room.sendAnnouncement(
                `No ${formatFilter} games yet. Play to join board!\n${LEADERBOARD_TOP_HINT}`,
                id,
                infoColor,
                null,
                HaxNotification.CHAT
            );
        }
        return;
    }
    leaderboard.sort(function (a, b) {
        return b.wins - a.wins || b.games - a.games || b.goals - a.goals;
    });
    var limit = Math.min(5, leaderboard.length);
    var lines = [`── ${formatFilter} wins top ${limit} ──`];
    for (let i = 0; i < limit; i++) {
        var e = leaderboard[i];
        var losses = e.games - e.wins;
        lines.push(`${rankMedal(i)} ${e.name}`);
        lines.push(`   ${e.wins}W - ${losses}L (${e.winrate})  ·  ${e.goals} goals`);
    }
    lines.push(`💡 ${LEADERBOARD_TOP_HINT}`);
    room.sendAnnouncement(
        lines.join('\n'),
        id,
        infoColor,
        null,
        HaxNotification.CHAT
    );
}

/* GET STATS FUNCTIONS */

function getGamePlayerStats(player) {
    var stats = new HaxStatistics(player.name);
    var pComp = getPlayerComp(player);
    stats.goals += getGoalsPlayer(pComp);
    stats.assists += getAssistsPlayer(pComp);
    stats.ownGoals += getOwnGoalsPlayer(pComp);
    stats.playtime += getGametimePlayer(pComp);
    stats.CS += getCSPlayer(pComp);
    return stats;
}

function getGametimePlayer(pComp, matchTime) {
    if (pComp == null) return 0;
    var endTime = matchTime ?? game.scores?.time ?? 0;
    var timePlayer = 0;
    for (let j = 0; j < pComp.timeEntry.length; j++) {
        if (pComp.timeExit.length < j + 1) {
            timePlayer += endTime - pComp.timeEntry[j];
        } else {
            timePlayer += pComp.timeExit[j] - pComp.timeEntry[j];
        }
    }
    return Math.floor(timePlayer);
}

function getGoalsPlayer(pComp) {
    if (pComp == null) return 0;
    var goalPlayer = 0;
    for (let goal of game.goals) {
        if (goal.striker != null && goal.team === pComp.player.team) {
            if (authArray[goal.striker.id][0] == pComp.auth) {
                goalPlayer++;
            }
        }
    }
    return goalPlayer;
}

function getOwnGoalsPlayer(pComp) {
    if (pComp == null) return 0;
    var goalPlayer = 0;
    for (let goal of game.goals) {
        if (goal.striker != null && goal.team !== pComp.player.team) {
            if (authArray[goal.striker.id][0] == pComp.auth) {
                goalPlayer++;
            }
        }
    }
    return goalPlayer;
}

function getAssistsPlayer(pComp) {
    if (pComp == null) return 0;
    var assistPlayer = 0;
    for (let goal of game.goals) {
        if (goal.assist != null) {
            if (authArray[goal.assist.id][0] == pComp.auth) {
                assistPlayer++;
            }
        }
    }
    return assistPlayer;
}

function getGKPlayer(pComp) {
    if (pComp == null) return 0;
    let GKRed = getGK(Team.RED);
    if (pComp.auth == GKRed?.auth) {
        return Team.RED;
    }
    let GKBlue = getGK(Team.BLUE);
    if (pComp.auth == GKBlue?.auth) {
        return Team.BLUE;
    }
    return Team.SPECTATORS;
}

function getCSPlayer(pComp, cleanSheetAuths) {
    if (pComp == null) return 0;
    if (cleanSheetAuths) {
        return cleanSheetAuths.includes(pComp.auth) ? 1 : 0;
    }
    if (game.scores == null) return 0;
    if (getGKPlayer(pComp) == Team.RED && game.scores.blue == 0) {
        return 1;
    } else if (getGKPlayer(pComp) == Team.BLUE && game.scores.red == 0) {
        return 1;
    }
    return 0;
}

function actionReportCountTeam(goals, team) {
    let playerActionSummaryTeam = [];
    let indexTeam = team == Team.RED ? 0 : 1;
    let indexOtherTeam = team == Team.RED ? 1 : 0;
    for (let goal of goals[indexTeam]) {
        if (goal[0] != null) {
            if (playerActionSummaryTeam.find(a => a[0].id == goal[0].id)) {
                let index = playerActionSummaryTeam.findIndex(a => a[0].id == goal[0].id);
                playerActionSummaryTeam[index][1]++;
            } else {
                playerActionSummaryTeam.push([goal[0], 1, 0, 0]);
            }
            if (goal[1] != null) {
                if (playerActionSummaryTeam.find(a => a[0].id == goal[1].id)) {
                    let index = playerActionSummaryTeam.findIndex(a => a[0].id == goal[1].id);
                    playerActionSummaryTeam[index][2]++;
                } else {
                    playerActionSummaryTeam.push([goal[1], 0, 1, 0]);
                }
            }
        }
    }
    if (goals[indexOtherTeam].length == 0) {
        let playerCS = getGK(team)?.player;
        if (playerCS != null) {
            if (playerActionSummaryTeam.find(a => a[0].id == playerCS.id)) {
                let index = playerActionSummaryTeam.findIndex(a => a[0].id == playerCS.id);
                playerActionSummaryTeam[index][3]++;
            } else {
                playerActionSummaryTeam.push([playerCS, 0, 0, 1]);
            }
        }
    }

    playerActionSummaryTeam.sort((a, b) => (a[1] + a[2] + a[3]) - (b[1] + b[2] + b[3]));
    return playerActionSummaryTeam;
}

/* PRINT FUNCTIONS */

function rankMedal(placeIndex) {
    return ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][placeIndex] || `#${placeIndex + 1}`;
}

function sendJoinWelcome(player, preloadedRecord = null) {
    var auth = authArray[player.id][0];
    var record = preloadedRecord ?? loadPlayerRecord(auth, player.name);
    var lobbyFormat = getPlayerMatchFormat(player);
    var rankLine = lobbyFormat
        ? formatPlayerElo(record, lobbyFormat, auth)
        : 'Rank follows lobby size (1v1 / 2v2 / 3v3)';
    room.sendAnnouncement(
        `👋 Welcome, ${player.name}!\n\n` +
            `Your ${lobbyFormat || 'current'} rank\n` +
            `${rankLine}\n\n` +
            `Chat shows [Rank • Elo] before your name\n` +
            `Team chat: t message\n` +
            `Private: @@nick message\n\n` +
            `!stats  !elo  !ranks  !top 2v2\n` +
            `!rename — leaderboard name`,
        player.id,
        welcomeColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
}

function sendLiveMatchSpecNotice(player) {
    if (gameState === State.STOP) return;
    updateTeams();
    if (player.team !== Team.SPECTATORS) return;
    room.sendAnnouncement(
        '⚽ Match in progress — hang tight.\nRoom auto-picks 1v1 / 2v2 / 3v3 by player count.',
        player.id,
        redColor,
        FONT_FORMAT.bold,
        HaxNotification.CHAT
    );
}

function printFormatStatsBlock(formatStats) {
    var statsString = '';
    for (let [key, value] of Object.entries(formatStats)) {
        if (key === 'elo') continue;
        if (key == 'playtime') value = getTimeStats(value);
        let reCamelCase = /([A-Z](?=[a-z]+)|[A-Z]+(?![a-z]))/g;
        let statName = key.replaceAll(reCamelCase, ' $1').trim();
        statsString += `${statName.charAt(0).toUpperCase() + statName.slice(1)}: ${value}, `;
    }
    return statsString.substring(0, statsString.length - 2);
}

function printPlayerRecord(record, formatFilter = null, auth = null) {
    if (formatFilter) {
        var fs = record.formats[formatFilter];
        var elo = getFormatElo(record, formatFilter);
        var rankOpts = { format: formatFilter, auth };
        var rank = fs.games < 1 ? ELO_UNRANKED : getEloRank(elo, rankOpts);
        if (fs.games < 1) {
            return (
                `── ${record.playerName} · ${formatFilter} ──\n\n` +
                `Rank   ${formatPlayerElo(record, formatFilter, auth)}\n\n` +
                `No counted games in this format yet.\n` +
                `Play a full match to get placed.\n\n` +
                `💡 ${LEADERBOARD_TOP_HINT}`
            );
        }
        var losses = fs.games - fs.wins;
        return (
            `── ${record.playerName} · ${formatFilter} ──\n\n` +
            `Rank     ${formatRankDisplay(rank, elo)}\n` +
            `Record   ${fs.wins}W - ${losses}L (${fs.winrate})\n` +
            `Goals    ${fs.goals}  ·  Assists ${fs.assists}  ·  CS ${fs.CS}\n` +
            `${formatProgressHint(elo, rankOpts)}\n\n` +
            `💡 ${LEADERBOARD_TOP_HINT}`
        );
    }
    var lines = [`── ${record.playerName} ──`, ''];
    for (let f of MATCH_FORMATS) {
        var fmt = record.formats[f];
        if (fmt.games < 1) {
            lines.push(`${f}   ${formatPlayerElo(record, f, auth)}`);
            continue;
        }
        var fmtLosses = fmt.games - fmt.wins;
        var fmtElo = getFormatElo(record, f);
        lines.push(`${f}   ${formatRankDisplay(getEloRank(fmtElo, { format: f, auth }), fmtElo)}`);
        lines.push(`      ${fmt.wins}W-${fmtLosses}L · ${fmt.goals}G · ${fmt.assists}A`);
    }
    lines.push('', `💡 ${LEADERBOARD_TOP_HINT}`);
    return lines.join('\n');
}

function printPlayerStats(stats) {
    return printFormatStatsBlock(stats);
}

/* FETCH FUNCTIONS */

function fetchGametimeReport(game) {
    var fieldGametimeRed = {
        name: '🔴        **RED TEAM STATS**',
        value: '⌛ __**Game Time:**__\n\n',
        inline: true,
    };
    var fieldGametimeBlue = {
        name: '🔵       **BLUE TEAM STATS**',
        value: '⌛ __**Game Time:**__\n\n',
        inline: true,
    };
    var redTeamTimes = game.playerComp[0].map((p) => [p.player, getGametimePlayer(p)]);
    var blueTeamTimes = game.playerComp[1].map((p) => [p.player, getGametimePlayer(p)]);

    for (let time of redTeamTimes) {
        var minutes = getMinutesReport(time[1]);
        var seconds = getSecondsReport(time[1]);
        fieldGametimeRed.value += `> **${time[0].name}:** ${minutes > 0 ? `${minutes}m` : ''}` +
            `${seconds > 0 || minutes == 0 ? `${seconds}s` : ''}\n`;
    }
    fieldGametimeRed.value += `\n${blueTeamTimes.length - redTeamTimes.length > 0 ? '\n'.repeat(blueTeamTimes.length - redTeamTimes.length) : ''
        }`;
    fieldGametimeRed.value += '=====================';

    for (let time of blueTeamTimes) {
        var minutes = getMinutesReport(time[1]);
        var seconds = getSecondsReport(time[1]);
        fieldGametimeBlue.value += `> **${time[0].name}:** ${minutes > 0 ? `${minutes}m` : ''}` +
            `${seconds > 0 || minutes == 0 ? `${seconds}s` : ''}\n`;
    }
    fieldGametimeBlue.value += `\n${redTeamTimes.length - blueTeamTimes.length > 0 ? '\n'.repeat(redTeamTimes.length - blueTeamTimes.length) : ''
        }`;
    fieldGametimeBlue.value += '=====================';

    return [fieldGametimeRed, fieldGametimeBlue];
}

function fetchActionsSummaryReport(game) {
    var fieldReportRed = {
        name: '🔴        **RED TEAM STATS**',
        value: '📊 __**Player Stats:**__\n\n',
        inline: true,
    };
    var fieldReportBlue = {
        name: '🔵       **BLUE TEAM STATS**',
        value: '📊 __**Player Stats:**__\n\n',
        inline: true,
    };
    var goals = [[], []];
    for (let i = 0; i < game.goals.length; i++) {
        goals[game.goals[i].team - 1].push([game.goals[i].striker, game.goals[i].assist]);
    }
    var redActions = actionReportCountTeam(goals, Team.RED);
    if (redActions.length > 0) {
        for (let act of redActions) {
            fieldReportRed.value += `> **${act[0].team != Team.RED ? '[OG] ' : ''}${act[0].name}:**` +
                `${act[1] > 0 ? ` ${act[1]}G` : ''}` +
                `${act[2] > 0 ? ` ${act[2]}A` : ''}` +
                `${act[3] > 0 ? ` ${act[3]}CS` : ''}\n`;
        }
    }
    var blueActions = actionReportCountTeam(goals, Team.BLUE);
    if (blueActions.length > 0) {
        for (let act of blueActions) {
            fieldReportBlue.value += `> **${act[0].team != Team.BLUE ? '[OG] ' : ''}${act[0].name}:**` +
                `${act[1] > 0 ? ` ${act[1]}G` : ''}` +
                `${act[2] > 0 ? ` ${act[2]}A` : ''}` +
                `${act[3] > 0 ? ` ${act[3]}CS` : ''}\n`;
        }
    }

    fieldReportRed.value += `\n${blueActions.length - redActions.length > 0 ? '\n'.repeat(blueActions.length - redActions.length) : ''
        }`;
    fieldReportRed.value += '=====================';

    fieldReportBlue.value += `\n${redActions.length - blueActions.length > 0 ? '\n'.repeat(redActions.length - blueActions.length) : ''
        }`;
    fieldReportBlue.value += '=====================';

    return [fieldReportRed, fieldReportBlue];
}

function fetchSummaryEmbed(game) {
    var fetchEndgame = [fetchGametimeReport, fetchActionsSummaryReport];
    var logChannel = gameWebhook;
    var fields = [
        {
            name: '🔴        **RED TEAM STATS**',
            value: '=====================\n\n',
            inline: true,
        },
        {
            name: '🔵       **BLUE TEAM STATS**',
            value: '=====================\n\n',
            inline: true,
        },
    ];
    for (let i = 0; i < fetchEndgame.length; i++) {
        var fieldsReport = fetchEndgame[i](game);
        fields[0].value += fieldsReport[0].value + '\n\n';
        fields[1].value += fieldsReport[1].value + '\n\n';
    }
    fields[0].value = fields[0].value.substring(0, fields[0].value.length - 2);
    fields[1].value = fields[1].value.substring(0, fields[1].value.length - 2);

    var possR = possession[0] / (possession[0] + possession[1]);
    var possB = 1 - possR;
    var possRString = (possR * 100).toFixed(0).toString();
    var possBString = (possB * 100).toFixed(0).toString();
    var zoneR = actionZoneHalf[0] / (actionZoneHalf[0] + actionZoneHalf[1]);
    var zoneB = 1 - zoneR;
    var zoneRString = (zoneR * 100).toFixed(0).toString();
    var zoneBString = (zoneB * 100).toFixed(0).toString();
    var win = (game.scores.red > game.scores.blue) * 1 + (game.scores.blue > game.scores.red) * 2;
    var objectBodyWebhook = {
        embeds: [
            {
                title: `📝 MATCH REPORT #${getIdReport()}`,
                description:
                    `**${getTimeEmbed(game.scores.time)}** ` +
                    (win == 1 ? '**Red Team** ' : 'Red Team ') + game.scores.red +
                    ' - ' +
                    game.scores.blue + (win == 2 ? ' **Blue Team**' : ' Blue Team') +
                    '\n```c\nPossession: ' + possRString + '% - ' + possBString + '%' +
                    '\nAction Zone: ' + zoneRString + '% - ' + zoneBString + '%\n```\n\n',
                color: 9567999,
                fields: fields,
                footer: {
                    text: `Recording: ${getRecordingName(game)}`,
                },
                timestamp: new Date().toISOString(),
            },
        ],
        username: roomName
    };
    postWebhook(logChannel, objectBodyWebhook);
}

/* EVENTS */

/* PLAYER MOVEMENT */

room.onPlayerJoin = function (player) {
    authArray[player.id] = [player.auth, player.conn];
    if (player.conn != null) {
        // playersAll predates this join; conns come from authArray (player objects lack .conn off-event).
        var sameConnPlayers = playersAll.filter((p) => p.id != player.id && authArray[p.id]?.[1] == player.conn);
        if (sameConnPlayers.length >= 4) {
            guardExemptIds.add(player.id);
            forfeitExemptLeaveIds.add(player.id);
            room.kickPlayer(player.id, 'Too many connections from this IP (max 4)', false);
            return;
        }
    }
    var nowJoin = Date.now();
    var authExp = voteBannedAuths.get(player.auth);
    var connExp = voteBannedConns.get(player.conn);
    if ((authExp && authExp > nowJoin) || (connExp && connExp > nowJoin)) {
        guardExemptIds.add(player.id);
        room.kickPlayer(player.id, 'Vote banned (5 min)', false);
        return;
    }
    var leaveAuthExp = leaveBannedAuths.get(player.auth);
    var leaveConnExp = leaveBannedConns.get(player.conn);
    if ((leaveAuthExp && leaveAuthExp > nowJoin) || (leaveConnExp && leaveConnExp > nowJoin)) {
        guardExemptIds.add(player.id);
        room.kickPlayer(player.id, 'Left too often — wait 3 min before rejoining', false);
        return;
    }
    postWebhook(roomWebhook, {
        content: `[${getDate()}] ➡️ JOIN (${playersAll.length + 1}/${maxPlayers})\n**` +
            `${player.name}** [${authArray[player.id][0]}] {${authArray[player.id][1]}}`,
        username: roomName,
    });
    updateTeams();
    var joinRecord = loadPlayerRecord(player.auth, player.name);
    sendJoinWelcome(player, joinRecord);
    updateAdmins();
    if (masterSet.has(player.auth)) {
        room.sendAnnouncement(
            `Master joined: ${player.name}\n   ${formatPlayerElo(joinRecord, getLobbyMatchFormat() || '2x2', player.auth)}`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(player.id, true);
    } else if (adminAuthSet.has(player.auth)) {
        room.sendAnnouncement(
            `Admin joined: ${player.name}\n   ${formatPlayerElo(joinRecord, getLobbyMatchFormat() || '2x2', player.auth)}`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(player.id, true);
    } else {
        announcePlayerJoin(player, joinRecord);
    }
    var sameAuthCheck = playersAll.filter((p) => p.id != player.id && authArray[p.id][0] == player.auth);
    if (sameAuthCheck.length > 0 && !debugMode) {
        var oldPlayerArray = playersAll.filter((p) => p.id != player.id && authArray[p.id][0] == player.auth);
        for (let oldPlayer of oldPlayerArray) {
            ghostKickHandle(oldPlayer, player);
        }
    }
    lastSpecTime.set(player.id, Date.now());
    reconcileAfkTimers();
    handlePlayersJoin();
    if (gameState !== State.STOP) {
        setTimeout(() => sendLiveMatchSpecNotice(player), 150);
    }
};

room.onPlayerTeamChange = function (changedPlayer, byPlayer) {
    if (changedPlayer.team === Team.SPECTATORS) {
        lastSpecTime.set(changedPlayer.id, Date.now());
    }
    handleLineupChangeTeamChange(changedPlayer);
    if (AFKSet.has(changedPlayer.id) && changedPlayer.team != Team.SPECTATORS) {
        room.setPlayerTeam(changedPlayer.id, Team.SPECTATORS);
        room.sendAnnouncement(
            `${changedPlayer.name} is AFK`,
            null,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    updateTeams();
    if (gameState != State.STOP) {
        if (changedPlayer.team != Team.SPECTATORS && game.scores.time <= (3 / 4) * game.scores.timeLimit && Math.abs(game.scores.blue - game.scores.red) < 2) {
            var statsRoster = changedPlayer.team == Team.RED ? teamRedStats : teamBlueStats;
            var changedAuth = getPlayerAuth(changedPlayer);
            if (!statsRoster.some((p) => getPlayerAuth(p) === changedAuth)) {
                statsRoster.push(changedPlayer);
            }
        }
    }
    handleActivityPlayerTeamChange(changedPlayer);
    handlePlayersTeamChange(byPlayer);
};


room.onPlayerLeave = function (player) {
    setTimeout(() => {
        if (!kickFetchVariable) {
            postWebhook(roomWebhook, {
                content: `[${getDate()}] ⬅️ LEAVE (${playersAll.length}/${maxPlayers})\n**${player.name}**` +
                    `[${authArray[player.id]?.[0]}] {${authArray[player.id]?.[1]}}`,
                username: roomName,
            });
        } else kickFetchVariable = false;
    }, 10);
    registerLeaveForRejoinGuard(player);
    AFKQueuedSet.delete(player.id);
    AFKSet.delete(player.id);
    clearAfkState(player.id);
    reconcileAfkTimers();
    handleVoteBanLeave(player);
    handleLineupChangeLeave(player);
    checkCaptainLeave(player);
    var exemptForfeit = forfeitExemptLeaveIds.has(player.id);
    forfeitExemptLeaveIds.delete(player.id);
    if (
        gameState !== State.STOP &&
        (player.team === Team.RED || player.team === Team.BLUE) &&
        !isRankedForfeitEligible()
    ) {
        removeFromEloRosters(player);
    }
    if (!exemptForfeit && gameState !== State.STOP) {
        recordMatchLeaver(player, 'left');
    }
    var trySpecFillFirst = !exemptForfeit
        && gameState !== State.STOP
        && (player.team === Team.RED || player.team === Team.BLUE)
        && canFillFromSpecLive();
    if (!exemptForfeit && gameState !== State.STOP && !trySpecFillFirst && tryRankedForfeit(player, 'left')) {
        updateTeams();
        updateAdmins();
        departedPlayerIds.add(player.id);
        schedulePruneDeparted();
        return;
    }
    updateTeams();
    updateAdmins();
    handlePlayersLeave();
    departedPlayerIds.add(player.id);
    schedulePruneDeparted();
};

room.onPlayerKicked = function (kickedPlayer, reason, ban, byPlayer) {
    if (reason === 'Reconnect' || reason === 'Pick timeout') {
        forfeitExemptLeaveIds.add(kickedPlayer.id);
    }
    // Automatic same-auth reconnect dedup is not abuse — don't count it toward the rejoin guard.
    if (reason === 'Reconnect') {
        guardExemptIds.add(kickedPlayer.id);
    }
    if (byPlayer != null && byPlayer.id !== kickedPlayer.id) {
        forfeitExemptLeaveIds.add(kickedPlayer.id);
    }
    kickFetchVariable = true;
    postWebhook(roomWebhook, {
        content: `[${getDate()}] ⛔ ${ban ? 'BAN' : 'KICK'} (${playersAll.length}/${maxPlayers})\n` +
            `**${kickedPlayer.name}** [${authArray[kickedPlayer.id]?.[0]}] {${authArray[kickedPlayer.id]?.[1]}} was ${ban ? 'banned' : 'kicked'}` +
            `${byPlayer != null ? ' by **' + byPlayer.name + '** [' + authArray[byPlayer.id]?.[0] + '] {' + authArray[byPlayer.id]?.[1] + '}' : ''}`,
        username: roomName,
    });
    if ((ban && ((byPlayer != null &&
        (byPlayer.id == kickedPlayer.id || getRole(byPlayer) < Role.MASTER)) || getRole(kickedPlayer) == Role.MASTER)) || disableBans
    ) {
        room.clearBan(kickedPlayer.id);
        return;
    }
    if (byPlayer != null && getRole(byPlayer) < Role.ADMIN_PERM) {
        room.sendAnnouncement(
            'Cannot kick/ban players.',
            byPlayer.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(byPlayer.id, false);
        return;
    }
    if (ban) banList.push([kickedPlayer.name, kickedPlayer.id]);
    scheduleRosterReconcile();
};

/* PLAYER ACTIVITY */

room.onPlayerChat = function (player, message) {
    if (gameState !== State.STOP && player.team != Team.SPECTATORS) {
        let pComp = getPlayerComp(player);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
    let msgArray = message.split(/ +/);
    if (!hideClaimMessage || msgArray[0] != '!claim') {
        postWebhook(roomWebhook, {
            content: `[${getDate()}] 💬 CHAT\n**${player.name}** : ${message.replace('@', '@ ')}`,
            username: roomName,
        });
    }
    if (msgArray[0][0] == '!') {
        let command = getCommand(msgArray[0].slice(1).toLowerCase());
        if (command != false && commands[command].roles <= getRole(player)) commands[command].function(player, message);
        else
            room.sendAnnouncement(
                `Unknown command. Type: !help`,
                player.id,
                errorColor,
                FONT_FORMAT.bold,
                HaxNotification.CHAT
            );
        return false;
    }
    if (msgArray[0].toLowerCase() == 't') {
        teamChat(player, message);
        return false;
    }
    if (msgArray[0].substring(0, 2) === '@@') {
        playerChat(player, message);
        return false;
    }
    if (chooseMode && teamRed.length * teamBlue.length != 0) {
        var choosingMessageCheck = chooseModeFunction(player, message);
        if (choosingMessageCheck) return false;
    }
    if (slowMode > 0) {
        var filter = slowModeFunction(player, message);
        if (filter) return false;
    }
    if (!player.admin && muteArray.getByAuth(authArray[player.id][0]) != null) {
        room.sendAnnouncement(
            `Muted — cannot chat.`,
            player.id,
            errorColor,
            FONT_FORMAT.bold,
            HaxNotification.CHAT
        );
        return false;
    }
    broadcastPublicChat(player, message);
    return false;
};

room.onPlayerActivity = function (player) {
    if (gameState !== State.STOP) {
        let pComp = getPlayerComp(player);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
};

room.onPlayerBallKick = function (player) {
    if (kickoffWatching) {
        clearKickoffWatch();
        playSituation = Situation.PLAY;
    } else if (playSituation == Situation.KICKOFF) {
        playSituation = Situation.PLAY;
    }
    if (playSituation != Situation.GOAL) {
        var ballPosition = room.getBallPosition();
        if (game.touchArray.length == 0 || player.id != game.touchArray[game.touchArray.length - 1].player.id) {
            lastTeamTouched = player.team;
            pushBallTouch(player, game.scores.time, ballPosition);
        }
    }
};

/* GAME MANAGEMENT */

room.onGameStart = function (byPlayer) {
    clearTimeout(startTimeout);
    cancelFillWait();
    if (chooseMode) deactivateChooseMode();
    arranging = false;
    if (byPlayer != null) clearTimeout(stopTimeout);
    game = new Game();
    possession = [0, 0];
    actionZoneHalf = [0, 0];
    gameState = State.PLAY;
    endGameVariable = false;
    rankedForfeit = false;
    forfeitAuth = null;
    forfeitReason = null;
    formatBrokenMatch = false;
    matchLeavers = [];
    goldenGoal = false;
    playSituation = Situation.KICKOFF;
    lastTouches = Array(2).fill(null);
    lastTeamTouched = Team.SPECTATORS;
    teamRedStats = [];
    teamBlueStats = [];
    for (let player of teamRed) {
        teamRedStats.push(player);
    }
    for (let player of teamBlue) {
        teamBlueStats.push(player);
    }
    currentMatchFormat = formatKeyFromTeamSizes();
    if (currentMatchFormat) {
        room.sendAnnouncement(
            `⚔ Ranked ${currentMatchFormat} match — Elo & stats count for ${currentMatchFormat} only`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    }
    calculateStadiumVariables();
    startKickoffWatch(Team.RED);
};

room.onGameStop = function (byPlayer) {
    applyQueuedAfk();
    clearKickoffWatch();
    clearTimeout(stopTimeout);
    clearTimeout(unpauseTimeout);
    cancelFillWait();
    rosterQueue.cancel();
    if (byPlayer != null) clearTimeout(startTimeout);
    game.rec = room.stopRecording();
    if (
        !cancelGameVariable && game.playerComp[0].length + game.playerComp[1].length > 0 &&
        (
            (game.scores.timeLimit != 0 &&
                ((game.scores.time >= 0.5 * game.scores.timeLimit &&
                    game.scores.time < 0.75 * game.scores.timeLimit &&
                    game.scores.red != game.scores.blue) ||
                    game.scores.time >= 0.75 * game.scores.timeLimit)
            ) ||
            endGameVariable
        )
    ) {
        fetchSummaryEmbed(game);
        if (fetchRecordingVariable) {
            setTimeout((gameEnd) => { fetchRecording(gameEnd); }, 500, game);
        }
    }
    cancelGameVariable = false;
    gameState = State.STOP;
    playSituation = Situation.STOP;
    currentMatchFormat = null;
    updateTeams();
    handlePlayersStop(byPlayer);
    handleActivityStop();
};

room.onGamePause = function (byPlayer) {
    if (mentionPlayersUnpause && gameState == State.PAUSE) {
        if (byPlayer != null) {
            room.sendAnnouncement(
                `Paused by ${byPlayer.name}`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        } else {
            room.sendAnnouncement(
                `Game paused`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        }
    }
    clearTimeout(unpauseTimeout);
    gameState = State.PAUSE;
    pauseKickoffWatch();
};

room.onGameUnpause = function (byPlayer) {
    unpauseTimeout = setTimeout(() => {
        gameState = State.PLAY;
        resumeKickoffWatch();
    }, 2000);
    if (mentionPlayersUnpause) {
        if (byPlayer != null) {
            room.sendAnnouncement(
                `Unpaused by ${byPlayer.name}`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        } else {
            room.sendAnnouncement(
                `Game unpaused`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        }
    }
    if (chooseComplete()) {
        deactivateChooseMode();
    }
};

room.onTeamGoal = function (team) {
    const scores = room.getScores();
    game.scores = scores;
    playSituation = Situation.GOAL;
    ballSpeed = getBallSpeed();
    var goalString = getGoalString(team);
    for (let player of teamRed) {
        var playerComp = getPlayerComp(player);
        if (playerComp == null) continue;
        team == Team.RED ? playerComp.goalsScoredTeam++ : playerComp.goalsConcededTeam++;
    }
    for (let player of teamBlue) {
        var playerComp = getPlayerComp(player);
        if (playerComp == null) continue;
        team == Team.BLUE ? playerComp.goalsScoredTeam++ : playerComp.goalsConcededTeam++;
    }
    room.sendAnnouncement(
        goalString,
        null,
        team == Team.RED ? redColor : blueColor,
        null,
        HaxNotification.CHAT
    );
    postWebhook(roomWebhook, {
        content: `[${getDate()}] ${goalString}`,
        username: roomName,
    });
    if ((scores.scoreLimit != 0 && (scores.red == scores.scoreLimit || scores.blue == scores.scoreLimit)) || goldenGoal) {
        endGame(team);
        goldenGoal = false;
        stopTimeout = setTimeout(() => {
            room.stopGame();
        }, 1000);
    } else {
        startKickoffWatch(opponentTeam(team));
    }
};

room.onPositionsReset = function () {
    lastTouches = Array(2).fill(null);
    lastTeamTouched = Team.SPECTATORS;
    playSituation = Situation.KICKOFF;
};

/* MISCELLANEOUS */

room.onRoomLink = function (url) {
    console.log(`${url}\nmasterPassword : ${masterPassword}`);
    postWebhook(roomWebhook, {
        content: `[${getDate()}] 🔗 LINK ${url}\nmasterPassword : ${masterPassword}`,
        username: roomName,
    });
};

room.onPlayerAdminChange = function (changedPlayer, byPlayer) {
    updateTeams();
    if (!changedPlayer.admin && getRole(changedPlayer) >= Role.ADMIN_TEMP) {
        room.setPlayerAdmin(changedPlayer.id, true);
        return;
    }
    updateAdmins(byPlayer != null && !changedPlayer.admin && changedPlayer.id == byPlayer.id ? changedPlayer.id : 0);
};

room.onKickRateLimitSet = function (min, rate, burst, byPlayer) {
    if (byPlayer != null) {
        room.sendAnnouncement(
            `Kick rate must stay 6-0-0.`,
            byPlayer.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        room.setKickRateLimit(6, 0, 0);
    }
};

room.onStadiumChange = function (newStadiumName, byPlayer) {
    if (byPlayer !== null) {
        if (getRole(byPlayer) < Role.MASTER && currentStadium != 'other') {
            room.sendAnnouncement(
                `Use !map to change stadium.`,
                byPlayer.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
            loadStadiumByKey(currentStadium);
        } else {
            room.sendAnnouncement(
                `Map changed. Use !map when done.`,
                byPlayer.id,
                infoColor,
                null,
                HaxNotification.CHAT
            );
            currentStadium = 'other';
        }
    }
    checkStadiumVariable = true;
};

room.onGameTick = function () {
    tickBallPosition = room.getBallPosition();
    checkTime();
    getLastTouchOfTheBall();
    getGameStats();
    handleActivity();
};

migrateAllPlayerLadderRecords();
rebuildChallengerSets();
