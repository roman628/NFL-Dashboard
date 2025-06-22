// pages/teams.js
import NFLDataService from '../core/api.js';
import StorageManager from '../core/storage.js';
import { formatters, createElement, clearElement, handleError, sortBy, showLoading, hideLoading, updateFooter } from '../core/utils.js';

class TeamsManager {
    constructor() {
        this.api = new NFLDataService();
        this.storage = new StorageManager();
        this.teams = [];
        this.filters = {
            division: 'ALL',
            conference: 'ALL',
            search: ''
        };
        // this.init(); let main.js do this.
    }

    async init() {
        this.setupEventListeners();
        await this.loadTeams();
    }

    cleanup() {
        // Similar to players.js
        ['conference-filter', 'division-filter', 'sort-options'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.replaceWith(element.cloneNode(true));
            }
        });
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }

    setupEventListeners() {
        // Search input
        document.getElementById('team-search')?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.renderTeams();
        });
    
        // Conference filter
        document.getElementById('conference-filter')?.addEventListener('change', (e) => {
            this.filters.conference = e.target.value;
            this.renderTeams();
        });
    
        // Division filter
        document.getElementById('division-filter')?.addEventListener('change', (e) => {
            this.filters.division = e.target.value;
            this.renderTeams();
        });
    
        // Sort options
        document.getElementById('sort-options')?.addEventListener('change', (e) => {
            const sortKey = e.target.value;
            this.renderTeams(sortKey);
        });
    }
    

    async loadTeams() {
        try {
            showLoading();
            const teams = await this.api.getAllTeams();
            this.teams = await this.enhanceTeamsWithStats(teams);
            this.renderTeams();
            updateFooter('Team data loaded successfully');
        } catch (error) {
            handleError(error, 'loadTeams');
            updateFooter(`Error loading teams: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    async enhanceTeamsWithStats(teams) {
        const currentYear = new Date().getFullYear();
        const seasonType = 2; // Regular season
        // Hardcoded division and conference mapping
        const divisionConferenceMap = {
            "1": { division: "South", conference: "NFC" },
            "2": { division: "East", conference: "AFC" },
            "3": { division: "North", conference: "NFC" },
            "4": { division: "North", conference: "AFC" },
            "5": { division: "North", conference: "AFC" },
            "6": { division: "East", conference: "NFC" },
            "7": { division: "West", conference: "AFC" },
            "8": { division: "North", conference: "NFC" },
            "9": { division: "North", conference: "NFC" },
            "10": { division: "South", conference: "AFC" },
            "11": { division: "South", conference: "AFC" },
            "12": { division: "West", conference: "AFC" },
            "13": { division: "West", conference: "AFC" },
            "14": { division: "West", conference: "NFC" },
            "15": { division: "East", conference: "AFC" },
            "16": { division: "North", conference: "NFC" },
            "17": { division: "East", conference: "AFC" },
            "18": { division: "South", conference: "NFC" },
            "19": { division: "East", conference: "NFC" },
            "20": { division: "East", conference: "AFC" },
            "21": { division: "East", conference: "NFC" },
            "22": { division: "West", conference: "NFC" },
            "23": { division: "North", conference: "AFC" },
            "24": { division: "West", conference: "AFC" },
            "25": { division: "West", conference: "NFC" },
            "26": { division: "West", conference: "NFC" },
            "27": { division: "South", conference: "NFC" },
            "28": { division: "East", conference: "NFC" },
            "29": { division: "South", conference: "NFC" },
            "30": { division: "South", conference: "AFC" },
            "33": { division: "North", conference: "AFC" },
            "34": { division: "South", conference: "AFC" }
        };
        const upcomingGames = await this.api.getUpcomingGames();
        upcomingGames.forEach(game => {
            const homeTeamId = game.homeTeam.id;
            const awayTeamId = game.awayTeam.id;
    
            if (!upcomingGames[homeTeamId]) {
                upcomingGames[homeTeamId] = game;
            }
            if (!upcomingGames[awayTeamId]) {
                upcomingGames[awayTeamId] = game;
            }
        });
    
        return Promise.all(teams.map(async teamData => {
            const team = teamData.team;
            const teamId = team.id;
    
            try {
                // Fetch team betting stats and ATS data
                const [stats, atsDataResponse] = await Promise.all([
                  this.api.getTeamBettingStats(teamId),
                  fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2023/types/${seasonType}/teams/${teamId}/ats`),
                ]);
          
                const atsData = await atsDataResponse.json();
          
                // Find the overall ATS record
                const atsOverallItem = atsData?.items?.find(item => item.type?.name === 'atsOverall');
          
                // Extract ATS Record
                const atsWins = atsOverallItem?.wins || 0;
                const atsLosses = atsOverallItem?.losses || 0;
                const atsPushes = atsOverallItem?.pushes || 0;
                console.log('atsWins: ' + atsWins);
                console.log('atsLosses: ' + atsLosses);
                console.log('atsPushes: ' + atsPushes);

                // Fetch the record details from the record endpoint (existing code)
                const recordResponse = await fetch(
                    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${currentYear}/types/${seasonType}/teams/${teamId}/record`
                );
                const recordData = await recordResponse.json();
    
                // Locate the "overall" record
                const overallRecord = recordData.items.find((record) => record.name === 'overall');
    
                // Extract wins, losses, and ties
                const winsStat = overallRecord?.stats.find(stat => stat.name === 'wins');
                const lossesStat = overallRecord?.stats.find(stat => stat.name === 'losses');
                const tiesStat = overallRecord?.stats.find(stat => stat.name === 'ties');
    
                const wins = winsStat?.value || 0;
                const losses = lossesStat?.value || 0;
                const ties = tiesStat?.value || 0;
    
                const totalGames = wins + losses + ties;
                const winPercentage = totalGames > 0 ? wins / totalGames : 0;
    
                // Extract points per game from stats
                const pointsPerGame = stats?.offense?.pointsPerGame?.value || 0;
    
                // Get division and conference
                const division = divisionConferenceMap[teamId]?.division || 'Unknown';
                const conference = divisionConferenceMap[teamId]?.conference || 'Unknown';
    
                // Get the team's upcoming game
                const upcomingGame = upcomingGames[teamId];
    
                // Extract Over/Under value
                const overUnder = upcomingGame ? upcomingGame.overUnder : null;
    
                return {
                    ...teamData,
                    team: {
                    ...team,
                    wins,
                    losses,
                    ties,
                    division,
                    conference,
                    overUnder,
                    atsWins,
                    atsLosses,
                    atsPushes,
                    },
                    winPercentage,
                    pointsPerGame,
                    stats,
                };
            } catch (error) {
                console.warn(`Failed to load stats for team ${team.id}`, error);
                return {
                    ...teamData,
                    team: {
                        ...team,
                        wins: 0,
                        losses: 0,
                        ties: 0,
                        division: divisionConferenceMap[team.id]?.division || 'Unknown',
                        conference: divisionConferenceMap[team.id]?.conference || 'Unknown',
                        overUnder: null,
                    },
                    winPercentage: 0,
                    pointsPerGame: 0,
                    atsWins: 0,
                    atsLosses: 0,
                    atsPushes: 0,
                    stats: {},
                };
            }
        }));
    }
    
    
    

    filterTeams() {
        return this.teams.filter(team => {
            const matchesConference = this.filters.conference === 'ALL' || 
                                      team.team.conference === this.filters.conference;
            const matchesDivision = this.filters.division === 'ALL' || 
                                    team.team.division === this.filters.division;
            const matchesSearch = team.team.name.toLowerCase()
                                    .includes(this.filters.search.toLowerCase());
    
            return matchesConference && matchesDivision && matchesSearch;
        });
    }
    

    renderTeams(sortKey = 'winPercentage') {
        const container = document.getElementById('teams-container');
        if (!container) return;
    
        clearElement(container);
    
        const filteredTeams = this.filterTeams();
    
        const sortedTeams = sortBy(
            filteredTeams,
            (team) => {
                switch (sortKey) {
                    case 'winPercentage':
                        return team.winPercentage;
                    case 'pointsPerGame':
                        return team.pointsPerGame;
                    case 'atsRecord':
                        const atsWins = team.team.atsWins || 0;
                        const atsLosses = team.team.atsLosses || 0;
                        const atsPushes = team.team.atsPushes || 0;
                        const atsTotalGames = atsWins + atsLosses + atsPushes;
                        const atsWinPercentage =
                            atsTotalGames > 0 ? (atsWins + 0.5 * atsPushes) / atsTotalGames : 0;
                        return atsWinPercentage;
                    case 'overUnder':
                        return team.team.overUnder || 0; // Default to 0 if no Over/Under value
                    default:
                        return 0; // Default fallback
                }
            },
            true // Descending order
        );
    
        sortedTeams.forEach((team) => {
            const teamCard = this.createTeamCard(team);
            container.appendChild(teamCard);
        });
    }
    
    
    
    

    createTeamCard(team) {
        const card = createElement('div', 'team-card');
      
        card.innerHTML = `
          <div class="team-header">
            <img src="${team.team.logos?.[0]?.href || 'images/genericLogo.jpg'}" 
                 alt="${team.team.name} logo" 
                 class="team-logo">
            <h3>${team.team.name}</h3>
            <div class="team-record">${this.formatRecord(team)}</div>
          </div>
          <div class="team-stats">
            <div class="stat-column">
              <div class="stat">
                <label>Division</label>
                <value>${team.team.conference} ${team.team.division}</value>
              </div>
              <div class="stat">
                <label>Points Per Game</label>
                <value>${team.pointsPerGame.toFixed(1)}</value>
              </div>
            </div>
            <div class="stat-column">
              <div class="stat">
                <label>ATS Record</label>
                <value>${this.formatAtsRecord(team.team)}</value>
              </div>
              <div class="stat">
                <label>Over/Under</label>
                <value>${team.team.overUnder ? `O/U ${team.team.overUnder}` : 'N/A'}</value>
              </div>
            </div>
          </div>
          <div class="team-actions">
            <button onclick="teamsManager.showTeamSchedule(${team.team.id})" class="view-schedule">
              View Schedule
            </button>
            <button onclick="teamsManager.showTeamDetails(${team.team.id})" class="view-details">
              View Details
            </button>
          </div>
        `;
      
        return card;
      }
    

    formatRecord(team) {
        const wins = team.team.wins || 0;
        const losses = team.team.losses || 0;
        const ties = team.team.ties || 0;
        return `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}`;
    }
    

    formatAtsRecord(team) {
        const wins = team.atsWins || 0;
        const losses = team.atsLosses || 0;
        const pushes = team.atsPushes || 0;
        return `${wins}-${losses}${pushes > 0 ? `-${pushes}` : ''} ATS`;
      }

    formatOverUnder(trends) {
        const overs = trends?.overUnder?.overs?.value || 0;
        const unders = trends?.overUnder?.unders?.value || 0;
        return `O/U: ${overs}-${unders}`;
    }

    renderBettingTrends(trends) {
        if (!trends) return 'No trend data available';

        return `
            <div class="trends-grid">
                <div class="trend">
                    <label>Home</label>
                    <value>${trends.situational?.homeStraightUp?.value || '0-0'}</value>
                </div>
                <div class="trend">
                    <label>Away</label>
                    <value>${trends.situational?.awayStraightUp?.value || '0-0'}</value>
                </div>
                <div class="trend">
                    <label>As Favorite</label>
                    <value>${trends.situational?.asFavorite?.value || '0-0'}</value>
                </div>
                <div class="trend">
                    <label>As Underdog</label>
                    <value>${trends.situational?.asUnderdog?.value || '0-0'}</value>
                </div>
            </div>
        `;
    }

    showTeamSchedule(teamId) {
        window.location.href = `schedule.html?team=${teamId}`;
    }

    showTeamDetails(teamId) {
        window.location.href = `teamCard.html?id=${teamId}`;
    }
}

export default TeamsManager;