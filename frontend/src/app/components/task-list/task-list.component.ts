import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task, SortField, SortOrder } from '../../services/task.service';
import { EditTaskComponent } from '../edit-task/edit-task.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, FormsModule, EditTaskComponent],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss'
})
export class TaskListComponent implements OnInit {
  tasks: Task[] = [];
  loading = true;
  editingTask: Task | null = null;
  filterStatus: 'open' | 'closed' | 'all' = 'open';
  sortField: SortField = 'dateAdded';
  sortOrder: SortOrder = 'desc';
  toast: { msg: string; type: string } | null = null;

  sortOptions: { value: SortField; label: string }[] = [
    { value: 'dateAdded', label: 'Date added' },
    { value: 'priority', label: 'Priority' },
    { value: 'dueDate', label: 'Due date' },
    { value: 'name', label: 'Name' },
    { value: 'estimatedDuration', label: 'Duration' },
  ];

  constructor(private taskService: TaskService) {}

  ngOnInit() { this.loadTasks(); }

  loadTasks() {
    this.loading = true;
    this.taskService.getTasks(this.filterStatus, this.sortField, this.sortOrder).subscribe({
      next: tasks => { this.tasks = tasks; this.loading = false; },
      error: () => { this.loading = false; this.showToast('Failed to load tasks', 'error'); }
    });
  }

  onFilterChange() { this.loadTasks(); }
  onSortChange() { this.loadTasks(); }

  toggleOrder() {
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this.loadTasks();
  }

  openEdit(task: Task) { this.editingTask = { ...task }; }
  onEditDone() { this.editingTask = null; this.loadTasks(); }
  onEditCancel() { this.editingTask = null; }

  recurLabel(task: Task): string | null {
    if (!task.recurring || task.recurring === 'none') return null;
    if (task.recurring === 'custom') return `Every ${task.recurrenceDays}d`;
    return task.recurring.charAt(0).toUpperCase() + task.recurring.slice(1);
  }

  formatDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  isOverdue(task: Task) {
    return task.dueDate && task.status === 'open' && new Date(task.dueDate) < new Date();
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 2500);
  }
}
