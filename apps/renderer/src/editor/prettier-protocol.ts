export interface WorkerRequest {
  id: number;
  code: string;
  parser: 'babel' | 'typescript' | 'tsx';
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  code?: string;
  error?: string;
}
