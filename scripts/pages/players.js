// pages/players.js
import NFLDataService from '../core/api.js';
import StorageManager from '../core/storage.js';
import { formatters, createElement, clearElement, handleError, sortBy, showLoading, hideLoading, updateFooter } from '../core/utils.js';

class PlayersManager {
    constructor() {
        this.api = new NFLDataService();
        this.storage = new StorageManager();
        this.players = [];
        this.filters = {
            position: 'ALL',
            team: 'ALL',
            search: ''
        };
        this.cacheKey = 'players_data';
    }

    async init() {
        this.setupEventListeners();
        await this.loadPlayers();
    }

    cleanup() {
        const searchInput = document.getElementById('player-search');
        if (searchInput) {
            searchInput.removeEventListener('input', this.handleSearch);
        }
        // Clear filter event listeners
        ['position-filter', 'team-filter', 'sort-options'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.replaceWith(element.cloneNode(true));
            }
        });
    }

    setupEventListeners() {
        document.getElementById('player-search')?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.renderPlayers();
        });

        document.getElementById('position-filter')?.addEventListener('change', (e) => {
            this.filters.position = e.target.value;
            this.renderPlayers();
        });

        document.getElementById('team-filter')?.addEventListener('change', (e) => {
            this.filters.team = e.target.value;
            this.renderPlayers();
        });

        document.getElementById('sort-options')?.addEventListener('change', (e) => {
            this.renderPlayers(e.target.value);
        });
    }

    async loadPlayers() {
        try {
            showLoading();
    
            // Attempt to load from cache
            const cachedPlayers = await this.storage.getCache(this.cacheKey);
            const container = document.getElementById('players-container');
            clearElement(container); // Clear previous content
    
            if (cachedPlayers) {
                // Render cached players incrementally
                cachedPlayers.forEach(player => {
                    const playerCard = this.createPlayerCard(player);
                    container.appendChild(playerCard);
                });
    
                this.players = cachedPlayers;
                updateFooter('Loaded players from cache.');
            } else {
                // Fetch from API if cache is unavailable
                const players = await this.api.getAllActivePlayers();
                this.players = [];
                
                // Render each player as they load and enhance them
                for (const player of players) {
                    const enhancedPlayer = await this.enhancePlayerWithStats(player);
                    this.players.push(enhancedPlayer);
    
                    // Render incrementally
                    const playerCard = this.createPlayerCard(enhancedPlayer);
                    container.appendChild(playerCard);
                }
    
                // Cache the players' data
                await this.storage.setCache(this.cacheKey, this.players, 86400); // Cache for 1 day
                updateFooter('Player data loaded successfully.');
            }
        } catch (error) {
            handleError(error, 'loadPlayers');
            updateFooter(`Error loading players: ${error.message}`);
        } finally {
            hideLoading();
        }
    }
    

    async enhancePlayerWithStats(player) {
        try {
            const stats = await this.api.getPlayerFantasyStats(player.id);
            return {
                ...player,
                fantasyStats: stats,
                fantasyPoints: this.calculateFantasyPoints(stats)
            };
        } catch (error) {
            console.warn(`Failed to load stats for player ${player.id}`, error);
            return player;
        }
    }
    

    calculateFantasyPoints(stats) {
        if (!stats) return 0;
        return (
            (stats.passing?.yards?.value || 0) * 0.04 +
            (stats.passing?.touchdowns?.value || 0) * 4 +
            (stats.rushing?.yards?.value || 0) * 0.1 +
            (stats.rushing?.touchdowns?.value || 0) * 6 +
            (stats.receiving?.receptions?.value || 0) * 1 +
            (stats.receiving?.yards?.value || 0) * 0.1 +
            (stats.receiving?.touchdowns?.value || 0) * 6
        );
    }

    filterPlayers() {
        return this.players.filter(player => {
            const matchesPosition = this.filters.position === 'ALL' || player.position === this.filters.position;
            const matchesTeam = this.filters.team === 'ALL' || player.team === this.filters.team;
            const matchesSearch = player.fullName.toLowerCase().includes(this.filters.search.toLowerCase());

            return matchesPosition && matchesTeam && matchesSearch;
        });
    }

    renderPlayers(sortKey = 'fantasyPoints') {
        const container = document.getElementById('players-container');
        if (!container) return;

        clearElement(container);

        const filteredPlayers = this.filterPlayers();
        const sortedPlayers = sortBy(filteredPlayers, sortKey, true);

        sortedPlayers.forEach(player => {
            const playerCard = this.createPlayerCard(player);
            container.appendChild(playerCard);
        });
    }

    createPlayerCard(player) {
        const card = createElement('div', 'player-card');
        const playerHeadshot = player.headshot || `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${player.id}.png&h=150&w=150&scale=crop`;

        card.innerHTML = `
            <div class="player-header">
                <img src="${playerHeadshot}" alt="${player.fullName}" class="player-image">
                <h3>${player.fullName}</h3>
                <div class="player-position">${player.position}</div>
                <div class="player-team">${player.team}</div>
            </div>
            <div class="player-stats">
                <div class="stat">
                    <label>Fantasy Points</label>
                    <value>${player.fantasyPoints?.toFixed(1)}</value>
                </div>
                ${this.getPositionSpecificStats(player)}
            </div>
            <div class="player-actions">
                <button onclick="playersManager.addToLineup(${player.id})" class="add-to-lineup">Add to Lineup</button>
                <button onclick="playersManager.showPlayerDetails(${player.id})" class="view-details">View Details</button>
            </div>
        `;

        return card;
    }

    getPositionSpecificStats(player) {
        const stats = player.fantasyStats;
        if (!stats) return '';

        switch (player.position) {
            case 'QB':
                return `
                    <div class="stat"><label>Pass Yards</label><value>${stats.passing?.yards?.value || 0}</value></div>
                    <div class="stat"><label>Pass TD</label><value>${stats.passing?.touchdowns?.value || 0}</value></div>`;
            case 'RB':
                return `
                    <div class="stat"><label>Rush Yards</label><value>${stats.rushing?.yards?.value || 0}</value></div>
                    <div class="stat"><label>Rush TD</label><value>${stats.rushing?.touchdowns?.value || 0}</value></div>`;
            case 'WR':
            case 'TE':
                return `
                    <div class="stat"><label>Receptions</label><value>${stats.receiving?.receptions?.value || 0}</value></div>
                    <div class="stat"><label>Rec Yards</label><value>${stats.receiving?.yards?.value || 0}</value></div>`;
            default:
                return '';
        }
    }

    addToLineup(playerId) {
        window.lineupManager.addPlayer(playerId);
    }
}

export default PlayersManager;
