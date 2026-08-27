import { apiRequest } from '@/api/client';

export interface AgentInstructRequest {
  roomId: string;
  prompt: string;
  level?: string;
  style?: string;
}

export interface AgentInstructResponse {
  ok?: boolean;
  message?: string;
  roomId?: string;
  prompt?: string;
  error?: string;
}

export interface AgentHealthResponse {
  status: string;
  service: string;
  model: string;
  activeSessions: number;
  timestamp: string;
}

export function instructAgent(input: AgentInstructRequest) {
  return apiRequest<AgentInstructResponse>({
    url: '/agent/instruct',
    method: 'POST',
    data: input,
  });
}

export function stopAgent(roomId: string) {
  return apiRequest<{ ok: boolean; message: string }>({
    url: '/agent/stop',
    method: 'POST',
    data: { roomId },
  });
}

export function getAgentHealth() {
  return apiRequest<AgentHealthResponse>({
    url: '/agent/health',
    method: 'GET',
  });
}
