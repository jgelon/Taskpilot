import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Category } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-create-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './create-task.component.html',
  styleUrl: './create-task.component.scss'
})
export class CreateTaskComponent implements OnInit {
  @Output() done = new EventEmitter<void>();

  name = '';
  description = '';
  // Use strings for numeric inputs — avoids Samsung Internet type="number" bugs
  estimatedDurationStr = '';
  recurrenceDaysStr = '';
  priority = '2';  // string for select binding
  dueDate = '';
  recurring = 'none';
  categoryId = '';  // empty string instead of null for Samsung select compat
  assignedToUsername = '';
  assignedTo: string | null = null;
  assignedToName: string | null = null;
  categories: Category[] = [];
  users: {username: string; name: string}[] = [];
  loading = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService, public auth: AuthService) {}

  ngOnInit() {
    this.taskService.getCategories().subscribe({ next: cats => this.categories = cats, error: () => {} });
    if (this.auth.features.assignment) {
      this.taskService.getUsers().subscribe({ next: u => this.users = u, error: () => {} });
    }
  }

  get isValid() {
    const dur = parseInt(this.estimatedDurationStr, 10);
    return this.name.trim().length > 0 && !isNaN(dur) && dur > 0;
  }

  onAssigneeChange(username: string) {
    if (!username) { this.assignedTo = null; this.assignedToName = null; return; }
    const user = this.users.find(u => u.username === username);
    this.assignedTo = username;
    this.assignedToName = user?.name || username;
  }

  submit() {
    if (!this.isValid || this.loading) return;
    const dur = parseInt(this.estimatedDurationStr, 10);
    const days = this.recurrenceDaysStr ? parseInt(this.recurrenceDaysStr, 10) : null;
    this.loading = true;
    this.taskService.createTask({
      name: this.name.trim(),
      description: this.description.trim() || undefined,
      estimatedDuration: dur,
      priority: parseInt(this.priority, 10),
      dueDate: this.dueDate || null,
      recurring: this.recurring,
      recurrenceDays: this.recurring === 'custom' ? days : null,
      categoryId: this.categoryId || null,
      assignedTo: this.assignedTo,
      assignedToName: this.assignedToName
    }).subscribe({
      next: () => {
        this.showToast('Task created!', 'success');
        setTimeout(() => this.done.emit(), 900);
      },
      error: (err) => {
        this.loading = false;
        const d = err?.error?.detail || err?.error?.error || err?.message || err?.status;
        this.showToast(`Error: ${d || 'Failed to create task'}`, 'error');
        console.error('Create task error:', err);
      }
    });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, type === 'error' ? 6000 : 2500);
  }
}
