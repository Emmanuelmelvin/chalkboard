import { apiRequest } from '@/api/client';
import type {
  ListDashboardRoomRatingsResponse,
  SubmitRoomSessionFeedbackRequest,
  SubmitRoomSessionFeedbackResponse,
} from '@/api/types';

export function submitRoomSessionFeedback(slug: string, input: SubmitRoomSessionFeedbackRequest) {
  return apiRequest<SubmitRoomSessionFeedbackResponse>({
    url: `/feedback/room/${encodeURIComponent(slug)}`,
    method: 'POST',
    data: input,
  });
}

export function listDashboardRoomRatings() {
  return apiRequest<ListDashboardRoomRatingsResponse>({ url: '/feedback/dashboard', method: 'GET' });
}