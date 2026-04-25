import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task, Category } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-edit-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './edit-task.component.html',
  styleUrl: './edit-task.component.scss'
})
export class EditTaskComponent implements OnInit {
  @Input() task!: Task;
  @Output() done = new EventEmitter<any>();
  @Output() cancel = new EventEmitter<void>();

  name = '';
  description = '';
  estimatedDurationStr = '';
  recurrenceDaysStr = '';
  priority = '2';
  dueDate = '';
  status: 'open' | 'closed' = 'open';
  recurring = 'none';
  categoryId = '';
  assignedToUsername = '';
  assignedTo: string | null = null;
  assignedToName: string | null = null;
  categories: Category[] = [];
  users: {username: string; name: string}[] = [];

  loading = false;
  closing = false;
  deleting = false;
  confirmDelete = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService, public auth: AuthService) {}

  ngOnInit() {
    this.name = this.task.name;
    this.description = this.task.description || '';
    this.estimatedDurationStr = String(this.task.estimatedDuration);
    this.recurrenceDaysStr = this.task.recurrenceDays ? String(this.task.recurrenceDays) : '';
    this.priority = String(this.task.priority);
    this.dueDate = this.task.dueDate ? this.task.dueDate.substring(0, 10) : '';
    this.status = this.task.status;
    this.recurring = this.task.recurring || 'none';
    this.categoryId = this.task.categoryId || '';
    this.assignedTo = this.task.assignedTo;
    this.assignedToName = this.task.assignedToName;
    this.assignedToUsername = this.task.assignedTo || '';

    this.taskService.getCategories().subscribe({ next: c => this.categories = c, error: () => {} });
    this.taskService.getUsers().subscribe({ next: u => this.users = u, error: () => {} });
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

  save() {
    if (!this.isValid || this.loading) return;
    const dur = parseInt(this.estimatedDurationStr, 10);
    const days = this.recurrenceDaysStr ? parseInt(this.recurrenceDaysStr, 10) : null;
    this.loading = true;
    this.taskService.updateTask(this.task.id, {
      name: this.name.trim(),
      description: this.description.trim(),
      estimatedDuration: dur,
      priority: parseInt(this.priority, 10),
      dueDate: this.dueDate || null,
      status: this.status,
      recurring: this.recurring,
      recurrenceDays: this.recurring === 'custom' ? days : null,
      categoryId: this.categoryId || null,
      assignedTo: this.assignedTo,
      assignedToName: this.assignedToName
    }).subscribe({
      next: (result: any) => {
        this.showToast('Task updated!', 'success');
        setTimeout(() => this.done.emit(result._gamification || null), 800);
      },
      error: () => { this.loading = false; this.showToast('Failed to save', 'error'); }
    });
  }

  closeTask() {
    if (!this.isValid || this.loading) return;
    this.closing = true;
    this.loading = true;
    this.status = 'closed';
    this.save();
  }

  deleteTask() {
    if (!this.confirmDelete) { this.confirmDelete = true; return; }
    this.deleting = true;
    this.loading = true;
    this.taskService.deleteTask(this.task.id).subscribe({
      next: () => this.done.emit(null),
      error: () => { this.loading = false; this.deleting = false; this.showToast('Failed to delete', 'error'); }
    });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 2500);
  }

  formatDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
