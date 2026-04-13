import { Component, OnInit, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Category, ApiKey, ApiKeyCreated } from '../../services/task.service';
import { Features } from '../../services/auth.service';
import { ImportExportComponent } from '../import-export/import-export.component';

type SettingsTab = 'categories' | 'features' | 'apikeys' | 'importexport';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportExportComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Input() isAdmin = false;

  tab: SettingsTab = 'categories';
  categories: Category[] = [];
  loading = true;

  // New category form
  newName = '';
  newColor = '#7b61ff';
  addLoading = false;

  // Editing
  editingId: string | null = null;
  editName = '';
  editColor = '';
  editLoading = false;

  confirmDeleteId: string | null = null;
  toast: { msg: string; type: string } | null = null;

  // API Keys
  apiKeys: ApiKey[] = [];
  apiKeysLoading = false;
  newKeyName = '';
  addKeyLoading = false;
  newlyCreatedKey: ApiKeyCreated | null = null;
  confirmDeleteKeyId: string | null = null;

  // Feature flags
  features: Features = { points: true, streaks: true, achievements: true, leaderboard: true };
  featuresLoading = false;
  featuresChanged = false;

  readonly PRESET_COLORS = [
    '#7b61ff', '#c8f135', '#ff5c5c', '#ffaa33',
    '#3dffa0', '#33d6ff', '#ff61d8', '#a0a0b0'
  ];

  constructor(private taskService: TaskService) {}

  ngOnInit() {
    this.loadCategories();
    this.loadFeatures();
    this.loadApiKeys();
  }

  loadFeatures() {
    this.taskService.getFeatures().subscribe({
      next: f => { this.features = f; },
      error: () => {}
    });
  }

  toggleFeature(key: keyof Features) {
    this.features[key] = !this.features[key];
    this.featuresChanged = true;
  }

  saveFeatures() {
    this.featuresLoading = true;
    this.taskService.updateFeatures(this.features).subscribe({
      next: f => {
        this.features = f;
        this.featuresLoading = false;
        this.featuresChanged = false;
        this.showToast('Feature settings saved', 'success');
      },
      error: () => {
        this.featuresLoading = false;
        this.showToast('Failed to save', 'error');
      }
    });
  }

  loadCategories() {
    this.loading = true;
    this.taskService.getCategories().subscribe({
      next: cats => { this.categories = cats; this.loading = false; },
      error: () => { this.loading = false; this.showToast('Failed to load categories', 'error'); }
    });
  }

  addCategory() {
    if (!this.newName.trim() || this.addLoading) return;
    this.addLoading = true;
    this.taskService.createCategory(this.newName.trim(), this.newColor).subscribe({
      next: cat => {
        this.categories.push(cat);
        this.newName = ''; this.newColor = '#7b61ff';
        this.addLoading = false;
        this.showToast('Category added', 'success');
      },
      error: (err) => {
        this.addLoading = false;
        this.showToast(err?.error?.error || 'Failed to add category', 'error');
      }
    });
  }

  startEdit(cat: Category) {
    this.editingId = cat.id;
    this.editName = cat.name;
    this.editColor = cat.color;
    this.confirmDeleteId = null;
  }

  saveEdit() {
    if (!this.editName.trim() || this.editLoading || !this.editingId) return;
    this.editLoading = true;
    this.taskService.updateCategory(this.editingId, this.editName.trim(), this.editColor).subscribe({
      next: updated => {
        const idx = this.categories.findIndex(c => c.id === updated.id);
        if (idx > -1) this.categories[idx] = updated;
        this.editingId = null; this.editLoading = false;
        this.showToast('Category saved', 'success');
      },
      error: (err) => {
        this.editLoading = false;
        this.showToast(err?.error?.error || 'Failed to save', 'error');
      }
    });
  }

  cancelEdit() { this.editingId = null; }

  deleteCategory(id: string) {
    if (this.confirmDeleteId !== id) { this.confirmDeleteId = id; return; }
    this.taskService.deleteCategory(id).subscribe({
      next: () => {
        this.categories = this.categories.filter(c => c.id !== id);
        this.confirmDeleteId = null;
        this.showToast('Category deleted — tasks uncategorised', 'success');
      },
      error: () => this.showToast('Failed to delete', 'error')
    });
  }

  loadApiKeys() {
    this.apiKeysLoading = true;
    this.taskService.getApiKeys().subscribe({
      next: keys => { this.apiKeys = keys; this.apiKeysLoading = false; },
      error: () => { this.apiKeysLoading = false; this.showToast('Failed to load API keys', 'error'); }
    });
  }

  createApiKey() {
    if (!this.newKeyName.trim() || this.addKeyLoading) return;
    this.addKeyLoading = true;
    this.taskService.createApiKey(this.newKeyName.trim()).subscribe({
      next: key => {
        this.newlyCreatedKey = key;
        this.apiKeys.unshift({ id: key.id, name: key.name, key_prefix: key.key_prefix, createdAt: key.createdAt, lastUsedAt: null });
        this.newKeyName = '';
        this.addKeyLoading = false;
      },
      error: () => { this.addKeyLoading = false; this.showToast('Failed to create key', 'error'); }
    });
  }

  dismissNewKey() { this.newlyCreatedKey = null; }

  copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => this.showToast('Copied to clipboard!', 'success'));
  }

  deleteApiKey(id: string) {
    if (this.confirmDeleteKeyId !== id) { this.confirmDeleteKeyId = id; return; }
    this.taskService.deleteApiKey(id).subscribe({
      next: () => {
        this.apiKeys = this.apiKeys.filter(k => k.id !== id);
        this.confirmDeleteKeyId = null;
        this.showToast('API key revoked', 'success');
      },
      error: () => this.showToast('Failed to revoke key', 'error')
    });
  }

  formatDate(d: string | null) {
    if (!d) return 'Never';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 3000);
  }
}
