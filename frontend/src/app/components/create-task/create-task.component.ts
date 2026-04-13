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

  name = ''; description = ''; estimatedDuration: number | null = null;
  priority: number = 2; dueDate = ''; recurring = 'none';
  recurrenceDays: number | null = null; categoryId: string | null = null;
  categories: Category[] = [];
  users: {username: string; name: string}[] = [];
  assignedTo: string | null = null;
  assignedToName: string | null = null;
  loading = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService, public auth: AuthService) {}

  ngOnInit() {
    this.taskService.getCategories().subscribe({ next: cats => this.categories = cats, error: () => {} });
    if (this.auth.features.assignment) {
      this.taskService.getUsers().subscribe({ next: u => this.users = u, error: () => {} });
    }
  }

  get isValid() { return this.name.trim() && this.estimatedDuration && this.estimatedDuration > 0; }

  submit() {
    if (!this.isValid || this.loading) return;
    this.loading = true;
    this.taskService.createTask({
      name: this.name.trim(), description: this.description.trim() || undefined,
      estimatedDuration: this.estimatedDuration!, priority: this.priority,
      dueDate: this.dueDate || null, recurring: this.recurring,
      recurrenceDays: this.recurring === 'custom' ? this.recurrenceDays : null,
      categoryId: this.categoryId || null,
      assignedTo: this.assignedTo || null,
      assignedToName: this.assignedToName || null
    }).subscribe({
      next: () => { this.showToast('Task created!', 'success'); setTimeout(() => this.done.emit(), 900); },
      error: (err) => {
        this.loading = false;
        const d = err?.error?.detail || err?.error?.error || err?.message || err?.status;
        this.showToast(`Error: ${d || 'Failed to create task'}`, 'error');
      }
    });
  }

  onAssigneeChange(username: string) {
    if (!username) { this.assignedTo = null; this.assignedToName = null; return; }
    const user = this.users.find(u => u.username === username);
    this.assignedTo = username;
    this.assignedToName = user?.name || username;
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, type === 'error' ? 6000 : 2500);
  }
}
