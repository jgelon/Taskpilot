import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CreateTaskComponent } from './components/create-task/create-task.component';
import { TaskListComponent } from './components/task-list/task-list.component';
import { GetTaskComponent } from './components/get-task/get-task.component';
import { SettingsComponent } from './components/settings/settings.component';
import { GamificationComponent } from './components/gamification/gamification.component';
import { ProfileComponent } from './components/profile/profile.component';
import { AuthService } from './services/auth.service';
import { TaskService, TaskStats } from './services/task.service';
import { PushService } from './services/push.service';
import { OAuthService } from 'angular-oauth2-oidc';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

type View = 'home' | 'create' | 'list' | 'get' | 'gamification';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CreateTaskComponent, TaskListComponent, GetTaskComponent, SettingsComponent, GamificationComponent, ProfileComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  currentView: View = 'home';
  settingsOpen = false;
  profileOpen = false;
  stats: TaskStats | null = null;
  statsLoading = true;
  window = window;
  gamToast: { points: number; newAchievements: any[] } | null = null;
  private sub: Subscription | null = null;

  constructor(
    public auth: AuthService,
    private taskService: TaskService,
    private oauthService: OAuthService,
    private pushService: PushService
  ) {}

  ngOnInit() {
    if (this.auth.isLoggedIn) {
      this.loadStats();
      this.pushService.init();
    }
    this.sub = this.oauthService.events
      .pipe(filter(e => e.type === 'token_received' || e.type === 'token_refreshed'))
      .subscribe(() => { this.loadStats(); this.pushService.init(); });

    // Seed an initial history entry so the very first back press goes home
    // rather than leaving the app
    history.replaceState({ view: 'home', settings: false }, '');

    // Handle browser/OS back button
    window.addEventListener('popstate', this.onPopState);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    window.removeEventListener('popstate', this.onPopState);
  }

  // Arrow function so `this` is bound correctly when used as an event listener
  private onPopState = (event: PopStateEvent) => {
    const state: { view: View; settings: boolean } = event.state || { view: 'home', settings: false };

    // Close settings panel first if open — don't change the view yet
    if (this.settingsOpen) {
      this.settingsOpen = false;
      // Push a new entry so the next back press goes to the view behind settings
      history.pushState({ view: this.currentView, settings: false }, '');
      return;
    }

    this.currentView = state.view ?? 'home';
    this.settingsOpen = state.settings ?? false;

    if (this.currentView === 'home') this.loadStats();
  };

  loadStats() {
    this.statsLoading = true;
    this.taskService.getStats().subscribe({
      next: s => { this.stats = s; this.statsLoading = false; },
      error: () => { this.statsLoading = false; }
    });
  }

  get claimedTask() { return this.stats?.claimedTask ?? null; }

  get anyGamificationEnabled() {
    const f = this.auth.features;
    return f.points || f.streaks || f.achievements || f.leaderboard;
  }

  setView(view: View) {
    const wasHome = this.currentView === 'home' && !this.settingsOpen;

    this.settingsOpen = false;

    if (view === 'home') {
      // Going home — pop back to root state (don't push)
      this.currentView = 'home';
      history.replaceState({ view: 'home', settings: false }, '');
      this.loadStats();
      return;
    }

    // Push a new history entry for non-home views
    // so back button returns to the previous state
    if (!wasHome) {
      history.pushState({ view: this.currentView, settings: false }, '');
    }
    this.currentView = view;
    history.pushState({ view, settings: false }, '');
  }

  openSettings() {
    history.pushState({ view: this.currentView, settings: true }, '');
    this.settingsOpen = true;
  }

  openProfile() {
    history.pushState({ view: this.currentView, settings: false }, '');
    this.profileOpen = true;
  }

  onTaskChanged() { this.loadStats(); }

  onTaskClosed(gamResult: any) {
    if (!gamResult) return;
    this.loadStats();
    if (this.auth.features.points || this.auth.features.achievements) {
      this.gamToast = { points: gamResult.points, newAchievements: gamResult.newlyEarned || [] };
      setTimeout(() => this.gamToast = null, 4000);
    }
  }
}
