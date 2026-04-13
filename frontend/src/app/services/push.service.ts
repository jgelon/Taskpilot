import { Injectable } from '@angular/core';
import { TaskService } from './task.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PushService {
  private swRegistration: ServiceWorkerRegistration | null = null;

  constructor(private taskService: TaskService, private auth: AuthService) {}

  async init(): Promise<void> {
    if (!this.auth.features.pushNotifications) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[Push] Not supported in this browser');
      return;
    }

    try {
      // Get VAPID key from backend
      const { publicKey } = await this.taskService.getVapidPublicKey().toPromise() as any;
      if (!publicKey) return;

      // Register service worker
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Check existing permission
      if (Notification.permission === 'denied') return;

      // Check if already subscribed
      const existing = await this.swRegistration.pushManager.getSubscription();
      if (existing) {
        // Re-register with backend in case server restarted
        await this.taskService.subscribePush(existing.toJSON()).toPromise();
        return;
      }

      // Request permission on first login
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Subscribe
      const sub = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(publicKey)
      });

      await this.taskService.subscribePush(sub.toJSON()).toPromise();
      console.log('[Push] Subscribed successfully');
    } catch (e) {
      console.warn('[Push] Setup failed:', e);
    }
  }

  async unsubscribe(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await this.taskService.unsubscribePush(sub.endpoint).toPromise();
      await sub.unsubscribe();
    } catch (e) {
      console.warn('[Push] Unsubscribe failed:', e);
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }
}
