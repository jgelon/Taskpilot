import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task, Category, SortField, SortOrder } from '../../services/task.service';
import { EditTaskComponent } from '../edit-task/edit-task.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, FormsModule, EditTaskComponent],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss'
})
export class TaskListComponent implements OnInit {
  tasks: Task[] = []; categories: Category[] = [];
  loading = true; editingTask: Task | null = null;
  filterStatus: 'open' | 'closed' | 'all' = 'open';
  sortField: SortField = 'dateAdded'; sortOrder: SortOrder = 'desc';
  filterCategoryId: string | undefined = undefined;
  toast: { msg: string; type: string } | null = null;
  lastGamResult: any = null;
  @Output() taskClosed = new EventEmitter<any>();

  sortOptions: { value: SortField; label: string }[] = [
    { value: 'dateAdded', label: 'Date added' }, { value: 'priority', label: 'Priority' },
    { value: 'dueDate', label: 'Due date' }, { value: 'name', label: 'Name' },
    { value: 'estimatedDuration', label: 'Duration' },
  ];

  constructor(private taskService: TaskService) {}

  ngOnInit() {
    this.taskService.getCategories().subscribe({ next: c => this.categories = c, error: () => {} });
    this.loadTasks();
  }

  loadTasks() {
    this.loading = true;
    this.taskService.getTasks(this.filterStatus, this.sortField, this.sortOrder, this.filterCategoryId).subscribe({
      next: t => { this.tasks = t; this.loading = false; },
      error: () => { this.loading = false; this.showToast('Failed to load tasks', 'error'); }
    });
  }

  onFilterChange() { this.loadTasks(); }
  onSortChange() { this.loadTasks(); }
  toggleOrder() { this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'; this.loadTasks(); }
  setCategoryFilter(id: string | undefined) { this.filterCategoryId = id; this.loadTasks(); }

  openEdit(task: Task) { this.editingTask = { ...task }; }
  onEditDone(gamResult?: any) {
    this.editingTask = null;
    this.loadTasks();
    if (gamResult) this.taskClosed.emit(gamResult);
  }
  onEditCancel() { this.editingTask = null; }

  recurLabel(t: Task): string | null {
    if (!t.recurring || t.recurring === 'none') return null;
    return t.recurring === 'custom' ? `Every ${t.recurrenceDays}d` : t.recurring.charAt(0).toUpperCase() + t.recurring.slice(1);
  }

  formatDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  isOverdue(t: Task) { return t.dueDate && t.status === 'open' && new Date(t.dueDate) < new Date(); }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 2500);
  }
}
