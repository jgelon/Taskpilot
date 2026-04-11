import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Task {
  id: string;
  name: string;
  description: string;
  estimatedDuration: number;
  priority: number;
  dueDate: string | null;
  dateAdded: string;
  status: 'open' | 'closed';
  createdBy: string;
  createdByName: string;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  recurring: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  recurrenceDays: number | null;
}

export interface TaskStats {
  overdue: number;
  open: number;
}

export interface CreateTaskDto {
  name: string;
  description?: string;
  estimatedDuration: number;
  priority: number;
  dueDate?: string | null;
  recurring?: string;
  recurrenceDays?: number | null;
}

export interface UpdateTaskDto {
  name?: string;
  description?: string;
  estimatedDuration?: number;
  priority?: number;
  dueDate?: string | null;
  status?: 'open' | 'closed';
  recurring?: string;
  recurrenceDays?: number | null;
}

export type SortField = 'dateAdded' | 'priority' | 'dueDate' | 'name' | 'estimatedDuration';
export type SortOrder = 'asc' | 'desc';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient, private auth: AuthService) {}

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.accessToken}` });
  }

  getTasks(status?: string, sort?: SortField, order?: SortOrder): Observable<Task[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (sort) params = params.set('sort', sort);
    if (order) params = params.set('order', order);
    return this.http.get<Task[]>(`${this.api}/tasks`, { headers: this.headers(), params });
  }

  getStats(): Observable<TaskStats> {
    return this.http.get<TaskStats>(`${this.api}/tasks/stats`, { headers: this.headers() });
  }

  createTask(dto: CreateTaskDto): Observable<Task> {
    return this.http.post<Task>(`${this.api}/tasks`, dto, { headers: this.headers() });
  }

  updateTask(id: string, dto: UpdateTaskDto): Observable<Task> {
    return this.http.put<Task>(`${this.api}/tasks/${id}`, dto, { headers: this.headers() });
  }

  deleteTask(id: string): Observable<any> {
    return this.http.delete(`${this.api}/tasks/${id}`, { headers: this.headers() });
  }

  suggestTask(availableMinutes: number, excludeIds: string[]): Observable<{ task: Task | null }> {
    return this.http.post<{ task: Task | null }>(
      `${this.api}/tasks/suggest`,
      { availableMinutes, excludeIds },
      { headers: this.headers() }
    );
  }
}
