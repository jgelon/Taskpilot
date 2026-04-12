import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GamificationService, UserStats, LeaderboardEntry, Achievement } from '../../services/gamification.service';
import { AuthService } from '../../services/auth.service';

type GamTab = 'profile' | 'leaderboard' | 'achievements';

@Component({
  selector: 'app-gamification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './gamification.component.html',
  styleUrl: './gamification.component.scss'
})
export class GamificationComponent implements OnInit {
  tab: GamTab = 'profile';
  stats: UserStats | null = null;
  leaderboard: LeaderboardEntry[] = [];
  allAchievements: Achievement[] = [];
  loading = true;
  Math = Math;

  constructor(public auth: AuthService, private gamSvc: GamificationService) {}

  ngOnInit() {
    this.gamSvc.getMe().subscribe({
      next: ({ stats, allAchievements }) => {
        this.stats = stats;
        this.allAchievements = allAchievements;
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
    if (this.auth.features.leaderboard) {
      this.gamSvc.getLeaderboard().subscribe({
        next: lb => this.leaderboard = lb,
        error: () => {}
      });
    }
  }

  get earnedIds(): Set<string> {
    return new Set(this.stats?.achievements.map(a => a.id) || []);
  }

  earnedAchievement(id: string): Achievement | undefined {
    return this.stats?.achievements.find(a => a.id === id);
  }

  formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  streakLabel(n: number) {
    if (n === 0) return 'No active streak';
    if (n === 1) return '1 day';
    return `${n} days`;
  }

  rankIcon(rank: number) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  }

  isCurrentUser(username: string) {
    return username === this.auth.userProfile.username;
  }
}
