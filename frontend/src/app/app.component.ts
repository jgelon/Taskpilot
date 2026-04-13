import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CreateTaskComponent } from './components/create-task/create-task.component';
import { TaskListComponent } from './components/task-list/task-list.component';
import { GetTaskComponent } from './components/get-task/get-task.component';
import { SettingsComponent } from './components/settings/settings.component';
import { GamificationComponent } from './components/gamification/gamification.component';
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
  imports: [CommonModule, CreateTaskComponent, TaskListComponent, GetTaskComponent, SettingsComponent, GamificationComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  currentView: View = 'home';
  settingsOpen = false;
  stats: TaskStats | null = null;
  statsLoading = true;
  window = window;
  // Gamification toast
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
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

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
    this.currentView = view;
    this.settingsOpen = false;
    if (view === 'home') this.loadStats();
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
