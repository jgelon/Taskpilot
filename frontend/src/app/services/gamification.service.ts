import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Achievement {
  id: string; icon: string; name: string; desc: string;
  earnedAt?: string;
}

export interface UserStats {
  username: string; displayName: string;
  totalPoints: number; tasksCompleted: number;
  currentStreak: number; longestStreak: number;
  weeklyPoints: number;
  achievements: Achievement[];
}

export interface LeaderboardEntry {
  rank: number; username: string; displayName: string;
  totalPoints: number; tasksCompleted: number;
  currentStreak: number; weeklyPoints: number;
}

export interface GamificationResult {
  points: number; streak: number; totalPoints: number;
  newlyEarned: Achievement[];
}

@Injectable({ providedIn: 'root' })
export class GamificationService {
  private api = environment.apiUrl;
  constructor(private http: HttpClient, private auth: AuthService) {}

  private h(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.accessToken}` });
  }

  getMe(): Observable<{ stats: UserStats | null; features: any; allAchievements: Achievement[] }> {
    return this.http.get<any>(`${this.api}/gamification/me`, { headers: this.h() });
  }

  getLeaderboard(): Observable<LeaderboardEntry[]> {
    return this.http.get<LeaderboardEntry[]>(`${this.api}/gamification/leaderboard`, { headers: this.h() });
  }
}
