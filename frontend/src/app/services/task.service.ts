import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Category {
  id: string;
  name: string;
  color: string;
}

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
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
}

export interface TaskStats {
  overdue: number;
  open: number;
  claimedTask: Task | null;
}
export interface CreateTaskDto {
  name: string; description?: string; estimatedDuration: number; priority: number;
  dueDate?: string | null; recurring?: string; recurrenceDays?: number | null; categoryId?: string | null;
}
export interface UpdateTaskDto {
  name?: string; description?: string; estimatedDuration?: number; priority?: number;
  dueDate?: string | null; status?: 'open' | 'closed'; recurring?: string;
  recurrenceDays?: number | null; categoryId?: string | null;
}
export type SortField = 'dateAdded' | 'priority' | 'dueDate' | 'name' | 'estimatedDuration';
export type SortOrder = 'asc' | 'desc';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private api = environment.apiUrl;
  constructor(private http: HttpClient, private auth: AuthService) {}

  private h(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.accessToken}` });
  }

  // Categories
  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.api}/categories`, { headers: this.h() });
  }
  createCategory(name: string, color: string): Observable<Category> {
    return this.http.post<Category>(`${this.api}/categories`, { name, color }, { headers: this.h() });
  }
  updateCategory(id: string, name: string, color: string): Observable<Category> {
    return this.http.put<Category>(`${this.api}/categories/${id}`, { name, color }, { headers: this.h() });
  }
  deleteCategory(id: string): Observable<any> {
    return this.http.delete(`${this.api}/categories/${id}`, { headers: this.h() });
  }

  // Tasks
  getTasks(status?: string, sort?: SortField, order?: SortOrder, categoryId?: string): Observable<Task[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (sort) params = params.set('sort', sort);
    if (order) params = params.set('order', order);
    if (categoryId !== undefined) params = params.set('categoryId', categoryId);
    return this.http.get<Task[]>(`${this.api}/tasks`, { headers: this.h(), params });
  }
  getStats(): Observable<TaskStats> {
    return this.http.get<TaskStats>(`${this.api}/tasks/stats`, { headers: this.h() });
  }
  createTask(dto: CreateTaskDto): Observable<Task> {
    return this.http.post<Task>(`${this.api}/tasks`, dto, { headers: this.h() });
  }
  updateTask(id: string, dto: UpdateTaskDto): Observable<Task> {
    return this.http.put<Task>(`${this.api}/tasks/${id}`, dto, { headers: this.h() });
  }
  deleteTask(id: string): Observable<any> {
    return this.http.delete(`${this.api}/tasks/${id}`, { headers: this.h() });
  }
  suggestTask(availableMinutes: number, excludeIds: string[]): Observable<{ task: Task | null }> {
    return this.http.post<{ task: Task | null }>(
      `${this.api}/tasks/suggest`, { availableMinutes, excludeIds }, { headers: this.h() }
    );
  }
  claimTask(id: string): Observable<Task> {
    return this.http.put<Task>(`${this.api}/tasks/${id}`, { claim: true }, { headers: this.h() });
  }
  unclaimTask(id: string): Observable<Task> {
    return this.http.put<Task>(`${this.api}/tasks/${id}`, { claim: false }, { headers: this.h() });
  }
  exportCsv(): Observable<Blob> {
    return this.http.get(`${this.api}/tasks/export`, { headers: this.h(), responseType: 'blob' });
  }
  importCsv(csv: string): Observable<{ created: number; updated: number; skipped: number; errors: string[] }> {
    return this.http.post<{ created: number; updated: number; skipped: number; errors: string[] }>(
      `${this.api}/tasks/import`, { csv }, { headers: this.h() }
    );
  }

  getFeatures(): Observable<any> {
    return this.http.get<any>(`${this.api}/settings/features`, { headers: this.h() });
  }

  updateFeatures(features: any): Observable<any> {
    return this.http.put<any>(`${this.api}/settings/features`, features, { headers: this.h() });
  }
}
