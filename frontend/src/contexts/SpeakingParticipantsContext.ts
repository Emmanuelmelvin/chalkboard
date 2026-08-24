import { createContext } from 'react';

export const SpeakingParticipantsContext = createContext<ReadonlySet<string>>(new Set());
