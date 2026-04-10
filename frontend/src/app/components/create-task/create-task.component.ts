import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';

@Component({
  selector: 'app-create-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './create-task.component.html',
  styleUrl: './create-task.component.scss'
})
export class CreateTaskComponent {
  @Output() done = new EventEmitter<void>();

  name = '';
  description = '';
  estimatedDuration: number | null = null;
  priority: number = 2;
  dueDate = '';
  loading = false;
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService) {}

  get isValid() {
    return this.name.trim() && this.estimatedDuration && this.estimatedDuration > 0 && this.priority >= 1 && this.priority <= 4;
  }

  submit() {
    if (!this.isValid || this.loading) return;
    this.loading = true;
    this.taskService.createTask({
      name: this.name.trim(),
      description: this.description.trim() || undefined,
      estimatedDuration: this.estimatedDuration!,
      priority: this.priority,
      dueDate: this.dueDate || null
    }).subscribe({
      next: () => {
        this.showToast('Task created!', 'success');
        setTimeout(() => this.done.emit(), 900);
      },
      error: () => {
        this.loading = false;
        this.showToast('Failed to create task', 'error');
      }
    });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 2500);
  }
}
