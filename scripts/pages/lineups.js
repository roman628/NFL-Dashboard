// pages/lineups.js
import NFLDataService from '../core/api.js';
import StorageManager from '../core/storage.js';
import { formatters, createElement, clearElement, handleError, sortBy, showLoading, hideLoading, updateFooter } from '../core/utils.js';

class LineupManager {
    constructor() {
        this.api = new NFLDataService();
        this.storage = new StorageManager();
        this.currentLineup = [];
        this.maxPlayers = 8; // Standard fantasy lineup size
        this.positions = {
            QB: { max: 1, label: 'Quarterback' },
            RB: { max: 2, label: 'Running Back' },
            WR: { max: 2, label: 'Wide Receiver' },
            TE: { max: 1, label: 'Tight End' },
            FLEX: { max: 1, label: 'Flex (RB/WR/TE)' },
            DST: { max: 1, label: 'Defense/Special Teams' }
        };
        this.availablePlayers = [];
        // this.init(); let main.js do this
    }

    async init() {
        this.setupEventListeners();
        await this.loadAvailablePlayers();
        await this.loadSavedLineup();
        this.renderLineup();
    }

    renderLineup() {
        const container = document.getElementById('lineup-container');
        container.innerHTML = this.currentLineup.map(player => `
            <div class="player-card">
                <h3>${player.fullName}</h3>
                <p>${player.position} - ${player.team}</p>
                <button onclick="lineupManager.removePlayer('${player.id}')">Remove</button>
            </div>
        `).join('');
    }

    addToLineup(playerId) {
        window.lineupManager.addPlayer(playerId);
    }

    async addPlayer(playerId) {
        if (this.currentLineup.length >= this.maxPlayers) {
            alert('Lineup full');
            return;
        }
    
        const players = await this.api.getAllActivePlayers();
        const player = players.find(p => p.id === playerId);
        
        if (!player) {
            console.error('Player not found:', playerId);
            return;
        }
    
        this.currentLineup.push(player);
        await this.storage.setCache('current_lineup', this.currentLineup);
        this.renderLineup();
    }

    removePlayer(playerId) {
        this.currentLineup = this.currentLineup.filter(p => p.id !== playerId);
        this.storage.setCache('current_lineup', this.currentLineup);
        this.renderLineup();
    }

    clearLineup() {
        this.currentLineup = [];
        this.storage.setCache('current_lineup', []);
        this.renderLineup();
    }

    cleanup() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        // Remove drag-drop listeners if implemented
        const lineupContainer = document.getElementById('lineup-container');
        if (lineupContainer) {
            lineupContainer.replaceWith(lineupContainer.cloneNode(true));
        }
    }

    exportLineup() {
        const blob = new Blob([JSON.stringify(this.currentLineup)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lineup.json';
        a.click();
    }
    
    importLineup(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentLineup = JSON.parse(e.target.result);
            this.renderLineup();
        };
        reader.readAsText(file);
    }
    
    clearData() {
        this.storage.clearAllData();
        this.currentLineup = {};
        this.renderLineup();
    }

    setupEventListeners() {
        document.querySelector('.lineup-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveLineup();
        });
        
        document.querySelector('[data-action="clear"]')?.addEventListener('click', () => 
            this.clearLineup());
        
        document.querySelector('[data-action="export"]')?.addEventListener('click', () => 
            this.exportLineup());
        
        document.querySelector('[data-action="import"]')?.addEventListener('change', (e) => 
            this.importLineup(e.target.files[0]));
            
        document.querySelector('[data-action="reset-all"]')?.addEventListener('click', () => {
            if(confirm('Are you sure you want to reset all data?')) {
                this.clearData();
            }
        });

        document.querySelectorAll('.add-player-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerId = e.target.dataset.playerId;
                this.addPlayer(playerId);
            });
        });
    }

    async loadAvailablePlayers() {
        try {
            showLoading();
            const players = await this.api.getAllActivePlayers();
            console.log('Got the players, enhancing with projections');
            //this.availablePlayers = await this.enhancePlayersWithProjections(players);
            //console.log('the projections finished so whats wrong?');
            this.updatePositionDropdowns();
            updateFooter('Available players loaded successfully');
        } catch (error) {
            handleError(error, 'loadAvailablePlayers');
            updateFooter(`Error loading players: ${error.message}`);
        } finally {
            hideLoading();
        }
    }

    async enhancePlayersWithProjections(players) {
        return Promise.all(players.map(async player => {
            try {
                // Use 2023 season instead of 2024
                const stats = await this.api.getPlayerFantasyStats(player.id); 
                return {
                    ...player,
                    projectedPoints: this.calculateProjectedPoints(stats) // Use actual stats as projection
                };
            } catch (error) {
                console.warn(`Using base player data for ${player.id}`);
                return player;
            }
        }));
    }

    calculateProjectedPoints(projections) {
        if (!projections) return 0;

        // PPR scoring
        return (
            (projections.passing?.yards?.value || 0) * 0.04 +
            (projections.passing?.touchdowns?.value || 0) * 4 +
            (projections.rushing?.yards?.value || 0) * 0.1 +
            (projections.rushing?.touchdowns?.value || 0) * 6 +
            (projections.receiving?.receptions?.value || 0) * 1 +
            (projections.receiving?.yards?.value || 0) * 0.1 +
            (projections.receiving?.touchdowns?.value || 0) * 6
        );
    }

    async loadSavedLineup() {
        const savedLineup = await this.storage.getCache('current_lineup');
        if (savedLineup) {
            this.currentLineup = savedLineup;
        }
    }

    saveLineup() {
        if (!this.validateLineup()) {
            alert('Please fill all required positions');
            return;
        }
        this.storage.saveLineup(this.currentLineup);
        alert('Lineup saved successfully!');
    }

    validateLineup() {
        return Object.entries(this.currentLineup).every(([position, player]) => {
            if (position !== 'FLEX') {
                return player !== null;
            }
            return true;
        });
    }

    async optimizeLineup() {
        try {
            const optimal = await this.api.getOptimalLineup();
            this.currentLineup = optimal;
            this.renderLineup();
            alert('Lineup optimized based on projections!');
        } catch (error) {
            handleError(error, 'optimizeLineup');
            alert('Failed to optimize lineup. Please try again.');
        }
    }

    // clearLineup() {
    //     this.currentLineup = Object.keys(this.currentLineup).reduce((acc, pos) => {
    //         acc[pos] = null;
    //         return acc;
    //     }, {});
    //     this.renderLineup();
    // }

    updatePosition(position, playerId) {
        if (playerId === '') {
            this.currentLineup[position] = null;
        } else {
            const player = this.availablePlayers.find(p => p.id === playerId);
            this.currentLineup[position] = player;
        }
        this.renderLineup();
    }

    updatePositionDropdowns() {
        Object.keys(this.currentLineup).forEach(position => {
            const select = document.getElementById(`${position}-select`);
            if (!select) return;

            clearElement(select);

            // Add empty option
            const emptyOption = createElement('option', '', '-- Select Player --');
            emptyOption.value = '';
            select.appendChild(emptyOption);

            // Add available players for position
            this.getEligiblePlayers(position).forEach(player => {
                const option = createElement('option', '', player.fullName);
                option.value = player.id;
                if (this.currentLineup[position]?.id === player.id) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        });
    }

    getEligiblePlayers(position) {
        if (position === 'FLEX') {
            return this.availablePlayers.filter(p => 
                ['RB', 'WR', 'TE'].includes(p.position) &&
                !Object.values(this.currentLineup).some(player => player?.id === p.id)
            );
        }

        return this.availablePlayers.filter(p => 
            p.position === position &&
            !Object.values(this.currentLineup).some(player => player?.id === p.id)
        );
    }

    // renderLineup() {
    //     const container = document.getElementById('lineup-container');
    //     if (!container) return;

    //     clearElement(container);

    //     // Render each position
    //     Object.entries(this.positions).forEach(([pos, info]) => {
    //         const positionElement = this.createPositionElement(pos, info);
    //         container.appendChild(positionElement);
    //     });

    //     // Update total projected points
    //     this.updateProjectedPoints();
    // }

    createPositionElement(position, info) {
        const element = createElement('div', 'position-slot');
        
        const players = position === 'RB' || position === 'WR' 
            ? [this.currentLineup[`${position}1`], this.currentLineup[`${position}2`]]
            : [this.currentLineup[position]];

        element.innerHTML = `
            <div class="position-header">
                <h4>${info.label}</h4>
                <span class="max-players">(Max: ${info.max})</span>
            </div>
            ${players.map((player, index) => `
                <div class="player-slot">
                    ${player ? this.renderPlayer(player) : 'Empty Slot'}
                    <select id="${position}${index + 1}-select" class="player-select">
                        <!-- Options populated by updatePositionDropdowns -->
                    </select>
                </div>
            `).join('')}
        `;

        return element;
    }

    renderPlayer(player) {
        return `
            <div class="selected-player">
                <img src="${player.headshot || 'images/genericProfilePic.jpg'}" 
                     alt="${player.fullName}" 
                     class="player-image">
                <div class="player-info">
                    <div class="player-name">${player.fullName}</div>
                    <div class="player-details">
                        ${player.team} - ${player.position}
                    </div>
                    <div class="projected-points">
                        Projected: ${player.projectedPoints?.toFixed(1) || '0.0'}
                    </div>
                </div>
            </div>
        `;
    }

    updateProjectedPoints() {
        const totalPoints = Object.values(this.currentLineup)
            .reduce((total, player) => {
                return total + (player?.projectedPoints || 0);
            }, 0);

        const pointsElement = document.getElementById('total-projected-points');
        if (pointsElement) {
            pointsElement.textContent = `Total Projected Points: ${totalPoints.toFixed(1)}`;
        }
    }
}



export default LineupManager;
