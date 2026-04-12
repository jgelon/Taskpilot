import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService, Task } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';

type GetTaskState = 'input' | 'showing' | 'none' | 'working';

@Component({
  selector: 'app-get-task',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './get-task.component.html',
  styleUrl: './get-task.component.scss'
})
export class GetTaskComponent implements OnChanges {
  /** If a task is already claimed by the current user, pass it in directly */
  @Input() claimedTask: Task | null = null;
  @Output() taskChanged = new EventEmitter<void>();
  @Output() taskClosed = new EventEmitter<any>();

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

  ngOnChanges(changes: SimpleChanges) {
    // If a claimed task is passed in (from home screen), go straight to working state
    if (changes['claimedTask'] && this.claimedTask) {
      this.currentTask = this.claimedTask;
      this.state = 'working';
    }
  }

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

  acceptTask() {
    if (!this.currentTask) return;
    this.loading = true;
    this.taskService.claimTask(this.currentTask.id).subscribe({
      next: (task) => {
        this.loading = false;
        this.currentTask = task;
        this.state = 'working';
        this.taskChanged.emit();
      },
      error: () => { this.loading = false; this.showToast('Failed to claim task', 'error'); }
    });
  }

  finishTask(close: boolean) {
    if (!this.currentTask) return;
    this.loading = true;
    if (close) {
      this.taskService.updateTask(this.currentTask.id, { status: 'closed' }).subscribe({
        next: (result: any) => {
          this.loading = false;
          this.taskClosed.emit(result._gamification || null);
          this.reset();
        },
        error: () => { this.loading = false; this.showToast('Failed to update', 'error'); }
      });
    } else {
      // Keep open but unclaim — hand back to the pile
      this.taskService.unclaimTask(this.currentTask.id).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Task handed back to the pile.', 'success');
          this.taskChanged.emit();
          this.reset();
        },
        error: () => { this.loading = false; this.showToast('Failed to unclaim', 'error'); }
      });
    }
  }

  handBack() {
    if (!this.currentTask) return;
    this.loading = true;
    this.taskService.unclaimTask(this.currentTask.id).subscribe({
      next: () => {
        this.loading = false;
        this.showToast('Task returned to the pile.', 'success');
        this.taskChanged.emit();
        this.reset();
      },
      error: () => { this.loading = false; this.showToast('Failed to unclaim', 'error'); }
    });
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
