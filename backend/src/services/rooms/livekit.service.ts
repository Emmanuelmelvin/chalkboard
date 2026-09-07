import { AccessToken } from 'livekit-server-sdk';
import { env } from '@/config/env';

export async function createVoiceToken({ roomName, identity, name, canPublish }: any) {
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity, name, ttl: '1h' });
  token.addGrant({ room: roomName, roomJoin: true, canSubscribe: true, canPublish, canPublishData: true });
  return await token.toJwt();
}
