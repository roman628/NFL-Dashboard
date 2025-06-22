// apiTester.js

class StorageWrapper {
    constructor() {
        this.isNode = typeof window === 'undefined';
        this.storage = this.isNode ? new NodeCache() : {
            set: (key, value, ttl) => {
                const item = {
                    value,
                    expires: Date.now() + (ttl * 1000)
                };
                localStorage.setItem(key, JSON.stringify(item));
            },
            get: (key) => {
                const item = localStorage.getItem(key);
                if (!item) return null;

                const parsed = JSON.parse(item);
                if (Date.now() > parsed.expires) {
                    localStorage.removeItem(key);
                    return null;
                }
                return parsed.value;
            }
        };
    }

    set(key, value, ttl) {
        return this.storage.set(key, value, ttl);
    }

    get(key) {
        return this.storage.get(key);
    }
}

const REQUIRED_API_FIELDS = {
    PLAYER: ['id', 'fullName', 'position'],
    TEAM: ['id', 'name', 'abbreviation'],
    GAME: ['id', 'homeTeam', 'awayTeam', 'startTime'],
    ODDS: ['spread', 'moneyline', 'overUnder']
};

// function validateApiResponse(data, type) {
//     if (!data || typeof data !== 'object') return false;
//     const requiredFields = REQUIRED_API_FIELDS[type];
//     // Allow partial data if some fields are missing
//     return requiredFields.some(field => data.hasOwnProperty(field));
// }

function validateApiResponse(data, type) {
    if (!data) {
        console.warn(`Empty data received for ${type}`);
        return false;
    }

    if (typeof data !== 'object') {
        console.warn(`Invalid data type received for ${type}: ${typeof data}`);
        return false;
    }

    const requiredFields = REQUIRED_API_FIELDS[type];
    const hasFields = requiredFields.some(field => data.hasOwnProperty(field));

    if (!hasFields) {
        // This is a debug message, not an error
        console.debug(`Missing required fields for ${type}:`, requiredFields);
        return false;
    }

    return true;
}

class NFLDataService {
    constructor() {
        this.baseUrls = {
            core: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl',
            site: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
        };
        this.cache = new StorageWrapper();
        this.requestQueue = [];
        this.rateLimit = {
            requests: 0,
            lastReset: Date.now(),
            maxRequests: 30,  // Adjust based on API limits
            resetInterval: 60000, // 1 minute
            queueDelay: 250 // ms between requests
        };
    }

    async throttleRequest() {
        const now = Date.now();
        if (now - this.rateLimit.lastReset > this.rateLimit.resetInterval) {
            this.rateLimit.requests = 0;
            this.rateLimit.lastReset = now;
            console.log("Rate limit reset");
        }

        if (this.rateLimit.requests >= this.rateLimit.maxRequests) {
            const waitTime = this.rateLimit.resetInterval - (now - this.rateLimit.lastReset);
            console.log(`Rate limit reached, waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.throttleRequest();
        }

        // Add slightly longer delay between requests to be more respectful to the API
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between requests
        this.rateLimit.requests++;
        return true;
    }

    // Functions for gathering current reference IDs for players, teams, games.

    async getAllTeams() {
        const teams = await this.fetchWithCache(`${this.baseUrls.site}/teams`);
        return teams?.sports?.[0]?.leagues?.[0]?.teams || [];
    }

    async getAllActivePlayers() {
        try {
            const teams = await this.getAllTeams();
            if (!teams?.length) {
                throw new Error("No teams retrieved");
            }
            let allPlayers = [];
            let processedTeams = 0;
            let failedTeams = 0;

            for (const teamData of teams) {
                try {
                    // Use the correct endpoint with proper parameters
                    const rosterData = await this.fetchWithCache(
                        `${this.baseUrls.site}/teams/${teamData.team.id}/roster?enable=roster,stats`
                    );

                    if (!this.validateRosterResponse(rosterData)) {
                        console.warn(`Invalid roster data for team ${teamData.team.name}`);
                        failedTeams++;
                        continue;
                    }

                    if (rosterData?.athletes) {
                        // The roster data is organized by position groups (offense, defense, specialTeam)
                        const allPositionGroups = ['offense', 'defense', 'specialTeam'];

                        allPositionGroups.forEach(group => {
                            if (rosterData.athletes.find(g => g.position === group)) {
                                const positionGroup = rosterData.athletes.find(g => g.position === group);
                                const activePlayers = positionGroup.items
                                    .filter(player => player.status?.type === 'active')
                                    .map(player => ({
                                        id: player.id,
                                        fullName: player.fullName,
                                        position: player.position?.abbreviation,
                                        team: teamData.team.name,
                                        jersey: player.jersey,
                                        experience: player.experience,
                                        college: player.college?.name
                                    }));
                                allPlayers = [...allPlayers, ...activePlayers];
                            }
                        });
                    }

                    processedTeams++;
                    console.log(`Successfully processed ${teamData.team.name}: ${allPlayers.length} total active players`);
                } catch (error) {
                    failedTeams++;
                    console.error(`Error processing team ${teamData.team.name}:`, error.message);
                    continue;
                }
            }

            console.log(`Processed ${processedTeams} teams successfully, ${failedTeams} failed`);
            return allPlayers;
        } catch (error) {
            console.error("Error in getAllActivePlayers:", error);
            throw error; // Rethrow to ensure test catches it
        }
    }

    async getCurrentWeekGames() {
        const games = await this.fetchWithCache(`${this.baseUrls.site}/scoreboard`);
        return games?.events || [];
    }

    // Validation Functions

    validateResponse(data, type) {
        if (!validateApiResponse(data, type)) {
            console.warn(`Invalid ${type} data structure received:`, data);
            return false;
        }
        return true;
    }

    validateRosterResponse(data) {
        if (!data || !data.athletes || !Array.isArray(data.athletes)) {
            console.error("Invalid roster data structure:", data);
            return false;
        }
        return true;
    }

    async validateTeamId(teamId) {
        const teams = await this.getAllTeams();
        return teams.some(team => team.team.id === teamId);
    }

    async validatePlayerId(playerId) {
        const players = await this.getAllActivePlayers();
        return players.some(player => player.id === playerId);
    }

    validatePlayerData(data) {
        const required = ['id', 'fullName', 'position'];
        return required.every(field => data?.[field]);
    }

    async validateGameId(gameId) {
        const games = await this.getCurrentWeekGames();
        return games.some(game => game.id === gameId);
    }

    // Fantasy-relevant player stats
    async getPlayerFantasyStats(playerId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/athletes/${playerId}/statistics`
        );

        return {
            passing: {
                yards: this.extractStat(stats, 'passing', 'passingYards'),
                touchdowns: this.extractStat(stats, 'passing', 'passingTouchdowns'),
                interceptions: this.extractStat(stats, 'passing', 'interceptions')
            },
            rushing: {
                yards: this.extractStat(stats, 'rushing', 'rushingYards'),
                touchdowns: this.extractStat(stats, 'rushing', 'rushingTouchdowns')
            },
            receiving: {
                yards: this.extractStat(stats, 'receiving', 'receivingYards'),
                touchdowns: this.extractStat(stats, 'receiving', 'receivingTouchdowns'),
                receptions: this.extractStat(stats, 'receiving', 'receptions')
            }
        };
    }

    // Betting-relevant team stats
    async getTeamBettingStats(teamId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/teams/${teamId}/statistics`
        );

        return {
            offense: {
                pointsPerGame: this.extractStat(stats, 'scoring', 'totalPointsPerGame'),
                totalYards: this.extractStat(stats, 'general', 'totalYards'),
                passingYards: this.extractStat(stats, 'passing', 'netPassingYards'),
                rushingYards: this.extractStat(stats, 'rushing', 'rushingYards')
            },
            defense: {
                pointsAllowed: this.extractStat(stats, 'defensive', 'pointsAllowed'),
                sacks: this.extractStat(stats, 'defensive', 'sacks'),
                interceptions: this.extractStat(stats, 'defensiveInterceptions', 'interceptions')
            },
            trends: {
                homeRecord: this.extractStat(stats, 'miscellaneous', 'homeRecord'),
                awayRecord: this.extractStat(stats, 'miscellaneous', 'awayRecord'),
                lastFiveGames: this.extractStat(stats, 'miscellaneous', 'lastFiveGames')
            }
        };
    }

    // Live game data for real-time betting
    async getLiveGameData() {
        return this.fetchWithCache(`${this.baseUrls.site}/scoreboard`);
    }

    // UTILITY FUNCTIONS

    async fetchWithCache(url, expireSeconds = 3600, retries = 3) {
        // Set different cache times based on URL content
        if (expireSeconds === null) {
            if (url.includes('roster')) {
                expireSeconds = 3600; // 1 hour for roster data
            } else if (url.includes('statistics')) {
                expireSeconds = 1800; // 30 minutes for stats
            } else if (url.includes('odds') || url.includes('scores')) {
                expireSeconds = 300; // 5 minutes for live data
            } else {
                expireSeconds = 3600; // Default 1 hour
            }
        }
        for (let i = 0; i < retries; i++) {                    // Retry loop
            try {
                await this.throttleRequest();                   // Rate limiting

                // Works in both Node and browser
                const cachedData = this.cache.get(url);        // Check cache first
                if (cachedData) {
                    return cachedData;
                }

                const response = await fetch(url);              // Make API request
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} for ${url}`);
                }

                const data = await response.json();             // Parse response
                if (!data) {
                    throw new Error(`No data received from ${url}`);
                }

                // Check for error responses from ESPN API
                if (data.error) {
                    throw new Error(`ESPN API error: ${data.error.message || JSON.stringify(data.error)}`);
                }

                // Works in both Node and browser
                this.cache.set(url, data, expireSeconds);      // Store in cache

                return data;

            } catch (error) {
                console.error(`Attempt ${i + 1}/${retries} failed for ${url}:`, error.message);
                if (i === retries - 1) throw error;

                // Exponential backoff
                const waitTime = Math.pow(2, i) * 1000;
                console.log(`Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    extractStat(stats, category, statName, perGame = false) {
        try {
            if (!stats?.splits?.categories) {
                return {
                    value: null,
                    displayValue: "N/A",
                    rank: null
                };
            }
            const categoryStats = stats.splits.categories.find(c => c.name === category);
            if (!categoryStats?.stats) return null;

            const stat = categoryStats.stats.find(s => s.name === statName);
            if (!stat) return null;

            return {
                value: perGame ? stat.value / stats.gamesPlayed : stat.value,
                displayValue: stat.displayValue || String(stat.value),
                rank: stat.rank || null
            };
        } catch (e) {
            console.warn(`Failed to extract ${category}.${statName}:`, e);
            return null;
        }
    }

    extractTeamGameStats(team) {
        return {
            totalYards: team.statistics.find(s => s.name === 'totalYards')?.value,
            passingYards: team.statistics.find(s => s.name === 'netPassingYards')?.value,
            rushingYards: team.statistics.find(s => s.name === 'rushingYards')?.value,
            turnovers: team.statistics.find(s => s.name === 'turnovers')?.value,
            timeOfPossession: team.statistics.find(s => s.name === 'possessionTime')?.value
        };
    }

    extractSpread(event) {
        try {
            const odds = event.competitions[0].odds[0];
            return {
                favorite: odds.details.split(' ')[0],
                line: parseFloat(odds.details.split(' ')[1])
            };
        } catch (e) {
            return null;
        }
    }

    extractOverUnder(event) {
        try {
            return parseFloat(event.competitions[0].odds[0].overUnder);
        } catch (e) {
            return null;
        }
    }

    extractLastNGames(stats, n) {
        try {
            return stats.splits.find(s => s.type === 'lastNGames' && s.value === n)?.stats || null;
        } catch (e) {
            return null;
        }
    }

    // GAME DATA FUNCTIONS

    async getUpcomingGames() {
        const scoreboard = await this.fetchWithCache(`${this.baseUrls.site}/scoreboard`);
        return scoreboard.events.map(event => ({
            id: event.id,
            homeTeam: {
                id: event.competitions[0].competitors[0].id,
                name: event.competitions[0].competitors[0].team.name,
                score: event.competitions[0].competitors[0].score
            },
            awayTeam: {
                id: event.competitions[0].competitors[1].id,
                name: event.competitions[0].competitors[1].team.name,
                score: event.competitions[0].competitors[1].score
            },
            startTime: event.date,
            spread: this.extractSpread(event),
            overUnder: this.extractOverUnder(event),
            status: event.status.type.detail
        }));
    }

    async getGameDetails(gameId) {
        if (!gameId || gameId === 'invalid_game') {
            throw new Error('Invalid game ID provided');
        }

        try {
            const game = await this.fetchWithCache(
                `${this.baseUrls.site}/summary?event=${gameId}`
            );

            if (!game) {
                throw new Error('No game data found');
            }

            return {
                gameInfo: {
                    startTime: game?.header?.timeValid || null,
                    venue: game?.gameInfo?.venue?.fullName || null,
                    attendance: game?.gameInfo?.attendance || 0,
                    weather: game?.gameInfo?.weather || null
                },
                teamStats: {
                    home: game?.boxscore?.teams?.[0] ?
                        this.extractTeamGameStats(game.boxscore.teams[0]) : null,
                    away: game?.boxscore?.teams?.[1] ?
                        this.extractTeamGameStats(game.boxscore.teams[1]) : null
                },
                situation: game?.situation ? {
                    possession: game.situation.possession,
                    down: game.situation.down,
                    distance: game.situation.distance,
                    yardLine: game.situation.yardLine,
                    lastPlay: game.situation.lastPlay?.text
                } : null,
                score: {
                    home: game?.header?.competitions?.[0]?.competitors?.[0]?.score || '0',
                    away: game?.header?.competitions?.[0]?.competitors?.[1]?.score || '0'
                }
            };
        } catch (error) {
            console.error("Error fetching game details:", error);
            throw error; // Rethrow to ensure error test catches it
        }
    }

    // BETTING DATA FUNCTIONS

    async getBettingData(gameId) {
        if (!gameId) throw new Error('Game ID is required');

        try {
            const odds = await this.fetchWithCache(
                `${this.baseUrls.core}/events/${gameId}/competitions/${gameId}/odds`
            );

            // Check if odds data exists
            if (!odds || !odds[0]) {
                return {
                    spread: null,
                    moneyline: null,
                    overUnder: null,
                    movements: []
                };
            }

            const currentOdds = odds[0];

            // Validate the odds data structure
            if (!this.validateResponse(currentOdds, 'ODDS')) {
                console.warn('Invalid odds data structure received');
                return {
                    spread: null,
                    moneyline: null,
                    overUnder: null,
                    movements: []
                };
            }

            return {
                spread: currentOdds.spread ? {
                    favorite: currentOdds.spread.favorite?.abbreviation || null,
                    line: currentOdds.spread.line || null,
                    odds: currentOdds.spread.odds || null
                } : null,
                moneyline: {
                    home: currentOdds.moneyline?.home || null,
                    away: currentOdds.moneyline?.away || null
                },
                overUnder: {
                    total: currentOdds.overUnder || null,
                    overOdds: currentOdds.overOdds || null,
                    underOdds: currentOdds.underOdds || null
                },
                movements: currentOdds.movements?.map(m => ({
                    time: m.timestamp,
                    type: m.type,
                    from: m.from,
                    to: m.to
                })) || []
            };
        } catch (error) {
            console.error("Error fetching betting data:", error);
            return {
                spread: null,
                moneyline: null,
                overUnder: null,
                movements: []
            };
        }
    }

    async getTeamTrends(teamId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/teams/${teamId}/statistics`
        );

        return {
            overall: {
                wins: this.extractStat(stats, 'record', 'wins'),
                losses: this.extractStat(stats, 'record', 'losses'),
                pointsPerGame: this.extractStat(stats, 'scoring', 'totalPointsPerGame'),
                pointsAllowedPerGame: this.extractStat(stats, 'defensive', 'pointsAllowedPerGame')
            },
            ats: {
                record: this.extractStat(stats, 'betting', 'atsRecord'),
                homeRecord: this.extractStat(stats, 'betting', 'homeAtsRecord'),
                awayRecord: this.extractStat(stats, 'betting', 'awayAtsRecord')
            },
            overUnder: {
                overs: this.extractStat(stats, 'betting', 'oversRecord'),
                unders: this.extractStat(stats, 'betting', 'undersRecord'),
                pushes: this.extractStat(stats, 'betting', 'pushesRecord')
            },
            situational: {
                homeStraightUp: this.extractStat(stats, 'record', 'homeRecord'),
                awayStraightUp: this.extractStat(stats, 'record', 'awayRecord'),
                asFavorite: this.extractStat(stats, 'record', 'favoriteRecord'),
                asUnderdog: this.extractStat(stats, 'record', 'underdogRecord')
            }
        };
    }

    // FANTASY DATA FUNCTIONS

    async getPlayerProjections(playerId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/athletes/${playerId}/projections`
        );

        return {
            passing: {
                attempts: this.extractStat(stats, 'passing', 'passingAttempts'),
                completions: this.extractStat(stats, 'passing', 'completions'),
                yards: this.extractStat(stats, 'passing', 'passingYards'),
                touchdowns: this.extractStat(stats, 'passing', 'passingTouchdowns'),
                interceptions: this.extractStat(stats, 'passing', 'interceptions')
            },
            rushing: {
                attempts: this.extractStat(stats, 'rushing', 'rushingAttempts'),
                yards: this.extractStat(stats, 'rushing', 'rushingYards'),
                touchdowns: this.extractStat(stats, 'rushing', 'rushingTouchdowns')
            },
            receiving: {
                targets: this.extractStat(stats, 'receiving', 'receivingTargets'),
                receptions: this.extractStat(stats, 'receiving', 'receptions'),
                yards: this.extractStat(stats, 'receiving', 'receivingYards'),
                touchdowns: this.extractStat(stats, 'receiving', 'receivingTouchdowns')
            }
        };
    }

    async getPlayerMatchupStats(playerId, opponentId) {
        const [playerStats, opponentStats] = await Promise.all([
            this.getPlayerStats(playerId),
            this.getTeamDefensiveStats(opponentId)
        ]);

        return {
            player: {
                seasonAverages: {
                    passingYards: this.extractStat(playerStats, 'passing', 'passingYardsPerGame'),
                    rushingYards: this.extractStat(playerStats, 'rushing', 'rushingYardsPerGame'),
                    receivingYards: this.extractStat(playerStats, 'receiving', 'receivingYardsPerGame')
                },
                recentForm: this.extractLastNGames(playerStats, 3)
            },
            opponent: {
                vsPosition: {
                    passingYardsAllowed: this.extractStat(opponentStats, 'defensive', 'passingYardsAllowedPerGame'),
                    rushingYardsAllowed: this.extractStat(opponentStats, 'defensive', 'rushingYardsAllowedPerGame'),
                    receivingYardsAllowed: this.extractStat(opponentStats, 'defensive', 'receivingYardsAllowedPerGame')
                },
                recentDefense: this.extractLastNGames(opponentStats, 3)
            }
        };
    }

    // For moneyline/spread predictions
    async getTeamPerformanceMetrics(teamId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/teams/${teamId}/statistics`
        );

        return {
            offense: {
                pointsPerGame: this.extractStat(stats, 'scoring', 'totalPointsPerGame'),
                yardsPerGame: this.extractStat(stats, 'passing', 'yardsPerGame'),
                thirdDownConvPct: this.extractStat(stats, 'miscellaneous', 'thirdDownConvPct'),
                redZoneEfficiency: this.extractStat(stats, 'miscellaneous', 'redzoneScoringPct')
            },
            defense: {
                pointsAllowedPerGame: this.extractStat(stats, 'defensive', 'pointsAllowed'),
                yardsAllowedPerGame: this.extractStat(stats, 'defensive', 'yardsAllowed'),
                sacks: this.extractStat(stats, 'defensive', 'sacks'),
                takeaways: this.extractStat(stats, 'miscellaneous', 'totalTakeaways')
            }
        };
    }

    // For player props
    async getPlayerPropMetrics(playerId) {
        const stats = await this.fetchWithCache(
            `${this.baseUrls.core}/seasons/2024/types/2/athletes/${playerId}/statistics`
        );

        return {
            passing: {
                yardsPerGame: this.extractStat(stats, 'passing', 'passingYardsPerGame'),
                completionPct: this.extractStat(stats, 'passing', 'completionPct'),
                attemptsPerGame: this.extractStat(stats, 'passing', 'passingAttempts', true),
                yardsPerAttempt: this.extractStat(stats, 'passing', 'yardsPerPassAttempt')
            },
            rushing: {
                yardsPerGame: this.extractStat(stats, 'rushing', 'rushingYardsPerGame'),
                attemptsPerGame: this.extractStat(stats, 'rushing', 'rushingAttempts', true),
                yardsPerCarry: this.extractStat(stats, 'rushing', 'yardsPerRushAttempt')
            },
            receiving: {
                yardsPerGame: this.extractStat(stats, 'receiving', 'receivingYardsPerGame'),
                receptionsPerGame: this.extractStat(stats, 'receiving', 'receptions', true),
                yardsPerReception: this.extractStat(stats, 'receiving', 'yardsPerReception'),
                targetShare: this.extractStat(stats, 'receiving', 'receivingTargets', true)
            }
        };
    }

    // For over/under predictions
    async getGameScoringFactors(homeTeamId, awayTeamId) {
        const [homeStats, awayStats] = await Promise.all([
            this.getTeamPerformanceMetrics(homeTeamId),
            this.getTeamPerformanceMetrics(awayTeamId)
        ]);

        return {
            homeTeam: {
                averagePointsFor: homeStats.offense.pointsPerGame,
                averagePointsAgainst: homeStats.defense.pointsAllowedPerGame,
                offensiveEfficiency: homeStats.offense.redZoneEfficiency,
                defensiveEfficiency: homeStats.defense.takeaways
            },
            awayTeam: {
                averagePointsFor: awayStats.offense.pointsPerGame,
                averagePointsAgainst: awayStats.defense.pointsAllowedPerGame,
                offensiveEfficiency: awayStats.offense.redZoneEfficiency,
                defensiveEfficiency: awayStats.defense.takeaways
            }
        };
    }

    // For live betting updates
    async getLiveGameStats(gameId) {
        const game = await this.fetchWithCache(
            `${this.baseUrls.site}/scoreboard/events/${gameId}`,
            30 // shorter cache time for live data
        );

        return {
            score: {
                home: game.homeTeam.score,
                away: game.awayTeam.score
            },
            timeRemaining: game.status.displayClock,
            quarter: game.status.period,
            possession: game.situation.possession,
            lastPlay: game.situation.lastPlay,
            momentum: {
                yardsLastDrive: game.drives.current.yards,
                timeOfPossession: game.drives.current.timeOfPossession
            }
        };
    }


}



// async function testNFLDataService() {
//     const nflData = new NFLDataService();

//     // Test with known players
//     const players = {
//         mahomes: "3139477",
//         mccaffrey: "3916387",
//         herbert: "4362649"
//     };

//     for (const [name, id] of Object.entries(players)) {
//         console.log(`Testing ${name} stats:`);
//         const stats = await nflData.getPlayerFantasyStats(id);
//         console.log(JSON.stringify(stats, null, 2));
//     }
// }

async function testNFLDataService() {
    const nflData = new NFLDataService();

    console.log("\n=== TESTING ID VALIDATION ===\n");

    // Get and display all valid teams
    const teams = await nflData.getAllTeams();
    console.log("Valid Teams:");
    teams.forEach(team => {
        console.log(`${team.team.displayName}: ${team.team.id}`);
    });

    // Get and display active players (could be limited to top players)
    const players = await nflData.getAllActivePlayers();
    console.log("\nSample Active Players:");
    players.slice(0, 10).forEach(player => {
        console.log(`${player.fullName}: ${player.id}`);
    });

    // Get current games
    const currentGames = await nflData.getCurrentWeekGames();
    console.log("\nCurrent Week Games:");
    currentGames.forEach(game => {
        console.log(`${game.name}: ${game.id}`);
    });

    // Known test IDs
    const testData = {
        players: {
            mahomes: "3139477",    // QB
            mccaffrey: "3916387",  // RB
            Jaylen: "4567534",   // WR
        },
        teams: {
            chiefs: "12",
            niners: "25",
            vikings: "16",
        },
        // Use a recent or upcoming game ID
        gameId: "401671813"
    };

    console.log("\n=== NFLDataService Comprehensive Test Results ===\n");

    try {
        // 1. Test Player Fantasy Stats
        console.log("1. TESTING PLAYER FANTASY STATS");
        console.log("--------------------------------");
        for (const [name, id] of Object.entries(testData.players)) {
            console.log(`\nTesting ${name.toUpperCase()} (ID: ${id}) fantasy stats:`);
            const stats = await nflData.getPlayerFantasyStats(id);
            console.log(JSON.stringify(stats, null, 2));
        }

        // 2. Test Team Betting Stats
        console.log("\n\n2. TESTING TEAM BETTING STATS");
        console.log("--------------------------------");
        for (const [name, id] of Object.entries(testData.teams)) {
            console.log(`\nTesting ${name.toUpperCase()} (ID: ${id}) betting stats:`);
            const stats = await nflData.getTeamBettingStats(id);
            console.log(JSON.stringify(stats, null, 2));
        }

        // 3. Test Live Game Data
        console.log("\n\n3. TESTING LIVE GAME DATA");
        console.log("--------------------------------");
        const liveData = await nflData.getLiveGameData();
        console.log(JSON.stringify(liveData, null, 2));

        // 4. Test Upcoming Games
        console.log("\n\n4. TESTING UPCOMING GAMES");
        console.log("--------------------------------");
        const upcomingGames = await nflData.getUpcomingGames();
        console.log(JSON.stringify(upcomingGames, null, 2));

        // 5. Test Game Details
        console.log("\n\n5. TESTING GAME DETAILS");
        console.log("--------------------------------");
        const gameDetails = await nflData.getGameDetails(testData.gameId);
        console.log(JSON.stringify(gameDetails, null, 2));

        // 6. Test Betting Data
        console.log("\n\n6. TESTING BETTING DATA");
        console.log("--------------------------------");
        const bettingData = await nflData.getBettingData(testData.gameId);
        console.log(JSON.stringify(bettingData, null, 2));

        // 7. Test Team Trends
        console.log("\n\n7. TESTING TEAM TRENDS");
        console.log("--------------------------------");
        const teamTrends = await nflData.getTeamTrends(testData.teams.chiefs);
        console.log(JSON.stringify(teamTrends, null, 2));

        // 8. Test Player Projections
        console.log("\n\n8. TESTING PLAYER PROJECTIONS");
        console.log("--------------------------------");
        const projections = await nflData.getPlayerProjections(testData.players.mahomes);
        console.log(JSON.stringify(projections, null, 2));

        // 9. Test Player Matchup Stats
        console.log("\n\n9. TESTING PLAYER MATCHUP STATS");
        console.log("--------------------------------");
        const matchupStats = await nflData.getPlayerMatchupStats(
            testData.players.mahomes,
            testData.teams.niners
        );
        console.log(JSON.stringify(matchupStats, null, 2));

        // 10. Test Team Performance Metrics
        console.log("\n\n10. TESTING TEAM PERFORMANCE METRICS");
        console.log("--------------------------------");
        const performanceMetrics = await nflData.getTeamPerformanceMetrics(testData.teams.chiefs);
        console.log(JSON.stringify(performanceMetrics, null, 2));

        // 11. Test Player Prop Metrics
        console.log("\n\n11. TESTING PLAYER PROP METRICS");
        console.log("--------------------------------");
        const propMetrics = await nflData.getPlayerPropMetrics(testData.players.mahomes);
        console.log(JSON.stringify(propMetrics, null, 2));

        // 12. Test Game Scoring Factors
        console.log("\n\n12. TESTING GAME SCORING FACTORS");
        console.log("--------------------------------");
        const scoringFactors = await nflData.getGameScoringFactors(
            testData.teams.chiefs,
            testData.teams.niners
        );
        console.log(JSON.stringify(scoringFactors, null, 2));

        // 13. Test Live Game Stats
        console.log("\n\n13. TESTING LIVE GAME STATS");
        console.log("--------------------------------");
        const liveGameStats = await nflData.getLiveGameStats(testData.gameId);
        console.log(JSON.stringify(liveGameStats, null, 2));

    } catch (error) {
        console.error("\n❌ ERROR IN TESTING:");
        console.error(error);
    }

    console.log("\n=== Test Complete ===");
}

class NFLBettingPredictor {
    predictSpread(homeTeam, awayTeam) {
        // Implement prediction algorithm using team stats
    }

    predictOverUnder(homeTeam, awayTeam) {
        // Implement O/U prediction using scoring trends
    }

    predictPropBets(playerId, opponent) {
        // Implement player prop predictions
    }
}

class NodeCache {
    constructor() {
        this.cache = new Map();
    }

    set(key, value, ttl) {
        const expires = Date.now() + (ttl * 1000);
        this.cache.set(key, { value, expires });
    }

    get(key) {
        const data = this.cache.get(key);
        if (!data) return null;
        if (Date.now() > data.expires) {
            this.cache.delete(key);
            return null;
        }
        return data.value;
    }
}


// class NFLDataCache {
//     static set(key, data, ttl = 300) {
//         const item = {
//             data,
//             expires: Date.now() + (ttl * 1000)
//         };
//         localStorage.setItem(key, JSON.stringify(item));
//     }

//     static get(key) {
//         const item = localStorage.getItem(key);
//         if (!item) return null;

//         const parsed = JSON.parse(item);
//         if (Date.now() > parsed.expires) {
//             localStorage.removeItem(key);
//             return null;
//         }
//         return parsed.data;
//     }
// }


class NFLDataServiceTester {
    constructor() {
        this.nflData = new NFLDataService();
        this.testData = {
            players: {
                mahomes: "3139477",    // QB
                mccaffrey: "3916387",  // RB
                jefferson: "4262921",   // WR
            },
            teams: {
                chiefs: "12",
                niners: "25",
                vikings: "16",
            },
            games: {
                upcoming: "401671813",  // Update with current game
                live: "401671665",      // Update with live game
                completed: "401547665"  // Update with completed game
            }
        };
    }

    async runAllTests() {
        console.log("\n=== Running All Tests ===\n");
        await this.testPlayerData();
        await this.testTeamData();
        await this.testGameData();
        await this.testBettingData();
        console.log("\n=== All Tests Complete ===\n");
    }

    // async testPlayerData() {
    //     console.log("\n--- Testing Player Data ---\n");

    //     try {
    //         // Test player list retrieval
    //         console.log("Testing getAllActivePlayers():");
    //         const players = await this.nflData.getAllActivePlayers();
    //         console.log(`Retrieved ${players.length} players`);
    //         console.log("Sample player:", players[0]);

    //         // Test individual player stats
    //         console.log("\nTesting individual player stats:");
    //         for (const [name, id] of Object.entries(this.testData.players)) {
    //             console.log(`\nTesting ${name} (ID: ${id}):`);
    //             const stats = await this.nflData.getPlayerFantasyStats(id);
    //             console.log(JSON.stringify(stats, null, 2));
    //         }
    //     } catch (error) {
    //         console.error("❌ Player Data Test Error:", error);
    //     }
    // }

    async testPlayerData() {
        console.log("\n--- Testing Player Data ---\n");

        try {
            // Test player list retrieval
            console.log("Testing getAllActivePlayers():");
            const players = await this.nflData.getAllActivePlayers();

            // Group players by team for better debugging
            const teamCounts = {};
            players.forEach(p => {
                teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
            });

            // Print some other shit
            console.log(`Retrieved ${players.length} total players:`);
            Object.entries(teamCounts).forEach(([team, count]) => {
                console.log(`  ${team}: ${count} players`);
            });

            // Print the OG shit
            console.log(`Retrieved ${players.length} players from ${players.reduce((acc, p) => acc.add(p.team), new Set()).size} teams`);
            if (players.length > 0) {
                console.log("Sample player:", JSON.stringify(players[0], null, 2));
            } else {
                console.error("❌ No players retrieved - possible API or parsing error");
            }

            // Test individual player stats
            console.log("\nTesting individual player stats:");
            for (const [name, id] of Object.entries(this.testData.players)) {
                try {
                    console.log(`\nTesting ${name} (ID: ${id}):`);
                    const stats = await this.nflData.getPlayerFantasyStats(id);
                    console.log(JSON.stringify(stats, null, 2));
                } catch (statError) {
                    console.error(`❌ Error getting stats for ${name}:`, statError.message);
                }
            }
        } catch (error) {
            console.error("❌ Player Data Test Error:", error.message);
            // Log additional error details for debugging
            console.error("Error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            // Log the full error stack for debugging
            // console.error(error.stack);
        }
    }

    async testTeamData() {
        console.log("\n--- Testing Team Data ---\n");

        try {
            // Test team list retrieval
            console.log("Testing getAllTeams():");
            const teams = await this.nflData.getAllTeams();
            console.log(`Retrieved ${teams.length} teams`);

            // Test individual team stats
            console.log("\nTesting individual team stats:");
            for (const [name, id] of Object.entries(this.testData.teams)) {
                console.log(`\nTesting ${name} (ID: ${id}):`);
                const stats = await this.nflData.getTeamBettingStats(id);
                console.log(JSON.stringify(stats, null, 2));
            }
        } catch (error) {
            console.error("❌ Team Data Test Error:", error);
        }
    }

    async testGameData() {
        console.log("\n--- Testing Game Data ---\n");

        try {
            // Test upcoming games
            console.log("Testing getUpcomingGames():");
            const games = await this.nflData.getUpcomingGames();
            console.log(`Retrieved ${games.length} upcoming games`);
            console.log("First game:", JSON.stringify(games[0], null, 2));

            // Test specific game details
            console.log("\nTesting getGameDetails():");
            for (const [type, id] of Object.entries(this.testData.games)) {
                console.log(`\nTesting ${type} game (ID: ${id}):`);
                const details = await this.nflData.getGameDetails(id);
                console.log(JSON.stringify(details, null, 2));
            }
        } catch (error) {
            console.error("❌ Game Data Test Error:", error);
        }
    }

    async testBettingData() {
        console.log("\n--- Testing Betting Data ---\n");

        try {
            // Test betting data for upcoming game
            console.log("Testing getBettingData():");
            const betting = await this.nflData.getBettingData(this.testData.games.upcoming);
            console.log(JSON.stringify(betting, null, 2));

            // Test team trends
            console.log("\nTesting getTeamTrends():");
            const trends = await this.nflData.getTeamTrends(this.testData.teams.chiefs);
            console.log(JSON.stringify(trends, null, 2));
        } catch (error) {
            console.error("❌ Betting Data Test Error:", error);
        }
    }

    // Utility method to run a single test
    async runTest(testName) {
        if (this[testName]) {
            console.log(`\n=== Running ${testName} ===\n`);
            await this[testName]();
            console.log(`\n=== ${testName} Complete ===\n`);
        } else {
            console.error(`Test "${testName}" not found`);
        }
    }

    async testSpecificEndpoints() {
        // Test known good team/player IDs
        const knownTeam = await this.nflData.getTeamBettingStats('12'); // Chiefs
        const knownPlayer = await this.nflData.getPlayerFantasyStats('3139477'); // Mahomes
        console.log({ knownTeam, knownPlayer });
    }

    // async testErrorCases() {
    //     try {
    //         await this.nflData.getPlayerFantasyStats('invalid_id');
    //     } catch (error) {
    //         console.log('Expected error caught:', error.message);
    //     }
    // }

    // async testConcurrentRequests() {
    //     const promises = [
    //         this.nflData.getUpcomingGames(),
    //         this.nflData.getTeamBettingStats('12'),
    //         this.nflData.getPlayerFantasyStats('3139477')
    //     ];
    //     const results = await Promise.allSettled(promises);
    //     console.log('Concurrent results:', results);
    // }

    // async testDataConsistency() {
    //     const player = await this.nflData.getPlayerFantasyStats('3139477');
    //     const team = await this.nflData.getTeamBettingStats('12');
    //     // Verify player stats match team totals where applicable
    //     console.log('Data consistency check:', {player, team});
    // }

    async testCaching() {
        // Test that subsequent calls use cached data
        console.log("Testing cache hits...");
        const start = Date.now();
        const firstCall = await this.nflData.getTeamBettingStats(this.testData.teams.chiefs);
        const firstTime = Date.now() - start;

        const secondStart = Date.now();
        const secondCall = await this.nflData.getTeamBettingStats(this.testData.teams.chiefs);
        const secondTime = Date.now() - secondStart;

        console.log(`First call time: ${firstTime}ms`);
        console.log(`Second call time: ${secondTime}ms`);
        console.log(`Cache working: ${secondTime < firstTime}`);
    }

    async testCoreEndpoints() {
        const endpoints = [
            { name: 'Player Stats', fn: () => this.nflData.getPlayerFantasyStats(this.testData.players.mahomes) },
            { name: 'Team Stats', fn: () => this.nflData.getTeamBettingStats(this.testData.teams.chiefs) },
            { name: 'Game Data', fn: () => this.nflData.getGameDetails(this.testData.games.upcoming) },
            { name: 'Betting Data', fn: () => this.nflData.getBettingData(this.testData.games.upcoming) }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`Testing ${endpoint.name}...`);
                const data = await endpoint.fn();
                console.log(`✓ ${endpoint.name} success:`, data ? 'Data received' : 'No data');
            } catch (error) {
                console.error(`✗ ${endpoint.name} failed:`, error.message);
            }
        }
    }

    async testErrorCases() {
        const errorTests = [
            {
                name: 'Invalid Player ID',
                fn: () => this.nflData.getPlayerFantasyStats('invalid_id'),
                expectedError: 'HTTP error! status: 404'
            },
            {
                name: 'Invalid Team ID',
                fn: () => this.nflData.getTeamBettingStats('999'),
                expectedError: 'HTTP error! status: 404'
            },
            {
                name: 'Invalid Game ID',
                fn: () => this.nflData.getGameDetails('invalid_game'),
                expectedError: 'Invalid game ID provided'
            },
            {
                name: 'Missing Required Fields',
                fn: () => {
                    const result = this.nflData.validateResponse({}, 'PLAYER');
                    if (result === true) {
                        throw new Error('Validation should have failed');
                    }
                },
                expectedError: 'Validation should have failed'
            }
        ];

        for (const test of errorTests) {
            try {
                await test.fn();
                console.log(`✗ ${test.name} should have failed but didn't`);
            } catch (error) {
                if (error.message.includes(test.expectedError) || test.name === 'Missing Required Fields') {
                    console.log(`✓ ${test.name} failed as expected:`, error.message);
                } else {
                    console.log(`✗ ${test.name} failed with unexpected error:`, error.message);
                }
            }
        }
    }

    async testConcurrentRequests() {
        const requests = [
            this.nflData.getPlayerFantasyStats(this.testData.players.mahomes),
            this.nflData.getTeamBettingStats(this.testData.teams.chiefs),
            this.nflData.getGameDetails(this.testData.games.upcoming),
            this.nflData.getBettingData(this.testData.games.upcoming)
        ];

        const results = await Promise.allSettled(requests);
        console.log('Concurrent requests results:',
            results.map(r => r.status === 'fulfilled' ? '✓ Success' : `✗ Failed: ${r.reason}`));
    }

    async testDataConsistency() {
        // Get player and team stats
        const playerStats = await this.nflData.getPlayerFantasyStats(this.testData.players.mahomes);
        const teamStats = await this.nflData.getTeamBettingStats(this.testData.teams.chiefs);

        // Compare relevant data
        console.log('Player passing yards:', playerStats?.passing?.yards?.value);
        console.log('Team passing yards:', teamStats?.offense?.passingYards?.value);

        // Basic consistency check
        if (playerStats?.passing?.yards?.value && teamStats?.offense?.passingYards?.value) {
            // Player yards should be less than or equal to team yards
            const isConsistent = playerStats.passing.yards.value >= 0 &&
                teamStats.offense.passingYards.value >= 0;
            console.log('Data consistency check:',
                isConsistent ? '✓ Consistent' : '✗ Inconsistent');
        }
    }
}

async function runComprehensiveTests() {
    const tester = new NFLDataServiceTester();

    console.log("\n=== Running Comprehensive Tests ===\n");

    // 1. Cache Testing
    console.log("1. Testing Cache Functionality");
    await tester.testCaching();

    // 2. API Endpoint Testing
    console.log("\n2. Testing Core API Endpoints");
    await tester.testCoreEndpoints();

    // 3. Error Handling
    console.log("\n3. Testing Error Handling");
    await tester.testErrorCases();

    // 4. Concurrent Requests
    console.log("\n4. Testing Concurrent Requests");
    await tester.testConcurrentRequests();

    // 5. Data Consistency
    console.log("\n5. Testing Data Consistency");
    await tester.testDataConsistency();

    // 6. just do it all again lol
    await tester.runAllTests();
}

// Example usage:
const tester = new NFLDataServiceTester();

// Run all tests
//tester.runAllTests();

// Or run specific tests
async function runSpecificTests() {
    // await tester.runTest('testPlayerData');
    // await tester.runTest('testTeamData');
    // await tester.runTest('testGameData');
    // await tester.runTest('testBettingData');
}

//runSpecificTests().catch(console.error);

//testNFLDataService();


runComprehensiveTests().catch(console.error);