/* VARIABLES */

/* ROOM */

const cfg = globalThis.roomConfig;
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

var drawTimeLimit = Infinity;
var teamSize = cfg.teamSize;
var stadiumKeys = cfg.stadiumKeys;
var maxAdmins = cfg.maxAdmins;
var disableBans = cfg.disableBans;
var debugMode = cfg.debugMode;
var afkLimit = debugMode ? Infinity : 12;

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
                `You have been unmuted.`,
                this.playerId,
                announcementColor,
                "bold",
                HaxNotification.CHAT
            );
            this.remove();
        }, minutes * 60 * 1000);
        muteArray.add(this);
    }

    remove() {
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

const MATCH_FORMATS = ['1x1', '2x2', '3x3'];
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

/* COMMANDS */

var commands = {
    help: {
        aliases: ['commands'],
        roles: Role.PLAYER,
        desc: `
	This command shows all the available commands. It also can show the description of a command in particular.
Example: \'!help bb\' will show the description of the \'bb\' command.`,
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
        This command makes you go AFK.
    It has constraints: 1 minute minimum of AFK time, 5 minutes maximum and 10 minutes cooldown.`,
        function: afkCommand,
    },
    afks: {
        aliases: ['afklist'],
        roles: Role.PLAYER,
        desc: `
        This command shows all the players that are AFK.`,
        function: afkListCommand,
    },
    bb: {
        aliases: ['bye', 'gn', 'cya'],
        roles: Role.PLAYER,
        desc: `
	This command makes you leave instantly (use recommended).`,
        function: leaveCommand,
    },
    me: {
        aliases: ['stat', 'stats'],
        roles: Role.PLAYER,
        desc: `
        Shows your stats per format. !stats or !stats 1x1 / 2x2 / 3x3`,
        function: globalStatsCommand,
    },
    rename: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        This command allows you to rename yourself for the leaderboard.`,
        function: renameCommand,
    },
    games: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by games. Optional format: !games 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    wins: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by wins. Optional format: !wins 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    goals: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by goals. Optional format: !goals 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    assists: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by assists. Optional format: !assists 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    cs: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by CS. Optional format: !cs 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    playtime: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 by playtime. Optional format: !playtime 1x1 / 2x2 / 3x3`,
        function: statsLeaderboardCommand,
    },
    top: {
        aliases: [],
        roles: Role.PLAYER,
        desc: `
        Top 5 leaderboard for a format: !top 1x1 / !top 2x2 / !top 3x3`,
        function: topCommand,
    },
    map: {
        aliases: ['maps'],
        roles: Role.ADMIN_TEMP,
        desc: `
        Lists stadiums from the stadiums folder, or loads one by number.
    !map — show all maps.
    !map <number> — load map (game must be stopped).`,
        function: mapCommand,
    },
    rr: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command restarts the game.`,
        function: restartCommand,
    },
    rrs: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command swaps the teams and restarts the game.`,
        function: restartSwapCommand,
    },
    swap: {
        aliases: ['s'],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command swaps the teams when the game is stopped.`,
        function: swapCommand,
    },
    kickred: {
        aliases: ['kickr'],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command kicks all the players from the red team, including the player that entered the command. You can give as an argument the reason of the kick.`,
        function: kickTeamCommand,
    },
    kickblue: {
        aliases: ['kickb'],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command kicks all the players from the blue team, including the player that entered the command. You can give as an argument the reason of the kick.`,
        function: kickTeamCommand,
    },
    kickspec: {
        aliases: ['kicks'],
        roles: Role.ADMIN_TEMP,
        desc: `
    This command kicks all the players from the spectators team, including the player that entered the command. You can give as an argument the reason of the kick.`,
        function: kickTeamCommand,
    },
    mute: {
        aliases: ['m'],
        roles: Role.ADMIN_TEMP,
        desc: `
        This command allows to mute a player. He won't be able to talk for a certain duration, and can be unmuted at any time by admins.
    It takes 2 arguments:
    Argument 1: #<id> where <id> is the id of the player targeted. This won't work if the player is an admin.
    Argument 2 (optional): <duration> where <duration> is the duration of the mute in minutes. If no value is provided, the mute lasts for the default duration, ${muteDuration} minutes.
    Example: !mute #3 20 will mute the player with id 3 for 20 minutes.`,
        function: muteCommand,
    },
    unmute: {
        aliases: ['um'],
        roles: Role.ADMIN_TEMP,
        desc: `
        This command allows to unmute someone.
    It takes 1 argument:
    Argument 1: #<id> where <id> is the id of the muted player.
    OR
    Argument 1: <number> where <number> is the number associated with the mute given by the 'muteList' command.
    Example: !unmute #300 will unmute the player with id 300,
             !unmute 8 will unmute the n°8 player according to the 'muteList' command.`,
        function: unmuteCommand,
    },
    mutes: {
        aliases: [],
        roles: Role.ADMIN_TEMP,
        desc: `
        This command shows the list of muted players.`,
        function: muteListCommand,
    },
    clearbans: {
        aliases: [],
        roles: Role.MASTER,
        desc: `
	This command unbans everyone. It also can unban one player in particular, by adding his ID as an argument.`,
        function: clearbansCommand,
    },
    bans: {
        aliases: ['banlist'],
        roles: Role.MASTER,
        desc: `
    This command shows all the players that were banned and their IDs.`,
        function: banListCommand,
    },
    admins: {
        aliases: ['adminlist'],
        roles: Role.MASTER,
        desc: `
    This command shows all the players that are permanent admins.`,
        function: adminListCommand,
    },
    setadmin: {
        aliases: ['admin'],
        roles: Role.MASTER,
        desc: `
    This command allows to set someone as admin. He will be able to connect as admin, and can be removed at any time by masters.
It takes 1 argument:
Argument 1: #<id> where <id> is the id of the player targeted.
Example: !setadmin #3 will give admin to the player with id 3.`,
        function: setAdminCommand,
    },
    removeadmin: {
        aliases: ['unadmin'],
        roles: Role.MASTER,
        desc: `
	This command allows to remove someone as admin.
It takes 1 argument:
Argument 1: #<id> where <id> is the id of the player targeted.
OR
Argument 1: <number> where <number> is the number associated with the admin given by the 'admins' command.
Example: !removeadmin #300 will remove admin to the player with id 300,
         !removeadmin 2 will remove the admin n°2 according to the 'admins' command.`,
        function: removeAdminCommand,
    },
    password: {
        aliases: ['pw'],
        roles: Role.MASTER,
        desc: `
        This command allows to add a password to the room.
    It takes 1 argument:
    Argument 1: <password> where <password> is the password you want for the room.
    
    To remove the room password, simply enter '!password'.`,
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
var cancelGameVariable = false;
var kickFetchVariable = false;

var chooseMode = false;
var timeOutCap;
var capLeft = false;
var chooseTime = 20;

var AFKSet = new Set();
var AFKMinSet = new Set();
var AFKCooldownSet = new Set();
var minAFKDuration = 0;
var maxAFKDuration = 30;
var AFKCooldown = 0;

var muteArray = new MuteList();
var muteDuration = 5;

var arranging = false;
var applyingTeams = false;
var lastSpecTime = new Map();

var stopTimeout;
var startTimeout;
var unpauseTimeout;
var fillTimeout;
var waitingForFill = false;

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
        }).then((res) => res);
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

function getPlayerComp(player) {
    if (player == null || player.id == 0) return null;
    return game.compIndex.get(authArray[player.id][0]) ?? null;
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
    var message = `${emoji} [TEAM] ${player.name}: ${msgArray.join(' ')}`;
    var team = getTeamArray(player.team, true);
    var color = player.team == Team.RED ? redColor : player.team == Team.BLUE ? blueColor : null;
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
            `Invalid player, make sure the name you entered is correct.`,
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
            `You can't send a PM to yourself!`,
            player.id,
            errorColor,
            null,
            null
        );
        return false;
    }
    var messageFrom = `📝 [PM with ${playerTarget.name}] ${player.name}: ${msgArray.slice(1).join(' ')}`

    var messageTo = `📝 [PM with ${player.name}] ${player.name}: ${msgArray.slice(1).join(' ')}`

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
            ballRadius = ballDisc.radius;
            playerRadius = playerDisc.radius;
            triggerDistance = ballRadius + playerRadius + 0.01;
            speedCoefficient = 100 / (5 * ballDisc.invMass * (ballDisc.damping ** 60 + 1));
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
    game.touchArray.push(new BallTouch(player, time, goalIdx, ballPosition));
    if (game.touchArray.length > touchArrayMax) {
        game.touchArray.splice(0, game.touchArray.length - touchArrayMax);
    }
    lastTouches[0] = checkGoalKickTouch(game.touchArray, game.touchArray.length - 1, goalIdx);
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
    room.kickPlayer(player.id, 'Bye !', false);
}

function helpCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length == 0) {
        var commandString = 'Player commands :';
        for (const [key, value] of Object.entries(commands)) {
            if (value.desc && value.roles == Role.PLAYER) commandString += ` !${key},`;
        }
        commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        if (getRole(player) >= Role.ADMIN_TEMP) {
            commandString += `Admin commands :`;
            for (const [key, value] of Object.entries(commands)) {
                if (value.desc && value.roles == Role.ADMIN_TEMP) commandString += ` !${key},`;
            }
            if (commandString.slice(commandString.length - 1) == ':')
                commandString += ` None,`;
            commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        }
        if (getRole(player) >= Role.MASTER) {
            commandString += `Master commands :`;
            for (const [key, value] of Object.entries(commands)) {
                if (value.desc && value.roles == Role.MASTER) commandString += ` !${key},`;
            }
            if (commandString.slice(commandString.length - 1) == ':') commandString += ` None,`;
            commandString = commandString.substring(0, commandString.length - 1) + '.\n';
        }
        commandString += "\nTo get information on a specific command, type ''!help <command name>'.";
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
                `\'${commandName}\' command :\n${commands[commandName].desc}`,
                player.id,
                infoColor,
                null,
                HaxNotification.CHAT
            );
        else
            room.sendAnnouncement(
                `The command you tried to get information on does not exist. To check all available commands, type \'!help\'`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
    }
}

function globalStatsCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var formatFilter = normalizeFormatArg(msgArray[0]);
    var auth = authArray[player.id][0];
    var record = loadPlayerRecord(auth, player.name);
    if (!hasPlayedAnyFormat(record)) {
        room.sendAnnouncement(
            `You haven't played a ranked game in this room yet !`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    var statsString = printPlayerRecord(record, formatFilter);
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
            `You successfully renamed yourself ${record.playerName} !`,
            player.id,
            successColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        room.sendAnnouncement(
            `You haven't played a game in this room yet !`,
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
    var formatFilter = normalizeFormatArg(parts[1]);
    printRankings(key, player.id, formatFilter);
}

function topCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    var formatFilter = normalizeFormatArg(msgArray[0]);
    if (!formatFilter) {
        room.sendAnnouncement(
            'Usage: !top 1x1 · !top 2x2 · !top 3x3',
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return;
    }
    printFormatTop(formatFilter, player.id);
}

function afkCommand(player, message) {
    if (player.team == Team.SPECTATORS || players.length == 1) {
        if (AFKSet.has(player.id)) {
            if (AFKMinSet.has(player.id)) {
                room.sendAnnouncement(
                    `There is a minimum of ${minAFKDuration} minute of AFK time. Don't abuse the command !`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            } else {
                AFKSet.delete(player.id);
                room.sendAnnouncement(
                    `🌅 ${player.name} is not AFK anymore !`,
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
                    `You can only go AFK every ${AFKCooldown} minutes. Don't abuse the command !`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            } else {
                AFKSet.add(player.id);
                if (!player.admin) {
                    AFKMinSet.add(player.id);
                    AFKCooldownSet.add(player.id);
                    setTimeout(
                        (id) => {
                            AFKMinSet.delete(id);
                        },
                        minAFKDuration * 60 * 1000,
                        player.id
                    );
                    setTimeout(
                        (id) => {
                            AFKSet.delete(id);
                        },
                        maxAFKDuration * 60 * 1000,
                        player.id
                    );
                    setTimeout(
                        (id) => {
                            AFKCooldownSet.delete(id);
                        },
                        AFKCooldown * 60 * 1000,
                        player.id
                    );
                }
                room.setPlayerTeam(player.id, Team.SPECTATORS);
                room.sendAnnouncement(
                    `😴 ${player.name} is now AFK !`,
                    null,
                    announcementColor,
                    null,
                    null
                );
                updateTeams();
                handlePlayersLeave();
            }
        }
    } else {
        room.sendAnnouncement(
            `You can't go AFK while in a team !`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
}

function afkListCommand(player, message) {
    if (AFKSet.size == 0) {
        room.sendAnnouncement(
            "😴 There's nobody in the AFK list.",
            player.id,
            announcementColor,
            null,
            null
        );
        return;
    }
    var cstm = '😴 AFK list : ';
    AFKSet.forEach((_, value) => {
        var p = room.getPlayer(value);
        if (p != null) cstm += p.name + `, `;
    });
    cstm = cstm.substring(0, cstm.length - 2) + '.';
    room.sendAnnouncement(cstm, player.id, announcementColor, null, null);
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
                `${player.name} is now a room master !`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `You are a master already !`,
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
            '✔️ Teams swapped !',
            null,
            announcementColor,
            null,
            null
        );
    } else {
        room.sendAnnouncement(
            `Please stop the game before swapping.`,
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
                room.kickPlayer(teamRed[0].id, reasonString, false);
            }, i * 20)
        }
    } else if (['!kickblue', '!kickb'].includes(msgArray[0].toLowerCase())) {
        for (let i = 0; i < teamBlue.length; i++) {
            setTimeout(() => {
                room.kickPlayer(teamBlue[0].id, reasonString, false);
            }, i * 20)
        }
    } else if (['!kickspec', '!kicks'].includes(msgArray[0].toLowerCase())) {
        for (let i = 0; i < teamSpec.length; i++) {
            setTimeout(() => {
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
    return true;
}

function loadStadiumByKey(key) {
    return loadStadium(findStadiumByKey(key));
}

function mapCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (stadiumCatalog.length === 0) {
        room.sendAnnouncement(
            'No maps found in stadiums folder.',
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
            'Please stop the game before using this command.',
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
            `Invalid map number. Use !map to see available maps (1-${stadiumCatalog.length}).`,
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
                        `${playerMute.name} has been muted for ${minutesMute} minutes.`,
                        null,
                        announcementColor,
                        null,
                        null
                    );
                } else {
                    room.sendAnnouncement(
                        `You can't mute an admin.`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `There is no player with such ID in the room. Enter "!help mute" for more information.`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else {
            room.sendAnnouncement(
                `Incorrect format for your argument. Enter "!help mute" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            `Wrong number of arguments. Enter "!help mute" for more information.`,
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
                        `${playerUnmute.name} has been unmuted !`,
                        null,
                        announcementColor,
                        null,
                        HaxNotification.CHAT
                    );
                } else {
                    room.sendAnnouncement(
                        `This player isn't muted !`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `There is no player with such ID in the room. Enter "!help unmute" for more information.`,
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
                `${playerUnmute.name} has been unmuted !`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `Incorrect format for your argument. Enter "!help unmute" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            `Wrong number of arguments. Enter "!help unmute" for more information.`,
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
            "🔇 There's nobody in the mute list.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '🔇 Mute list : ';
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

/* MASTER COMMANDS */

function clearbansCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length == 0) {
        room.clearBans();
        room.sendAnnouncement(
            '✔️ Bans cleared !',
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
                    `✔️ ${banList.filter((p) => p[1] == ID)[0][0]} has been unbanned from the room !`,
                    null,
                    announcementColor,
                    null,
                    null
                );
            } else {
                room.sendAnnouncement(
                    `The ID you entered doesn't have a ban associated to. Enter "!help clearbans" for more information.`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
            banList = banList.filter((p) => p[1] != ID);
        } else {
            room.sendAnnouncement(
                `Invalid ID entered. Enter "!help clearbans" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            `Wrong number of arguments. Enter "!help clearbans" for more information.`,
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
            "📢 There's nobody in the ban list.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '📢 Ban list : ';
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
            "📢 There's nobody in the admin list.",
            player.id,
            announcementColor,
            null,
            null
        );
        return false;
    }
    var cstm = '📢 Admin list : ';
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

function setAdminCommand(player, message) {
    var msgArray = message.split(/ +/).slice(1);
    if (msgArray.length > 0) {
        if (msgArray[0].length > 0 && msgArray[0][0] == '#') {
            msgArray[0] = msgArray[0].substring(1, msgArray[0].length);
            if (room.getPlayer(parseInt(msgArray[0])) != null) {
                var playerAdmin = room.getPlayer(parseInt(msgArray[0]));

                if (!adminList.map((a) => a[0]).includes(authArray[playerAdmin.id][0])) {
                    if (!masterList.includes(authArray[playerAdmin.id][0])) {
                        room.setPlayerAdmin(playerAdmin.id, true);
                        adminList.push([authArray[playerAdmin.id][0], playerAdmin.name]);
                        rebuildRoleSets();
                        room.sendAnnouncement(
                            `${playerAdmin.name} is now a room admin !`,
                            null,
                            announcementColor,
                            null,
                            HaxNotification.CHAT
                        );
                    } else {
                        room.sendAnnouncement(
                            `This player is a master already !`,
                            player.id,
                            errorColor,
                            null,
                            HaxNotification.CHAT
                        );
                    }
                } else {
                    room.sendAnnouncement(
                        `This player is a permanent admin already !`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `There is no player with such ID in the room. Enter "!help setadmin" for more information.`,
                    player.id,
                    errorColor,
                    null,
                    HaxNotification.CHAT
                );
            }
        } else {
            room.sendAnnouncement(
                `Incorrect format for your argument. Enter "!help setadmin" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            `Wrong number of arguments. Enter "!help setadmin" for more information.`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
    }
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
                    adminList = adminList.filter((a) => a[0] != authArray[playerAdmin.id][0]);
                    rebuildRoleSets();
                    room.sendAnnouncement(
                        `${playerAdmin.name} is not a room admin anymore !`,
                        null,
                        announcementColor,
                        null,
                        HaxNotification.CHAT
                    );
                } else {
                    room.sendAnnouncement(
                        `This player isn't a permanent admin !`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else {
                room.sendAnnouncement(
                    `There is no player with such ID in the room. Enter "!help removeadmin" for more information.`,
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
            adminList.splice(index);
            rebuildRoleSets();
            room.sendAnnouncement(
                `${playerAdmin[1]} is not a room admin anymore !`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `Incorrect format for your argument. Enter "!help removeadmin" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    } else {
        room.sendAnnouncement(
            `Wrong number of arguments. Enter "!help removeadmin" for more information.`,
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
                `The room password has been removed.`,
                player.id,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        }
        roomPassword = msgArray.join(' ');
        room.setPassword(roomPassword);
        room.sendAnnouncement(
            `The room password has been set to ${roomPassword}`,
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
                `The room password has been removed.`,
                player.id,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        } else {
            room.sendAnnouncement(
                `The room currently does not have a password. Enter "!help password" for more information.`,
                player.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
    }
}

/* GAME FUNCTIONS */

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
            goldenGoal = true;
            room.sendAnnouncement(
                '⚽ First goal wins !',
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
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

function endGame(winner) {
    if (players.length >= 2 * teamSize - 1) activateChooseMode();
    const scores = room.getScores();
    game.scores = scores;
    lastWinner = winner;
    endGameVariable = true;
    if (winner == Team.RED) {
        streak++;
        room.sendAnnouncement(
            `✨ Red Team won ${scores.red} - ${scores.blue} ! Current streak: ${streak}`,
            null,
            redColor,
            null,
            HaxNotification.CHAT
        );
    } else if (winner == Team.BLUE) {
        streak = 1;
        room.sendAnnouncement(
            `✨ Blue Team won ${scores.blue} - ${scores.red} ! Current streak: ${streak}`,
            null,
            blueColor,
            null,
            HaxNotification.CHAT
        );
    } else {
        streak = 0;
        room.sendAnnouncement(
            '💤 Draw limit reached !',
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
    }
    let possessionRedPct = (possession[0] / (possession[0] + possession[1])) * 100;
    let possessionBluePct = 100 - possessionRedPct;
    let possessionString = `🔴 ${possessionRedPct.toFixed(0)}% - ${possessionBluePct.toFixed(0)}% 🔵`;
    let actionRedPct = (actionZoneHalf[0] / (actionZoneHalf[0] + actionZoneHalf[1])) * 100;
    let actionBluePct = 100 - actionRedPct;
    let actionString = `🔴 ${actionRedPct.toFixed(0)}% - ${actionBluePct.toFixed(0)}% 🔵`;
    let CSString = getCSString(scores);
    room.sendAnnouncement(
        `📊 Possession: 🔴 ${possessionString}\n` +
        `📊 Action Zone: 🔴 ${actionString}\n` +
        `${CSString}`,
        null,
        announcementColor,
        null,
        HaxNotification.NONE
    );
    updateStats();
}

/* CHOOSING FUNCTIONS */

function activateChooseMode() {
    chooseMode = true;
    slowMode = chooseModeSlowMode;
    room.sendAnnouncement(
        `🐢 Slow mode changed to choose mode duration of: ${chooseModeSlowMode}s.`,
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
            `🐢 Slow mode changed to default duration of: ${defaultSlowMode}s.`,
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

function getSpecList(player) {
    if (player == null) return null;
    var cstm = 'Players : ';
    for (let i = 0; i < teamSpec.length; i++) {
        cstm += teamSpec[i].name + `[${i + 1}], `;
    }
    cstm = cstm.substring(0, cstm.length - 2) + '.';
    room.sendAnnouncement(
        cstm,
        player.id,
        infoColor,
        null,
        HaxNotification.CHAT
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
        room.sendAnnouncement(
            "To choose a player, enter his number in the list given or use 'top', 'random' or 'bottom'.",
            captain.id,
            infoColor,
            null,
            HaxNotification.MENTION
        );
        timeOutCap = setTimeout(
            (player) => {
                room.sendAnnouncement(
                    `Hurry up ${player.name}, only ${Number.parseInt(String(chooseTime / 2))} seconds left to choose !`,
                    player.id,
                    warningColor,
                    null,
                    HaxNotification.MENTION
                );
                timeOutCap = setTimeout(
                    (player) => {
                        room.kickPlayer(
                            player.id,
                            "You didn't choose in time !",
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
    if (teamRed.length != 0 && teamBlue.length != 0) {
        getSpecList(teamRed.length <= teamBlue.length ? teamRed[0] : teamBlue[0]);
    }
}

function chooseModeFunction(player, message) {
    var msgArray = message.split(/ +/);
    if (player.id == teamRed[0].id || player.id == teamBlue[0].id) {
        if (teamRed.length <= teamBlue.length && player.id == teamRed[0].id) {
            if (['top', 'auto'].includes(msgArray[0].toLowerCase())) {
                room.setPlayerTeam(teamSpec[0].id, Team.RED);
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Top !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (['random', 'rand'].includes(msgArray[0].toLowerCase())) {
                var r = getRandomInt(teamSpec.length);
                room.setPlayerTeam(teamSpec[r].id, Team.RED);
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Random !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (['bottom', 'bot'].includes(msgArray[0].toLowerCase())) {
                room.setPlayerTeam(teamSpec[teamSpec.length - 1].id, Team.RED);
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Bottom !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (!Number.isNaN(Number.parseInt(msgArray[0]))) {
                if (Number.parseInt(msgArray[0]) > teamSpec.length || Number.parseInt(msgArray[0]) < 1) {
                    room.sendAnnouncement(
                        `Your number is invalid !`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                } else {
                    var pickIdx = Number.parseInt(msgArray[0]) - 1;
                    room.setPlayerTeam(teamSpec[pickIdx].id, Team.RED);
                    clearTimeout(timeOutCap);
                    room.sendAnnouncement(
                        `${player.name} chose ${teamSpec[pickIdx].name} !`,
                        null,
                        announcementColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else return false;
            return true;
        }
        if (teamRed.length > teamBlue.length && player.id == teamBlue[0].id) {
            if (['top', 'auto'].includes(msgArray[0].toLowerCase())) {
                room.setPlayerTeam(teamSpec[0].id, Team.BLUE);
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Top !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (['random', 'rand'].includes(msgArray[0].toLowerCase())) {
                room.setPlayerTeam(
                    teamSpec[getRandomInt(teamSpec.length)].id,
                    Team.BLUE
                );
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Random !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (['bottom', 'bot'].includes(msgArray[0].toLowerCase())) {
                room.setPlayerTeam(teamSpec[teamSpec.length - 1].id, Team.BLUE);
                clearTimeout(timeOutCap);
                room.sendAnnouncement(
                    `${player.name} chose Bottom !`,
                    null,
                    announcementColor,
                    null,
                    HaxNotification.CHAT
                );
            } else if (!Number.isNaN(Number.parseInt(msgArray[0]))) {
                if (Number.parseInt(msgArray[0]) > teamSpec.length || Number.parseInt(msgArray[0]) < 1) {
                    room.sendAnnouncement(
                        `Your number is invalid !`,
                        player.id,
                        errorColor,
                        null,
                        HaxNotification.CHAT
                    );
                } else {
                    var pickIdx = Number.parseInt(msgArray[0]) - 1;
                    room.setPlayerTeam(teamSpec[pickIdx].id, Team.BLUE);
                    clearTimeout(timeOutCap);
                    room.sendAnnouncement(
                        `${player.name} chose ${teamSpec[pickIdx].name} !`,
                        null,
                        announcementColor,
                        null,
                        HaxNotification.CHAT
                    );
                }
            } else return false;
            return true;
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

    room.kickPlayer(oldP.id, 'Ghost kick', false);
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
        pComp.inactivityTicks++;
        if (pComp.inactivityTicks == 60 * ((2 / 3) * afkLimit)) {
            room.sendAnnouncement(
                `⛔ ${player.name}, if you don't move or send a message in the next ${Math.floor(afkLimit / 3)} seconds, you will be kicked !`,
                player.id,
                warningColor,
                null,
                HaxNotification.MENTION
            );
            return;
        }
        if (pComp.inactivityTicks >= 60 * afkLimit) {
            pComp.inactivityTicks = 0;
            if (game.scores.time <= afkLimit - 0.5) {
                setTimeout(() => {
                    !chooseMode ? instantRestart() : room.stopGame();
                }, 10);
            }
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

/** Deterministic, idempotent team arrangement. Winner-stays, fills both sides to the effective size, leftovers spectate, then starts. Re-running yields the same result, so concurrent triggers can't corrupt it. */
function applyTeams(winner) {
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
    var E = Math.min(teamSize, Math.floor(N / 2));
    var redKeep = winner === Team.RED ? teamRed.slice(0, E) : [];
    if (winner === Team.BLUE) {
        redKeep = teamBlue.slice(0, E);
    }
    var blueKeep = [];
    var keptIds = new Set([...redKeep, ...blueKeep].map((p) => p.id));
    var pool = players.filter((p) => !keptIds.has(p.id));
    
    // Update lastSpecTime for players about to become spectators (losers)
    var now = Date.now();
    for (var p of pool) {
        if (p.team !== Team.SPECTATORS) {
            lastSpecTime.set(p.id, now++);
        }
    }
    
    // Sort pool by queue time. Anyone missing a time gets 0 (front of line).
    pool.sort((a, b) => {
        var aTime = lastSpecTime.get(a.id) || 0;
        var bTime = lastSpecTime.get(b.id) || 0;
        return aTime - bTime;
    });

    // If chooseMode is enabled, E >= 2, and there's a leftover (spec), we leave the rest of Blue empty for captain pick.
    var isCaptainPick = chooseMode && E >= 2 && (N - 2 * E) > 0;
    var blueTarget = isCaptainPick ? 1 : E;

    var red = redKeep.slice();
    var blue = blueKeep.slice();
    for (var p of pool) {
        if (red.length >= E && blue.length >= blueTarget) break;
        if (red.length < E && red.length <= blue.length) red.push(p);
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
    teamRedStats = [];
    teamBlueStats = [];
    
    if (isCaptainPick) {
        setTimeout(() => {
            updateTeams();
            activateChooseMode();
            choosePlayer();
        }, 100);
    } else {
        scheduleStart(2000);
    }
}

/** Arrange teams; stop a running game first (deferred apply) so the stadium can change cleanly. */
function setupTeams(winner) {
    updateTeams();
    if (players.length === 0) {
        room.stopGame();
        return;
    }
    if (gameState !== State.STOP) {
        room.stopGame();
        setTimeout(() => applyTeams(winner), 100);
    } else {
        applyTeams(winner);
    }
}

function balanceTeams() {
    if (chooseMode || applyingTeams) return;
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
        var scores = room.getScores();
        var isZeroZero = scores != null && scores.red === 0 && scores.blue === 0;

        // Live match: don't reshuffle unless score is 0-0 and map size should change. Promote solo to a real match always.
        if ((currentStadium === stadiumKeys.solo && N >= 2) || (isZeroZero && desiredStadiumKey() !== currentStadium)) {
            setupTeams(Team.SPECTATORS);
            return;
        }
        handleLiveImbalance();
        return;
    }
    setupTeams(Team.SPECTATORS);
}

/** Clear the short-handed wait timer and unpause if we paused for it. */
function cancelFillWait() {
    clearTimeout(fillTimeout);
    if (waitingForFill) {
        waitingForFill = false;
        room.pauseGame(false);
    }
}

/** Keep a live match even: pull spectators into the short team; if none available, pause up to 10s for a joiner, then award the win to the fuller team and rebalance in the lobby. */
function handleLiveImbalance() {
    updateTeams();
    var diff = teamRed.length - teamBlue.length;
    if (diff === 0) {
        cancelFillWait();
        return;
    }
    if (teamSpec.length > 0) {
        var shortTeam = diff > 0 ? Team.BLUE : Team.RED;
        var need = Math.abs(diff);
        var specsToPull = teamSpec.slice(0, need);
        applyingTeams = true;
        for (var i = 0; i < specsToPull.length; i++) {
            room.setPlayerTeam(specsToPull[i].id, shortTeam);
        }
        applyingTeams = false;
        
        // Assume team change succeeded synchronously or will succeed next tick.
        if (specsToPull.length === need) {
            room.sendAnnouncement(
                '✅ Spectator pulled in to fill the team.',
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
            cancelFillWait();
            return;
        } else {
            // Not enough spectators to fill completely, but we pulled what we had.
            room.sendAnnouncement(
                `✅ ${specsToPull.length} spectator(s) pulled in, but team is still short.`,
                null,
                announcementColor,
                null,
                HaxNotification.CHAT
            );
        }
    }
    if (!waitingForFill) {
        waitingForFill = true;
        room.pauseGame(true);
        room.sendAnnouncement(
            '⏳ A team is short-handed. Waiting 10s for a player to join, otherwise the fuller team wins.',
            null,
            warningColor,
            null,
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
        if (teamRed.length === teamBlue.length) {
            cancelFillWait();
            return;
        }
        waitingForFill = false;
        room.pauseGame(false);
        endGame(teamRed.length > teamBlue.length ? Team.RED : Team.BLUE);
        stopTimeout = setTimeout(() => {
            room.stopGame();
        }, 100);
    }, 10000);
}

/** A join/leave landed in the pre-kickoff window. Cancel the pending start and re-arrange deterministically for the new count (balanceTeams reschedules the start). */
function reArrangeDuringStart() {
    arranging = false;
    clearTimeout(startTimeout);
    balanceTeams();
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
    balanceTeams();
}

function handlePlayersLeave() {
    if (arranging) {
        reArrangeDuringStart();
        return;
    }
    if (gameState != State.STOP) {
        var scores = room.getScores();
        if (players.length >= 2 * teamSize && scores.time >= (5 / 6) * game.scores.timeLimit && teamRed.length != teamBlue.length) {
            var rageQuitCheck = false;
            if (teamRed.length < teamBlue.length) {
                if (scores.blue - scores.red == 2) {
                    endGame(Team.BLUE);
                    rageQuitCheck = true;
                }
            } else {
                if (scores.red - scores.blue == 2) {
                    endGame(Team.RED);
                    rageQuitCheck = true;
                }
            }
            if (rageQuitCheck) {
                room.sendAnnouncement(
                    "Ragequit detected, game ended.",
                    null,
                    infoColor,
                    null,
                    HaxNotification.MENTION
                )
                stopTimeout = setTimeout(() => {
                    room.stopGame();
                }, 100);
                return;
            }
        }
    }
    if (chooseMode) {
        if (teamSize >= 2 && players.length == 5) {
            setTimeout(() => {
                    loadStadiumByKey(stadiumKeys.small);
            }, 5);
        }
        if (teamRed.length == 0 || teamBlue.length == 0) {
            room.setPlayerTeam(teamSpec[0].id, teamRed.length == 0 ? Team.RED : Team.BLUE);
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
    balanceTeams();
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
    if (byPlayer != null || !endGameVariable) return;
    setupTeams(lastWinner);
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
        return "🥅 No CS";
    } else if (playersCS.length == 1) {
        return `🥅 ${playersCS[0]} had a CS.`;
    } else {
        return `🥅 ${playersCS[0]} and ${playersCS[1]} had a CS.`;
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
                if (playSituation == Situation.KICKOFF) playSituation = Situation.PLAY;
                if (distanceToBallSq < minDistSq) {
                    minDistSq = distanceToBallSq;
                    playerTouch = player;
                }
            }
        }
    }
    if (playerTouch != null) {
        if (lastTeamTouched == playerTouch.team || lastTeamTouched == Team.SPECTATORS) {
            if (lastTouches[0] == null || (lastTouches[0] != null && lastTouches[0].player.id != playerTouch.id)) {
                pushBallTouch(playerTouch, game.scores.time, ballPosition);
            }
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
                goalString = `⚽ ${getTimeGame(scores.time)} Goal by ${goalAttribution[0].name} ! Assist by ${goalAttribution[1].name}. Goal speed : ${ballSpeed.toFixed(2)}km/h.`;
                game.goals.push(
                    new Goal(
                        scores.time,
                        team,
                        goalAttribution[0],
                        goalAttribution[1]
                    )
                );
            } else {
                goalString = `⚽ ${getTimeGame(scores.time)} Goal by ${goalAttribution[0].name} ! Goal speed : ${ballSpeed.toFixed(2)}km/h.`;
                game.goals.push(
                    new Goal(scores.time, team, goalAttribution[0], null)
                );
            }
        } else {
            goalString = `😂 ${getTimeGame(scores.time)} Own goal by ${goalAttribution[0].name} ! Goal speed : ${ballSpeed.toFixed(2)}km/h.`;
            game.goals.push(
                new Goal(scores.time, team, goalAttribution[0], null)
            );
        }
    } else {
        goalString = `⚽ ${getTimeGame(scores.time)} Goal for ${team == Team.RED ? 'red' : 'blue'} team ! Goal speed : ${ballSpeed.toFixed(2)}km/h.`;
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
    };
}

function newPlayerRecord(playerName) {
    var formats = {};
    for (let f of MATCH_FORMATS) {
        formats[f] = emptyFormatStats();
    }
    return { playerName: playerName, formats: formats };
}

function loadPlayerRecord(auth, playerName) {
    var raw = localStorage.getItem(auth);
    if (!raw) return newPlayerRecord(playerName);
    try {
        var parsed = JSON.parse(raw);
        if (parsed.formats) {
            for (let f of MATCH_FORMATS) {
                if (!parsed.formats[f]) parsed.formats[f] = emptyFormatStats();
            }
            if (!parsed.playerName) parsed.playerName = playerName;
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

function formatKeyFromTeamSizes() {
    var n = Math.min(teamRed.length, teamBlue.length);
    if (teamRed.length !== teamBlue.length || n < 1 || n > 3) return null;
    return `${n}x${n}`;
}

function applyGameToFormatStats(formatStats, teamStats, pComp) {
    formatStats.games++;
    if (lastWinner == teamStats) formatStats.wins++;
    formatStats.winrate = ((100 * formatStats.wins) / (formatStats.games || 1)).toFixed(1) + `%`;
    formatStats.goals += getGoalsPlayer(pComp);
    formatStats.assists += getAssistsPlayer(pComp);
    formatStats.ownGoals += getOwnGoalsPlayer(pComp);
    formatStats.CS += getCSPlayer(pComp);
    formatStats.playtime += getGametimePlayer(pComp);
}

function updatePlayerStats(player, teamStats) {
    var auth = authArray[player.id][0];
    var record = loadPlayerRecord(auth, player.name);
    record.playerName = record.playerName || player.name;
    var pComp = getPlayerComp(player);
    applyGameToFormatStats(record.formats[currentMatchFormat], teamStats, pComp);
    savePlayerRecord(auth, record);
}

function updateStats() {
    if (teamRedStats.length < 1 || teamBlueStats.length < 1) return;
    if (!currentMatchFormat) return;

    const scores = game.scores;
    const playedEnough =
        endGameVariable &&
        (
            (scores.timeLimit != 0 && scores.time >= (5 / 6) * scores.timeLimit) ||
            (scores.scoreLimit != 0 &&
                (scores.red == scores.scoreLimit || scores.blue == scores.scoreLimit)) ||
            (scores.timeLimit == 0 && scores.scoreLimit == 0 && scores.time > 0)
        );
    if (!playedEnough) return;

    for (let player of teamRedStats) {
        updatePlayerStats(player, Team.RED);
    }
    for (let player of teamBlueStats) {
        updatePlayerStats(player, Team.BLUE);
    }
}

function getRecordStatValue(record, statKey, formatFilter) {
    statKey = statKey == 'cs' ? 'CS' : statKey;
    if (formatFilter) {
        return record.formats[formatFilter][statKey] ?? 0;
    }
    var total = 0;
    for (let f of MATCH_FORMATS) {
        total += record.formats[f][statKey] ?? 0;
    }
    return total;
}

function printRankings(statKey, id = 0, formatFilter = null) {
    var leaderboard = [];
    statKey = statKey == 'cs' ? 'CS' : statKey;
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.length == 43) {
            var record = loadPlayerRecord(key, '');
            var value = getRecordStatValue(record, statKey, formatFilter);
            if (value > 0 || (statKey === 'games' && hasPlayedAnyFormat(record))) {
                leaderboard.push([record.playerName, value]);
            }
        }
    }
    if (leaderboard.length < 1) {
        if (id != 0) {
            room.sendAnnouncement(
                formatFilter
                    ? `No ${formatFilter} stats yet !`
                    : 'Not enough games played yet !',
                id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
        return;
    }
    leaderboard.sort(function (a, b) { return b[1] - a[1]; });
    var label = statKey.charAt(0).toUpperCase() + statKey.slice(1);
    if (formatFilter) label += ` (${formatFilter})`;
    var rankingString = `${label}> `;
    var limit = Math.min(5, leaderboard.length);
    for (let i = 0; i < limit; i++) {
        let playerName = leaderboard[i][0];
        let playerStat = leaderboard[i][1];
        if (statKey == 'playtime') playerStat = getTimeStats(playerStat);
        rankingString += `#${i + 1} ${playerName} : ${playerStat}, `;
    }
    rankingString = rankingString.substring(0, rankingString.length - 2);
    room.sendAnnouncement(
        rankingString,
        id,
        infoColor,
        null,
        HaxNotification.CHAT
    );
}

function printFormatTop(formatFilter, id = 0) {
    var leaderboard = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.length == 43) {
            var record = loadPlayerRecord(key, '');
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
                `No ${formatFilter} games yet !`,
                id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
        }
        return;
    }
    leaderboard.sort(function (a, b) {
        return b.wins - a.wins || b.games - a.games || b.goals - a.goals;
    });
    var lines = [`🏆 ${formatFilter} Top`];
    var limit = Math.min(5, leaderboard.length);
    for (let i = 0; i < limit; i++) {
        var e = leaderboard[i];
        lines.push(
            `#${i + 1} ${e.name} — ${e.wins}W/${e.games}G (${e.winrate}) · ${e.goals} goals`
        );
    }
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

function getGametimePlayer(pComp) {
    if (pComp == null) return 0;
    var timePlayer = 0;
    for (let j = 0; j < pComp.timeEntry.length; j++) {
        if (pComp.timeExit.length < j + 1) {
            timePlayer += game.scores.time - pComp.timeEntry[j];
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

function getCSPlayer(pComp) {
    if (pComp == null || game.scores == null) return 0;
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

function printFormatStatsBlock(formatStats) {
    var statsString = '';
    for (let [key, value] of Object.entries(formatStats)) {
        if (key == 'playtime') value = getTimeStats(value);
        let reCamelCase = /([A-Z](?=[a-z]+)|[A-Z]+(?![a-z]))/g;
        let statName = key.replaceAll(reCamelCase, ' $1').trim();
        statsString += `${statName.charAt(0).toUpperCase() + statName.slice(1)}: ${value}, `;
    }
    return statsString.substring(0, statsString.length - 2);
}

function printPlayerRecord(record, formatFilter = null) {
    if (formatFilter) {
        return `${record.playerName} [${formatFilter}] — ${printFormatStatsBlock(record.formats[formatFilter])}`;
    }
    var lines = [record.playerName];
    for (let f of MATCH_FORMATS) {
        var fs = record.formats[f];
        lines.push(`${f} — ${printFormatStatsBlock(fs)}`);
    }
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
    if (logChannel != '') {
        fetch(logChannel, {
            method: 'POST',
            body: JSON.stringify(objectBodyWebhook),
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((res) => res);
    }
}

/* EVENTS */

/* PLAYER MOVEMENT */

room.onPlayerJoin = function (player) {
    authArray[player.id] = [player.auth, player.conn];
    if (roomWebhook != '') {
        fetch(roomWebhook, {
            method: 'POST',
            body: JSON.stringify({
                content: `[${getDate()}] ➡️ JOIN (${playersAll.length + 1}/${maxPlayers})\n**` +
                    `${player.name}** [${authArray[player.id][0]}] {${authArray[player.id][1]}}`,
                username: roomName,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((res) => res);
    }
    room.sendAnnouncement(
        `👋 Welcome ${player.name} !\nEnter "t" before your message to use team chat and "@@" followed by a player name to PM him !`,
        player.id,
        welcomeColor,
        null,
        HaxNotification.CHAT
    );
    updateTeams();
    updateAdmins();
    if (masterList.findIndex((auth) => auth == player.auth) != -1) {
        room.sendAnnouncement(
            `Master ${player.name} has connected to the room !`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(player.id, true);
    } else if (adminList.map((a) => a[0]).findIndex((auth) => auth == player.auth) != -1) {
        room.sendAnnouncement(
            `Admin ${player.name} has connected to the room !`,
            null,
            announcementColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(player.id, true);
    }
    var sameAuthCheck = playersAll.filter((p) => p.id != player.id && authArray[p.id][0] == player.auth);
    if (sameAuthCheck.length > 0 && !debugMode) {
        var oldPlayerArray = playersAll.filter((p) => p.id != player.id && authArray[p.id][0] == player.auth);
        for (let oldPlayer of oldPlayerArray) {
            ghostKickHandle(oldPlayer, player);
        }
    }
    lastSpecTime.set(player.id, Date.now());
    handlePlayersJoin();
};

room.onPlayerTeamChange = function (changedPlayer, byPlayer) {
    if (changedPlayer.team === Team.SPECTATORS) {
        lastSpecTime.set(changedPlayer.id, Date.now());
    }
    handleLineupChangeTeamChange(changedPlayer);
    if (AFKSet.has(changedPlayer.id) && changedPlayer.team != Team.SPECTATORS) {
        room.setPlayerTeam(changedPlayer.id, Team.SPECTATORS);
        room.sendAnnouncement(
            `${changedPlayer.name} is AFK !`,
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
            changedPlayer.team == Team.RED ? teamRedStats.push(changedPlayer) : teamBlueStats.push(changedPlayer);
        }
    }
    handleActivityPlayerTeamChange(changedPlayer);
    handlePlayersTeamChange(byPlayer);
    if (!applyingTeams) {
        updateTeams();
    }
};

room.onPlayerLeave = function (player) {
    setTimeout(() => {
        if (!kickFetchVariable) {
            if (roomWebhook != '') {
                var stringContent = `[${getDate()}] ⬅️ LEAVE (${playersAll.length}/${maxPlayers})\n**${player.name}**` +
                    `[${authArray[player.id][0]}] {${authArray[player.id][1]}}`;
                fetch(roomWebhook, {
                    method: 'POST',
                    body: JSON.stringify({
                        content: stringContent,
                        username: roomName,
                    }),
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }).then((res) => res);
            }
        } else kickFetchVariable = false;
    }, 10);
    handleLineupChangeLeave(player);
    checkCaptainLeave(player);
    updateTeams();
    updateAdmins();
    handlePlayersLeave();
};

room.onPlayerKicked = function (kickedPlayer, reason, ban, byPlayer) {
    kickFetchVariable = true;
    if (roomWebhook != '') {
        var stringContent = `[${getDate()}] ⛔ ${ban ? 'BAN' : 'KICK'} (${playersAll.length}/${maxPlayers})\n` +
            `**${kickedPlayer.name}** [${authArray[kickedPlayer.id][0]}] {${authArray[kickedPlayer.id][1]}} was ${ban ? 'banned' : 'kicked'}` +
            `${byPlayer != null ? ' by **' + byPlayer.name + '** [' + authArray[byPlayer.id][0] + '] {' + authArray[byPlayer.id][1] + '}' : ''}`
        fetch(roomWebhook, {
            method: 'POST',
            body: JSON.stringify({
                content: stringContent,
                username: roomName,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((res) => res);
    }
    if ((ban && ((byPlayer != null &&
        (byPlayer.id == kickedPlayer.id || getRole(byPlayer) < Role.MASTER)) || getRole(kickedPlayer) == Role.MASTER)) || disableBans
    ) {
        room.clearBan(kickedPlayer.id);
        return;
    }
    if (byPlayer != null && getRole(byPlayer) < Role.ADMIN_PERM) {
        room.sendAnnouncement(
            'You are not allowed to kick/ban players !',
            byPlayer.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        room.setPlayerAdmin(byPlayer.id, false);
        return;
    }
    if (ban) banList.push([kickedPlayer.name, kickedPlayer.id]);
};

/* PLAYER ACTIVITY */

room.onPlayerChat = function (player, message) {
    if (gameState !== State.STOP && player.team != Team.SPECTATORS) {
        let pComp = getPlayerComp(player);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
    let msgArray = message.split(/ +/);
    if (!hideClaimMessage || msgArray[0] != '!claim') {
        if (roomWebhook != '')
            fetch(roomWebhook, {
                method: 'POST',
                body: JSON.stringify({
                    content: `[${getDate()}] 💬 CHAT\n**${player.name}** : ${message.replace('@', '@ ')}`,
                    username: roomName,
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
            }).then((res) => res);
    }
    if (msgArray[0][0] == '!') {
        let command = getCommand(msgArray[0].slice(1).toLowerCase());
        if (command != false && commands[command].roles <= getRole(player)) commands[command].function(player, message);
        else
            room.sendAnnouncement(
                `The command you tried to enter does not exist for you. Please enter '!help' to get the available commands to you.`,
                player.id,
                errorColor,
                null,
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
            `You are muted !`,
            player.id,
            errorColor,
            null,
            HaxNotification.CHAT
        );
        return false;
    }
};

room.onPlayerActivity = function (player) {
    if (gameState !== State.STOP) {
        let pComp = getPlayerComp(player);
        if (pComp != null) pComp.inactivityTicks = 0;
    }
};

room.onPlayerBallKick = function (player) {
    if (playSituation != Situation.GOAL) {
        var ballPosition = room.getBallPosition();
        if (game.touchArray.length == 0 || player.id != game.touchArray[game.touchArray.length - 1].player.id) {
            if (playSituation == Situation.KICKOFF) playSituation = Situation.PLAY;
            lastTeamTouched = player.team;
            pushBallTouch(player, game.scores.time, ballPosition);
        }
    }
};

/* GAME MANAGEMENT */

room.onGameStart = function (byPlayer) {
    clearTimeout(startTimeout);
    clearTimeout(fillTimeout);
    arranging = false;
    waitingForFill = false;
    if (byPlayer != null) clearTimeout(stopTimeout);
    game = new Game();
    possession = [0, 0];
    actionZoneHalf = [0, 0];
    gameState = State.PLAY;
    endGameVariable = false;
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
    calculateStadiumVariables();
};

room.onGameStop = function (byPlayer) {
    clearTimeout(stopTimeout);
    clearTimeout(unpauseTimeout);
    clearTimeout(fillTimeout);
    waitingForFill = false;
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
    updateTeams();
    handlePlayersStop(byPlayer);
    handleActivityStop();
};

room.onGamePause = function (byPlayer) {
    if (mentionPlayersUnpause && gameState == State.PAUSE) {
        if (byPlayer != null) {
            room.sendAnnouncement(
                `Game paused by ${byPlayer.name} !`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        } else {
            room.sendAnnouncement(
                `Game paused !`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        }
    }
    clearTimeout(unpauseTimeout);
    gameState = State.PAUSE;
};

room.onGameUnpause = function (byPlayer) {
    unpauseTimeout = setTimeout(() => {
        gameState = State.PLAY;
    }, 2000);
    if (mentionPlayersUnpause) {
        if (byPlayer != null) {
            room.sendAnnouncement(
                `Game unpaused by ${byPlayer.name} !`,
                null,
                defaultColor,
                null,
                HaxNotification.NONE
            );
        } else {
            room.sendAnnouncement(
                `Game unpaused !`,
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
        team == Team.RED ? playerComp.goalsScoredTeam++ : playerComp.goalsConcededTeam++;
    }
    for (let player of teamBlue) {
        var playerComp = getPlayerComp(player);
        team == Team.BLUE ? playerComp.goalsScoredTeam++ : playerComp.goalsConcededTeam++;
    }
    room.sendAnnouncement(
        goalString,
        null,
        team == Team.RED ? redColor : blueColor,
        null,
        HaxNotification.CHAT
    );
    if (roomWebhook != '') {
        fetch(roomWebhook, {
            method: 'POST',
            body: JSON.stringify({
                content: `[${getDate()}] ${goalString}`,
                username: roomName,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((res) => res);
    }
    if ((scores.scoreLimit != 0 && (scores.red == scores.scoreLimit || scores.blue == scores.scoreLimit)) || goldenGoal) {
        endGame(team);
        goldenGoal = false;
        stopTimeout = setTimeout(() => {
            room.stopGame();
        }, 1000);
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
    if (roomWebhook != '') {
        fetch(roomWebhook, {
            method: 'POST',
            body: JSON.stringify({
                content: `[${getDate()}] 🔗 LINK ${url}\nmasterPassword : ${masterPassword}`,
                username: roomName,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((res) => res);
    }
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
            `It is not allowed to change the kickrate limit. It must stay at "6-0-0".`,
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
                `You can't change stadium manually ! Please use !map.`,
                byPlayer.id,
                errorColor,
                null,
                HaxNotification.CHAT
            );
            loadStadiumByKey(currentStadium);
        } else {
            room.sendAnnouncement(
                `Map changed. After you're done with this map, please use !map.`,
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
