import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CreateTaskComponent } from './components/create-task/create-task.component';
import { TaskListComponent } from './components/task-list/task-list.component';
import { GetTaskComponent } from './components/get-task/get-task.component';
import { SettingsComponent } from './components/settings/settings.component';
import { AuthService } from './services/auth.service';
import { TaskService, TaskStats } from './services/task.service';
import { OAuthService } from 'angular-oauth2-oidc';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

type View = 'home' | 'create' | 'list' | 'get';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CreateTaskComponent, TaskListComponent, GetTaskComponent, SettingsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  currentView: View = 'home';
  settingsOpen = false;
  stats: TaskStats | null = null;
  window = window;
  private sub: Subscription | null = null;

  constructor(
    public auth: AuthService,
    private taskService: TaskService,
    private oauthService: OAuthService
  ) {}

  ngOnInit() {
    if (this.auth.isLoggedIn) this.loadStats();
    this.sub = this.oauthService.events
      .pipe(filter(e => e.type === 'token_received' || e.type === 'token_refreshed'))
      .subscribe(() => this.loadStats());
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadStats() {
    this.taskService.getStats().subscribe({ next: s => this.stats = s, error: () => {} });
  }

  setView(view: View) {
    this.currentView = view;
    this.settingsOpen = false;
    if (view === 'home') this.loadStats();
  }
}
