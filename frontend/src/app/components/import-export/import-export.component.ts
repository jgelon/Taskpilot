import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../services/task.service';

type ImportState = 'idle' | 'loading' | 'result';

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './import-export.component.html',
  styleUrl: './import-export.component.scss'
})
export class ImportExportComponent {
  @Output() done = new EventEmitter<void>();

  exportLoading = false;
  importState: ImportState = 'idle';
  importResult: { created: number; updated: number; skipped: number; errors: string[] } | null = null;
  importError: string | null = null;
  dragOver = false;

  constructor(private taskService: TaskService) {}

  exportCsv() {
    this.exportLoading = true;
    this.taskService.exportCsv().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taskpilot-export-${new Date().toISOString().substring(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportLoading = false;
      },
      error: () => {
        this.exportLoading = false;
        this.importError = 'Export failed. Please try again.';
      }
    });
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.readAndImport(file);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readAndImport(file);
  }

  onDragOver(event: DragEvent) { event.preventDefault(); this.dragOver = true; }
  onDragLeave() { this.dragOver = false; }

  readAndImport(file: File) {
    if (!file.name.endsWith('.csv')) {
      this.importError = 'Please select a .csv file.';
      return;
    }
    this.importError = null;
    this.importState = 'loading';
    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target?.result as string;
      this.taskService.importCsv(csv).subscribe({
        next: (result) => {
          this.importResult = result;
          this.importState = 'result';
        },
        error: (err) => {
          this.importState = 'idle';
          this.importError = err?.error?.error || 'Import failed. Check the file format.';
        }
      });
    };
    reader.readAsText(file);
  }

  reset() {
    this.importState = 'idle';
    this.importResult = null;
    this.importError = null;
  }
}
