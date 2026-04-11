import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Category } from '../../services/task.service';

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
  loading = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService) {}

  ngOnInit() {
    this.taskService.getCategories().subscribe({ next: cats => this.categories = cats, error: () => {} });
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
      categoryId: this.categoryId || null
    }).subscribe({
      next: () => { this.showToast('Task created!', 'success'); setTimeout(() => this.done.emit(), 900); },
      error: (err) => {
        this.loading = false;
        const d = err?.error?.detail || err?.error?.error || err?.message || err?.status;
        this.showToast(`Error: ${d || 'Failed to create task'}`, 'error');
      }
    });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, type === 'error' ? 6000 : 2500);
  }
}
