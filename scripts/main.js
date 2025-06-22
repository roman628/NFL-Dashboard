// main.js
import { showLoading, hideLoading, updateFooter } from './core/utils.js';

class App {
    constructor() {
        this.currentPage = document.body.dataset.page;
        this.activeManager = null;
    }

    async init() {
        try {
            showLoading();

            // Cleanup previous manager if it exists
            if (this.activeManager?.cleanup) {
                this.activeManager.cleanup();
            }

            // Initialize the appropriate manager based on current page
            switch (this.currentPage) {
                case 'dashboard':
                    const { default: DashboardManager } = await import('./pages/dashboard.js');
                    this.activeManager = new DashboardManager();
                    await this.activeManager.init();
                    break;

                case 'players':
                    const { default: PlayersManager } = await import('./pages/players.js');
                    this.activeManager = new PlayersManager();
                    window.playersManager = this.activeManager; 
                    await this.activeManager.init();
                    break;

                case 'teams':
                    const { default: TeamsManager } = await import('./pages/teams.js');
                    this.activeManager = new TeamsManager();
                    await this.activeManager.init();
                    break;

                case 'lineups':
                    // const { default: LineupManager } = await import('./pages/lineups.js');
                    // this.activeManager = new LineupManager();
                    // await this.activeManager.init();
                    // break;
                    const { default: LineupManager } = await import('./pages/lineups.js');
                    this.activeManager = new LineupManager();
                    window.lineupManager = this.activeManager;
                    await this.activeManager.init();
                    break;

                default:
                    console.warn('No matching page found for:', this.currentPage);
            }

            updateFooter(`${this.currentPage} page initialized successfully`);

        } catch (error) {
            console.error('Error initializing page:', error);
            updateFooter(`Error initializing page: ${error.message}`);
        } finally {
            hideLoading();
        }
    }
}

// Initialize app on page load
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});