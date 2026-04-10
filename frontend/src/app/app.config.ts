import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideOAuthClient } from 'angular-oauth2-oidc';
import { AuthService } from './services/auth.service';

function initAuth(auth: AuthService) {
  return () => auth.init();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideOAuthClient(),
    {
      provide: APP_INITIALIZER,
      useFactory: initAuth,
      deps: [AuthService],
      multi: true
    }
  ]
};
