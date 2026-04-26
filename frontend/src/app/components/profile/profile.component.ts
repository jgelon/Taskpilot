import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  todoistToken = '';
  todoistConnected = false;
  loading = false;
  saving = false;
  showToken = false;
  toast: { msg: string; type: string } | null = null;

  constructor(public auth: AuthService, private taskService: TaskService) {}

  ngOnInit() {
    this.loading = true;
    this.taskService.getPreferences().subscribe({
      next: p => { this.todoistConnected = p.todoistConnected; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  save() {
    this.saving = true;
    this.taskService.savePreferences(this.todoistToken.trim()).subscribe({
      next: p => {
        this.todoistConnected = p.todoistConnected;
        this.todoistToken = '';
        this.saving = false;
        this.showToken = false;
        this.showToast(p.todoistConnected ? 'Todoist connected!' : 'Token removed', 'success');
      },
      error: () => { this.saving = false; this.showToast('Failed to save', 'error'); }
    });
  }

  disconnect() {
    this.todoistToken = '';
    this.save();
  }

  showToast(msg: string, type: string) {
    this.toast = { msg, type };
    setTimeout(() => this.toast = null, 3000);
  }
}
