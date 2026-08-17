import { apiRequest } from '@/api/client';
import type {
  CreateFeedbackRequest,
  CreateFeedbackResponse,
  ListFeedbackResponse,
  ListRoomFeedbackResponse,
  SubmitRoomSessionFeedbackRequest,
  SubmitRoomSessionFeedbackResponse,
  UpdateFeedbackStatusRequest,
  UpdateFeedbackStatusResponse,
} from '@/api/types';

export function createFeedback(input: CreateFeedbackRequest) {
  return apiRequest<CreateFeedbackResponse>({ url: '/feedback', method: 'POST', data: input });
}

export function submitRoomSessionFeedback(slug: string, input: SubmitRoomSessionFeedbackRequest) {
  return apiRequest<SubmitRoomSessionFeedbackResponse>({
    url: `/feedback/room/${encodeURIComponent(slug)}`,
    method: 'POST',
    data: input,
  });
}

export function listAdminFeedback(status?: string, category?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  const query = params.toString();
  return apiRequest<ListFeedbackResponse>({
    url: `/admin/feedback${query ? `?${query}` : ''}`,
    method: 'GET',
  });
}

export function listAdminRoomFeedback() {
  return apiRequest<ListRoomFeedbackResponse>({ url: '/admin/feedback/room', method: 'GET' });
}

export function updateFeedbackStatus(id: string, input: UpdateFeedbackStatusRequest) {
  return apiRequest<UpdateFeedbackStatusResponse>({
    url: `/admin/feedback/${encodeURIComponent(id)}`,
    method: 'PATCH',
    data: input,
  });
}