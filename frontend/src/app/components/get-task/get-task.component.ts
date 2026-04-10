import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';

type GetTaskState = 'input' | 'showing' | 'none' | 'accept';

@Component({
  selector: 'app-get-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './get-task.component.html',
  styleUrl: './get-task.component.scss'
})
export class GetTaskComponent {
  state: GetTaskState = 'input';
  availableMinutes: number | null = null;
  currentTask: Task | null = null;
  excludedIds: string[] = [];
  loading = false;
  toast: { msg: string; type: string } | null = null;

  presets = [
    { label: '5 min', value: 5 },
    { label: '10 min', value: 10 },
    { label: '15 min', value: 15 },
    { label: '30 min', value: 30 },
    { label: '1 hr', value: 60 },
    { label: '2 hr', value: 120 },
  ];

  constructor(private taskService: TaskService, public auth: AuthService) {}

  setPreset(v: number) { this.availableMinutes = v; }

  getSuggestion() {
    if (!this.availableMinutes || this.availableMinutes <= 0) return;
    this.loading = true;
    this.taskService.suggestTask(this.availableMinutes, this.excludedIds).subscribe({
      next: ({ task }) => {
        this.loading = false;
        if (!task) { this.state = 'none'; this.currentTask = null; }
        else { this.currentTask = task; this.state = 'showing'; }
      },
      error: () => { this.loading = false; this.showToast('Failed to fetch suggestion', 'error'); }
    });
  }

  declineTask() {
    if (!this.currentTask) return;
    this.excludedIds = [...this.excludedIds, this.currentTask.id];
    this.currentTask = null;
    this.state = 'input';
    this.getSuggestion();
  }

  acceptTask() { this.state = 'accept'; }

  finishTask(close: boolean) {
    if (!this.currentTask) return;
    this.loading = true;
    if (close) {
      this.taskService.updateTask(this.currentTask.id, { status: 'closed' }).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Task marked as done! 🎉', 'success');
          this.reset();
        },
        error: () => { this.loading = false; this.showToast('Failed to update', 'error'); }
      });
    } else {
      this.loading = false;
      this.showToast('Task kept open, back to the pile.', 'success');
      this.reset();
    }
  }

  reset() {
    this.state = 'input';
    this.currentTask = null;
    this.excludedIds = [];
    this.availableMinutes = null;
  }

  priorityLabel(p: number) {
    return ['', 'Critical', 'High', 'Medium', 'Low'][p] || '';
  }

  formatDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 3000);
  }
}
