import { Injectable } from '@angular/core';
import { OAuthService, AuthConfig } from 'angular-oauth2-oidc';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  initError: string | null = null;
  initReady = false;
  loadingMessage = 'Connecting to Authentik…';
  private _isAdmin = false;
  features = { points: true, streaks: true, achievements: true, leaderboard: true };

  constructor(private oauthService: OAuthService) {}

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
      timeoutFactor: 0.75
    };

    this.oauthService.configure(config);

    try {
      this.loadingMessage = 'Connecting to Authentik…';
      await this.oauthService.loadDiscoveryDocumentAndTryLogin();
    } catch (err: any) {
      console.error('OIDC init failed:', err);
      this.initError = `Could not reach Authentik at ${environment.authentikUrl}. Check AUTHENTIK_URL in your .env and that Authentik is reachable. (${err?.message ?? err})`;
      this.initReady = true;
      return;
    }

    if (!this.oauthService.hasValidAccessToken()) {
      this.oauthService.initCodeFlow();
      return;
    }

    this.loadingMessage = 'Loading your profile…';
    await this.fetchRole();
    this.initReady = true;
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
      }
    } catch (e) {
      console.warn('[Auth] Could not fetch /me:', e);
      // Non-fatal — app still works, just defaults to non-admin
      this._isAdmin = false;
    }
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
}
