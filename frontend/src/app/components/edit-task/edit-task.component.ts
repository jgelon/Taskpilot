import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task } from '../../services/task.service';

@Component({
  selector: 'app-edit-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './edit-task.component.html',
  styleUrl: './edit-task.component.scss'
})
export class EditTaskComponent implements OnInit {
  @Input() task!: Task;
  @Output() done = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  name = '';
  description = '';
  estimatedDuration: number = 0;
  priority: number = 2;
  dueDate = '';
  status: 'open' | 'closed' = 'open';
  recurring = 'none';
  recurrenceDays: number | null = null;

  loading = false;
  confirmDelete = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService) {}

  ngOnInit() {
    this.name = this.task.name;
    this.description = this.task.description || '';
    this.estimatedDuration = this.task.estimatedDuration;
    this.priority = this.task.priority;
    this.dueDate = this.task.dueDate ? this.task.dueDate.substring(0, 10) : '';
    this.status = this.task.status;
    this.recurring = this.task.recurring || 'none';
    this.recurrenceDays = this.task.recurrenceDays;
  }

  get isValid() { return this.name.trim() && this.estimatedDuration > 0; }

  save() {
    if (!this.isValid || this.loading) return;
    this.loading = true;
    this.taskService.updateTask(this.task.id, {
      name: this.name.trim(),
      description: this.description.trim(),
      estimatedDuration: this.estimatedDuration,
      priority: this.priority,
      dueDate: this.dueDate || null,
      status: this.status,
      recurring: this.recurring,
      recurrenceDays: this.recurring === 'custom' ? this.recurrenceDays : null
    }).subscribe({
      next: () => { this.showToast('Task updated!', 'success'); setTimeout(() => this.done.emit(), 800); },
      error: () => { this.loading = false; this.showToast('Failed to save', 'error'); }
    });
  }

  closeTask() { this.status = 'closed'; this.save(); }

  deleteTask() {
    if (!this.confirmDelete) { this.confirmDelete = true; return; }
    this.loading = true;
    this.taskService.deleteTask(this.task.id).subscribe({
      next: () => this.done.emit(),
      error: () => { this.loading = false; this.showToast('Failed to delete', 'error'); }
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
