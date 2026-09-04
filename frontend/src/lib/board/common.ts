import { getBoard } from '@/stores/boardStore';
export interface CommandResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}
export function requireSocket(): CommandResult {
    const { socket } = getBoard();
    if (!socket) return { ok: false, error: 'no socket connection' };
    return { ok: true };
}
export function requireSelection(): CommandResult {
    const { selectedStrokeIds } = getBoard();
    if (selectedStrokeIds.length === 0) return { ok: false, error: 'no selection' };
    return { ok: true };
}
