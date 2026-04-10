import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CreateTaskComponent } from './components/create-task/create-task.component';
import { TaskListComponent } from './components/task-list/task-list.component';
import { GetTaskComponent } from './components/get-task/get-task.component';
import { AuthService } from './services/auth.service';

type View = 'home' | 'create' | 'list' | 'get';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CreateTaskComponent, TaskListComponent, GetTaskComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  currentView: View = 'home';
  window = window;

  constructor(public auth: AuthService) {}

  setView(view: View) { this.currentView = view; }
}
