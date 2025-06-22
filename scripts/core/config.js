// config.js
const CONFIG = {
    API: {
        BASE_URL: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl',
        SITE_URL: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl',
        RATE_LIMIT: 30,
        RATE_INTERVAL: 60000
    },
    CACHE: {
        DURATIONS: {
            LIVE: 60,     // 1 minute
            STATS: 3600,  // 1 hour
            STATIC: 86400 // 24 hours
        }
    },
    UI: {
        MAX_DISPLAY: {
            TEAMS: 5,
            PLAYERS: 5
        },
        UPDATE_INTERVALS: {
            LIVE: 30000,    // 30 seconds
            DASHBOARD: 300000 // 5 minutes
        }
    },
    SCORING: {
        PPR: {
            PASS_YD: 0.04,
            PASS_TD: 4,
            INT: -2,
            RUSH_YD: 0.1,
            RUSH_TD: 6,
            REC: 1,
            REC_YD: 0.1,
            REC_TD: 6,
            FUMBLE: -2
        }
    }
};

export default CONFIG;