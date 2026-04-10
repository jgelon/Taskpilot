import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService, Task } from '../../services/task.service';
import { EditTaskComponent } from '../edit-task/edit-task.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, EditTaskComponent],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss'
})
export class TaskListComponent implements OnInit {
  tasks: Task[] = [];
  loading = true;
  editingTask: Task | null = null;
  filterStatus: 'all' | 'open' | 'closed' = 'open';
  toast: { msg: string; type: string } | null = null;

  constructor(private taskService: TaskService) {}

  ngOnInit() { this.loadTasks(); }

  loadTasks() {
    this.loading = true;
    this.taskService.getTasks().subscribe({
      next: tasks => {
        this.tasks = tasks.sort((a, b) =>
          new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
        );
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.showToast('Failed to load tasks', 'error');
      }
    });
  }

  get filteredTasks() {
    if (this.filterStatus === 'all') return this.tasks;
    return this.tasks.filter(t => t.status === this.filterStatus);
  }

  openEdit(task: Task) { this.editingTask = { ...task }; }

  onEditDone() {
    this.editingTask = null;
    this.loadTasks();
  }

  onEditCancel() { this.editingTask = null; }

  priorityLabel(p: number) {
    return ['', 'Critical', 'High', 'Medium', 'Low'][p] || '';
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
