import { Injectable, NgZone } from '@angular/core';
import { OAuthService, AuthConfig, OAuthEvent } from 'angular-oauth2-oidc';
import { environment } from '../../environments/environment';

export interface Features {
  points: boolean;
  streaks: boolean;
  achievements: boolean;
  leaderboard: boolean;
  assignment: boolean;
  pushNotifications: boolean;
}

export type AuthState = 'loading' | 'ready' | 'reauthing' | 'error';

@Injectable({ providedIn: 'root' })
export class AuthService {
  state: AuthState = 'loading';
  loadingMessage = 'Connecting to Authentik…';
  initError: string | null = null;
  features: Features = { points: true, streaks: true, achievements: true, leaderboard: true, assignment: true, pushNotifications: true };
  private _isAdmin = false;

  constructor(private oauthService: OAuthService, private ngZone: NgZone) {}

  async init(): Promise<void> {
    const config: AuthConfig = {
      issuer: `${environment.authentikUrl}/application/o/taskpilot/`,
      redirectUri: environment.appUrl + '/',
      clientId: environment.oidcClientId,
      responseType: 'code',
      scope: 'openid profile email',
      showDebugInformation: !environment.production,
      strictDiscoveryDocumentValidation: false,
      clearHashAfterLogin: true,
      timeoutFactor: 0.75,
      // Attempt silent refresh before token expires
      sessionChecksEnabled: false,
      silentRefreshTimeout: 5000,
    };

    this.oauthService.configure(config);
    this.oauthService.setupAutomaticSilentRefresh();

    // Listen for token events throughout the app lifecycle
    this.oauthService.events.subscribe(e => this.handleOAuthEvent(e));

    try {
      this.loadingMessage = 'Connecting to Authentik…';
      await this.oauthService.loadDiscoveryDocumentAndTryLogin();
    } catch (err: any) {
      console.error('OIDC init failed:', err);
      this.initError = `Could not reach Authentik at ${environment.authentikUrl}. Check your .env. (${err?.message ?? err})`;
      this.state = 'error';
      return;
    }

    if (!this.oauthService.hasValidAccessToken()) {
      this.oauthService.initCodeFlow();
      return;
    }

    this.loadingMessage = 'Loading your profile…';
    await this.fetchRole();
    this.state = 'ready';
  }

  private handleOAuthEvent(e: OAuthEvent) {
    console.log('[OAuth event]', e.type);

    switch (e.type) {
      // Token successfully refreshed — re-fetch role in case group membership changed
      case 'token_refreshed':
        this.fetchRole();
        break;

      // Silent refresh failed — try a full code flow redirect
      case 'silent_refresh_error':
      case 'token_refresh_error':
        console.warn('[Auth] Silent refresh failed, re-authenticating…');
        this.ngZone.run(() => {
          this.state = 'reauthing';
          this.loadingMessage = 'Session expired — re-authenticating…';
        });
        setTimeout(() => this.oauthService.initCodeFlow(), 1500);
        break;

      // Token expired and no refresh succeeded
      case 'token_expires':
        // setupAutomaticSilentRefresh will attempt a refresh;
        // if it fails, token_refresh_error fires above
        break;

      // Session was terminated (e.g. logged out in Authentik)
      case 'session_terminated':
      case 'session_error':
        console.warn('[Auth] Session terminated, redirecting to login…');
        this.ngZone.run(() => {
          this.state = 'reauthing';
          this.loadingMessage = 'Session ended — redirecting to login…';
        });
        setTimeout(() => this.oauthService.initCodeFlow(), 1500);
        break;
    }
  }

  private async fetchRole(): Promise<void> {
    try {
      const res = await fetch(`${environment.apiUrl}/me`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        this._isAdmin = !!data.isAdmin;
        if (data.features) this.features = data.features;
        console.log('[Auth] isAdmin:', this._isAdmin, 'features:', this.features);
      } else if (res.status === 401) {
        // API also considers token invalid — trigger re-auth
        this.ngZone.run(() => {
          this.state = 'reauthing';
          this.loadingMessage = 'Session expired — re-authenticating…';
        });
        setTimeout(() => this.oauthService.initCodeFlow(), 1500);
      }
    } catch (e) {
      console.warn('[Auth] Could not fetch /me:', e);
    }
  }

  // Call this when any API call returns 401 to trigger re-auth
  handleUnauthorized() {
    if (this.state === 'reauthing') return; // already handling
    console.warn('[Auth] 401 received — attempting token refresh');
    this.ngZone.run(() => {
      this.state = 'reauthing';
      this.loadingMessage = 'Session expired — re-authenticating…';
    });
    // Try silent refresh first, fall back to full login after 3s
    this.oauthService.silentRefresh().catch(() => {
      setTimeout(() => this.oauthService.initCodeFlow(), 1500);
    });
  }

  get isLoggedIn(): boolean {
    return this.oauthService.hasValidAccessToken();
  }

  get accessToken(): string {
    return this.oauthService.getAccessToken();
  }

  get isAdmin(): boolean {
    return this._isAdmin;
  }

  get userProfile(): { username: string; name: string; email: string } {
    const claims = this.oauthService.getIdentityClaims() as any;
    if (!claims) return { username: '', name: '', email: '' };
    return {
      username: claims.preferred_username || claims.email || claims.sub,
      name: claims.name || claims.preferred_username || 'User',
      email: claims.email || ''
    };
  }

  logout(): void {
    this.oauthService.logOut();
  }

  // Legacy compat — keep initReady working for existing template checks
  get initReady(): boolean {
    return this.state === 'ready' || this.state === 'error';
  }
}
