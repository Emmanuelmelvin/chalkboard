import
React,
{
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback
} from 'react';
import {
  Copy,
  Check,
  ChevronDown,
  UsersRound,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Shapes,
  Eye,
  EyeOff
} from 'lucide-react';
import Toolbar from '@/pages/Toolbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import UserAvatar from '@/components/UserAvatar';
import ConfirmModal from '@/components/ui/ConfirmModal';
import LinkIcon from '@/components/svg/LinkIcon';
import { getCanvasCursor } from '@/components/svg/cursors';
import {
  getCombinedBoundingBox,
  getSelectionBoundingBox,
  rotatePoint,
} from '@/lib/geometry';
import {
  transformStrokes,
  rotateStrokesTo,
} from '@/lib/strokes';
import type {
  ShapeType,
  ChalkboardProps,
  RoomMember,
} from '@/types';
import type {
  PluginManifest,
  PluginSelectionToolContribution,
  PluginToolContribution
} from '@/plugins/types';
import { filterPluginSelectionTools } from '@/plugins/selection';
import ActionSticks from '@/components/tools/ActionSticks';
import SelectionToolbox from '@/components/tools/SelectionToolbox';
import InsertShapes from '@/components/tools/InsertShapes';
import ChatPanel from '@/components/ChatPanel';
import PluginModal from '@/components/tools/PluginModal';
import NotesLayer from '@/plugins/builtin/notes/NotesLayer';
import NotesEditor from '@/plugins/builtin/notes/NotesEditor';
import { NOTES_PLUGIN_ID } from '@/plugins/builtin/notes';
import { useLinksStore } from '@/stores/linksStore';
import { useBoardStore } from '@/stores/boardStore';
import { useLoggerStore } from '@/stores/loggerStore';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '@/lib/zoom';
import { useCanvasRenderer } from '@/hooks/useCanvasRenderer';
import { useCanvasInteraction } from '@/hooks/useCanvasInteraction';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useBoardSocket } from '@/hooks/useBoardSocket';
import {
  useJoinRequestsQuery,
  usePluginCatalogueQuery,
  usePluginCataloguePluginQuery,
  useResolveJoinRequestMutation,
  useRoomQuery
} from '@/api/hooks';
import {
  createPluginAPI,
  pluginRegistry,
  registerInstalledPlugins
} from '@/plugins';
import {
  publishedPluginDefinition,
  publishedPluginManifest,
  PublishedPluginRuntime,
  type PublishedPluginCommandRequest
} from '@/plugins/publishedRuntime';
import {
  normalizePublishedBoardInsertStrokes,
  PUBLISHED_PLUGIN_INSERT_STROKES,
} from '@/plugins/publishedBridge';
import {
  handleUndo,
  handleRedo,
  handleClear,
  handleCopy,
  handleCut,
  handleDuplicate,
  handleGroup,
  handleUngroup,
  handleIncreaseSize,
  handleDecreaseSize,
  handleStartTrim,
  handleApplyTrim,
  handleResetTrim,
  handleCancelTrim,
  handleCreateLink,
  handleDeleteLink,
  handleRenameLink,
  handleNavigateToLink,
  handleInsertShape as toolboxInsertShape,
} from '@/components/toolbox';

const DEFAULT_DOCUMENT_TITLE = 'Chalkboard - A live canvas for shared thinking';
type PendingJoinRequest = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
};

export const Chalkboard: React.FC<ChalkboardProps> = ({
  roomId,
  userId,
  userName,
  socket,
  roomPassword,
  onLeaveRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    activeTool, setActiveTool,
    selectedStrokeIds, setSelectedStrokeIds,
    transformBox, setTransformBox,
    selectionRotation, setSelectionRotation,
    activeColor, setActiveColor,
    brushSize, setBrushSize,
    brushIntensity, setBrushIntensity,
    eraserWidth, setEraserWidth,
    eraserHeight, setEraserHeight,
    panOffset, setPanOffset,
    zoom, setZoom,
    strokes, setStrokes,
    redoStack,
    trimState,
    showInsertShapes, setShowInsertShapes,
    insertShapesTab, setInsertShapesTab,
    highlightedLinkId, setHighlightedLinkId,
    isCopied, setIsCopied,
    initSession,
    setCanvas,
    spacePressed,
    activeFillColor, setActiveFillColor,
    showSelectionToolbox, setShowSelectionToolbox,
    noteEditorRequest,
  } = useBoardStore();

  const { links, removeLink } = useLinksStore();
  const pluginApi = useMemo(() => createPluginAPI(), []);
  const handlePublishedPluginCommand = useCallback((request: PublishedPluginCommandRequest) => {
    if (request.command !== PUBLISHED_PLUGIN_INSERT_STROKES) return false;
    if (!useBoardStore.getState().canEdit) return false;
    const normalized = normalizePublishedBoardInsertStrokes(
      request.payload,
      pluginApi.board.getUserId(),
      request.pluginId,
    );
    if (!normalized) return false;
    return pluginApi.board.insertStrokes(normalized.strokes, normalized.options);
  }, [pluginApi]);
  const getPublishedPluginContext = useCallback(() => ({
    viewportCenter: pluginApi.board.getViewportCenter(),
  }), [pluginApi]);
  const publishedRuntime = useMemo(
    () => new PublishedPluginRuntime(handlePublishedPluginCommand, getPublishedPluginContext),
    [getPublishedPluginContext, handlePublishedPluginCommand],
  );

  useEffect(() => () => publishedRuntime.dispose(), [publishedRuntime]);

  const publishedPluginsQuery = usePluginCatalogueQuery();
  const publishedCataloguePlugins = useMemo(
    () => publishedPluginsQuery.data?.plugins ?? [],
    [publishedPluginsQuery.data],
  );
  const [activePublishedPluginId, setActivePublishedPluginId] = useState<string | null>(null);
  const publishedPluginDetailQuery = usePluginCataloguePluginQuery(activePublishedPluginId);
  const pendingPublishedCommandRef = useRef<{ pluginId: string; commandId: string } | null>(null);
  const publishedManifests = useMemo(
    () => publishedCataloguePlugins.map(publishedPluginManifest).filter((plugin): plugin is PluginManifest => Boolean(plugin)),
    [publishedCataloguePlugins],
  );
  const publishedPluginDefinitions = useMemo(() => {
    const plugin = publishedPluginDetailQuery.data?.plugin;
    const definition = plugin ? publishedPluginDefinition(plugin) : null;
    return definition ? [definition] : [];
  }, [publishedPluginDetailQuery.data]);

  useEffect(() => {
    if (publishedPluginsQuery.error) useLoggerStore.getState().notify('Published plugins could not be loaded for this room.', 'warning');
  }, [publishedPluginsQuery.error]);

  useEffect(() => {
    publishedRuntime.mount(publishedPluginDefinitions);
  }, [publishedPluginDefinitions, publishedRuntime]);
  useEffect(() => {
    const pendingCommand = pendingPublishedCommandRef.current;
    if (!pendingCommand || !publishedPluginDefinitions.some((definition) => definition.pluginId === pendingCommand.pluginId)) return;
    if (publishedRuntime.execute(pendingCommand.pluginId, pendingCommand.commandId)) {
      pendingPublishedCommandRef.current = null;
    }
  }, [publishedPluginDefinitions, publishedRuntime]);
  const pluginManifests = useMemo(() => {
    registerInstalledPlugins();
    return [...pluginRegistry.getManifests(), ...publishedManifests];
  }, [publishedManifests]);
  const publishedTools = useMemo<PluginToolContribution[]>(() => publishedManifests.flatMap((manifest) => manifest.contributes.tools?.map((tool) => ({ ...tool, pluginId: manifest.id, description: tool.description ?? manifest.description })) ?? []), [publishedManifests]);
  const pluginTools = useMemo(() => [...pluginRegistry.getTools(), ...publishedTools], [publishedTools]);
  const publishedSelectionTools = useMemo<PluginSelectionToolContribution[]>(() => publishedManifests.flatMap((manifest) => manifest.contributes.selectionTools?.map((tool) => ({ ...tool, pluginId: manifest.id, description: tool.description ?? manifest.description })) ?? []), [publishedManifests]);
  const pluginSelectionTools = useMemo(() => [...pluginRegistry.getSelectionTools(), ...publishedSelectionTools], [publishedSelectionTools]);
  const selectionToolsForCurrentSelection = useMemo(() => filterPluginSelectionTools(
    pluginSelectionTools,
    strokes.filter((stroke) => selectedStrokeIds.includes(stroke.id)),
  ), [pluginSelectionTools, selectedStrokeIds, strokes]);
  const [activePluginModals, setActivePluginModals] = useState<Array<{ pluginId: string }>>([]);
  const [sharedPluginOutput, setSharedPluginOutput] = useState<string | undefined>();
  const [liveRoomMembers, setLiveRoomMembers] = useState<RoomMember[] | null>(null);
  const [joinRequestAction, setJoinRequestAction] = useState<string | null>(null);
  const [joinRequestError, setJoinRequestError] = useState('');
  const [roomDetailsOpen, setRoomDetailsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roleUpdateError, setRoleUpdateError] = useState('');
  const [kickMemberError, setKickMemberError] = useState('');
  const [kickingMemberId, setKickingMemberId] = useState<string | null>(null);
  const [kickPending, setKickPending] = useState<{ member: RoomMember; targetSocketId: string } | null>(null);
  const [closeRoomPending, setCloseRoomPending] = useState(false);
  const [closingRoom, setClosingRoom] = useState(false);
  const roomClosureHandledRef = useRef(false);
  const roomDetailsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const board = containerRef.current;
    if (!board) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await board.requestFullscreen();
      }
    } catch {
      useLoggerStore.getState().notify('Fullscreen mode is unavailable in this browser.', 'warning');
    }
  };

  const hasNavigatedToLink = useRef<boolean>(false);
  const activateInstalledPlugin = useCallback(async (pluginId: string) => {
    registerInstalledPlugins();
    await pluginRegistry.activatePlugin(pluginId, pluginApi);
  }, [pluginApi]);

  const openPluginModal = useCallback((pluginId: string) => {
    setShowInsertShapes(false);
    if (publishedCataloguePlugins.some((plugin) => plugin.pluginId === pluginId)) {
      setActivePublishedPluginId(pluginId);
      setActivePluginModals((current) => current.some((modal) => modal.pluginId === pluginId)
        ? current
        : [...current, { pluginId }]);
      return;
    }
    if (pluginId === NOTES_PLUGIN_ID) {
      setActivePublishedPluginId(null);
      void activateInstalledPlugin(NOTES_PLUGIN_ID).then(() => pluginRegistry.executeCommand('notes.create'));
      return;
    }
    setActivePublishedPluginId(null);
    setActivePluginModals((current) => current.some((modal) => modal.pluginId === pluginId)
      ? current
      : [...current, { pluginId }]);
  }, [activateInstalledPlugin, publishedCataloguePlugins, setShowInsertShapes]);

  const runPluginSelectionTool = useCallback((commandId: string) => {
    const tool = selectionToolsForCurrentSelection.find((candidate) => candidate.command === commandId);
    if (tool?.pluginId === 'chalkboard.tag' && selectedStrokeIds.length > 0 && commandId !== 'tag.removeSelection') openPluginModal(tool.pluginId);
    else if (tool?.pluginId === 'chalkboard.math-set' && selectedStrokeIds.length > 0) openPluginModal(tool.pluginId);
    else if (tool?.pluginId && publishedCataloguePlugins.some((plugin) => plugin.pluginId === tool.pluginId)) {
      setActivePublishedPluginId(tool.pluginId);
      pendingPublishedCommandRef.current = { pluginId: tool.pluginId, commandId };
    } else if (tool?.pluginId) {
      void activateInstalledPlugin(tool.pluginId).then(() => pluginRegistry.executeCommand(commandId));
    } else {
      void pluginRegistry.executeCommand(commandId);
    }
  }, [activateInstalledPlugin, openPluginModal, publishedCataloguePlugins, selectedStrokeIds.length, selectionToolsForCurrentSelection]);

  useCanvasRenderer(canvasRef);

  useEffect(() => {
    void pluginRegistry.activateAll(pluginApi);
  }, [pluginApi]);

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    transformMode,
    hoveredHandle,
    isPanning,
    dustPuffs,
  } = useCanvasInteraction(canvasRef);

  const {
    collaborators,
    userCursorColor,
    currentRole,
    onlineCount,
    chatMessages,
    chatUnreadMentions,
    clearChatNotifications,
  } = useBoardSocket(socket, roomId, userName, userId, roomPassword);
  const roomQuery = useRoomQuery(roomId);
  const room = roomQuery.data?.room;
  const roomTheme = room?.theme ?? 'classroom';
  const roomAccessMode = room?.accessMode ?? 'open';
  const roomTitle = room?.title?.trim() || `Room ${roomId}`;
  const roomDescription = typeof room?.description === 'string' ? room.description : '';
  const roomMembers = useMemo(() => liveRoomMembers ?? roomQuery.data?.members ?? [], [liveRoomMembers, roomQuery.data?.members]);
  const effectiveRole = roomMembers.find((member) => member.userId === userId)?.role ?? currentRole;
  const canEdit = effectiveRole !== 'viewer';
  const canManageMembers = effectiveRole === 'owner';
  const joinRequestsQuery = useJoinRequestsQuery(roomId, canManageMembers && roomDetailsOpen && roomAccessMode === 'approval_required');
  const resolveJoinRequestMutation = useResolveJoinRequestMutation();
  const joinRequests = joinRequestsQuery.data?.requests ?? [];
  const joinRequestsLoading = joinRequestsQuery.isLoading || joinRequestsQuery.isFetching;

  const resolveJoinRequest = useCallback(async (request: PendingJoinRequest, decision: 'approve' | 'deny') => {
    const actionKey = `${decision}:${request.userId}`;
    setJoinRequestAction(actionKey);
    setJoinRequestError('');
    try {
      await resolveJoinRequestMutation.mutateAsync({ slug: roomId, userId: request.userId, decision });
      useLoggerStore.getState().notify(
        `${request.displayName} was ${decision === 'approve' ? 'approved' : 'declined'}.`,
        decision === 'approve' ? 'success' : 'info',
      );
    } catch (error) {
      setJoinRequestError(error instanceof Error ? error.message : `We could not ${decision} this request.`);
    } finally {
      setJoinRequestAction(null);
    }
  }, [resolveJoinRequestMutation, roomId]);

  const displayedRoomMembers = useMemo(() => {
    const members = new Map<string, RoomMember>(roomMembers.map((member) => [member.userId, member]));
    if (!members.has(userId)) {
      members.set(userId, {
        id: `presence-${userId}`,
        userId,
        displayName: userName,
        email: '',
        role: effectiveRole,
      });
    }
    Object.values(collaborators).forEach((collaborator) => {
      if (!members.has(collaborator.userId)) {
        members.set(collaborator.userId, {
          id: `presence-${collaborator.userId}`,
          userId: collaborator.userId,
          displayName: collaborator.name,
          email: '',
          avatarUrl: collaborator.avatarUrl,
          role: collaborator.role,
        });
      }
    });
    return [...members.values()];
  }, [roomMembers, collaborators, userId, userName, effectiveRole]);

  useKeyboardShortcuts(canEdit);

  useEffect(() => {
    const title = roomTitle.trim() || `Room ${roomId}`;
    document.title = `${title} - Chalkboard`;

    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [roomId, roomTitle]);

  useEffect(() => {
    initSession({ roomId, socket, userId, canEdit });
  }, [roomId, socket, userId, canEdit, initSession]);

  useEffect(() => {
    const handleMembersUpdated = (payload: { members?: RoomMember[] }) => {
      if (Array.isArray(payload.members)) setLiveRoomMembers(payload.members);
    };
    socket.on('room-members-updated', handleMembersUpdated);
    return () => { socket.off('room-members-updated', handleMembersUpdated); };
  }, [socket]);

  useEffect(() => {
    const handleJoinRequest = (payload: { roomId?: string; requester?: { displayName?: string } }) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      const requesterName = payload.requester?.displayName?.trim() || 'A user';
      if (canManageMembers) {
        setRoomDetailsOpen(true);
      }
      useLoggerStore.getState().notify(
        `${requesterName} requested to join this room. Approve or decline them from the room dropdown.`,
        'info',
        8000,
      );
    };
    socket.on('room:join-requested', handleJoinRequest);
    return () => { socket.off('room:join-requested', handleJoinRequest); };
  }, [socket, roomId, canManageMembers]);

  const leaveClosedRoom = useCallback(() => {
    if (roomClosureHandledRef.current) return;
    roomClosureHandledRef.current = true;
    useLoggerStore.getState().notify('The owner closed this room.', 'info', 5000);
    onLeaveRoom();
  }, [onLeaveRoom]);

  useEffect(() => {
    roomClosureHandledRef.current = false;
    const handleRoomClosed = (payload: { roomId?: string }) => {
      if (payload?.roomId && payload.roomId !== roomId) return;
      leaveClosedRoom();
    };
    socket.on('room:closed', handleRoomClosed);
    return () => { socket.off('room:closed', handleRoomClosed); };
  }, [socket, roomId, leaveClosedRoom]);

  useEffect(() => {
    const handleMemberKicked = (payload: { roomId?: string; reason?: string }) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      useLoggerStore.getState().notify(
        payload.reason ? `You were removed from the room: ${payload.reason}` : 'You were removed from the room.',
        'error',
        5000,
      );
      onLeaveRoom();
    };
    socket.on('member:kicked', handleMemberKicked);
    return () => { socket.off('member:kicked', handleMemberKicked); };
  }, [socket, roomId, onLeaveRoom]);

  useEffect(() => {
    if (!roomDetailsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!roomDetailsRef.current?.contains(event.target as Node)) setRoomDetailsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRoomDetailsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [roomDetailsOpen]);

  const updateMemberRole = (targetUserId: string, role: 'instructor' | 'viewer') => {
    if (!canManageMembers || targetUserId === userId) return;
    setRoleUpdateError('');
    socket.emit('member:update-role', { roomId, targetUserId, role }, (response: { ok?: boolean; error?: string }) => {
      if (!response?.ok) setRoleUpdateError(response?.error || 'Unable to update this member.');
    });
  };

  const requestCloseRoom = () => {
    setRoomDetailsOpen(false);
    setCloseRoomPending(true);
  };

  const closeRoom = () => {
    setClosingRoom(true);
    socket.emit('room:close', { roomId }, (response: { ok?: boolean; error?: string }) => {
      if (response?.ok) {
        setCloseRoomPending(false);
        setClosingRoom(false);
        leaveClosedRoom();
        return;
      }
      setClosingRoom(false);
      setCloseRoomPending(false);
      useLoggerStore.getState().notify(
        response?.error === 'forbidden' ? 'Only the room owner can close this room.' : `Unable to close the room${response?.error ? `: ${response.error}` : ''}`,
        'error',
        5000,
      );
    });
  };

  const roleLabel = (role: RoomMember['role']) => role === 'instructor' ? 'Editor' : role === 'viewer' ? 'Viewer' : 'Owner';

  useEffect(() => {
    setCanvas(canvasRef.current);
    return () => setCanvas(null);
  }, [setCanvas]);

  // Auto-apply crop/trim on tool change, and deselect when leaving select tool
  useEffect(() => {
    if (activeTool !== 'select') {
      if (trimState.active) {
        handleApplyTrim();
      }
      if (selectedStrokeIds.length > 0) {
        setSelectedStrokeIds([]);
        setTransformBox(null);
        setSelectionRotation(0);
      }
    }
  }, [activeTool, trimState.active, selectedStrokeIds.length, setSelectedStrokeIds, setTransformBox, setSelectionRotation]);

  // Navigate to link from URL on initial load
  useEffect(() => {
    if (hasNavigatedToLink.current) return;
    const url = new URL(window.location.href);
    const linkId = url.searchParams.get('link');
    if (!linkId) { hasNavigatedToLink.current = true; return; }
    if (strokes.length > 0 && links.length > 0) {
      const link = links.find(l => l.id === linkId);
      if (link) { hasNavigatedToLink.current = true; handleNavigateToLink(link); }
    }
  }, [strokes.length, links]);

  const handleCopyLink = () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const resetPanZoom = () => {
    setZoom(DEFAULT_ZOOM);
    setPanOffset({ x: 0, y: 0 });
  };

  const requestKickMember = (member: RoomMember, targetSocketId: string) => {
    if (!canEdit || member.userId === userId || member.role === 'owner' || kickingMemberId) return;
    setKickMemberError('');
    setKickPending({ member, targetSocketId });
  };

  const kickMember = () => {
    if (!kickPending) return;
    const { member, targetSocketId } = kickPending;
    setKickingMemberId(member.userId);
    setKickMemberError('');
    socket.emit('member:kick', { roomId, targetSocketId }, (response: { ok?: boolean; error?: string }) => {
      setKickingMemberId(null);
      if (!response?.ok) {
        setKickMemberError(
          response?.error === 'target_not_found'
            ? `${member.displayName} is no longer online.`
            : response?.error === 'forbidden'
              ? 'You do not have permission to remove this member.'
              : 'Unable to remove this member.',
        );
        return;
      }
      setKickPending(null);
      useLoggerStore.getState().notify(`${member.displayName} was removed from the room.`, 'success');
    });
  };

  const canvasCursor = useMemo(() => getCanvasCursor({
    activeTool,
    activeColor,
    eraserWidth,
    eraserHeight,
    zoom,
    spacePressed,
    isPanning,
    transformMode,
    hoveredHandle,
  }), [activeColor, activeTool, eraserHeight, eraserWidth, hoveredHandle, isPanning, spacePressed, transformMode, zoom]);

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = canvasCursor;
  }, [canvasCursor]);

  return (
    <div className={`board-container room-theme-${roomTheme}`} ref={containerRef}>
      <div className="blackboard-slate" />
      {dustPuffs.map((p) => (
        <div key={p.id} className="dust-puff" data-left={p.x - 12} data-top={p.y - 12} data-size="24" />
      ))}
      {Object.entries(collaborators).map(([id, coll]) => {
        if (coll.role === 'viewer' || !coll.cursor) return null;
        const x = coll.cursor.x * zoom + panOffset.x + 24;
        const y = coll.cursor.y * zoom + panOffset.y + 24;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
        return (
          <div
            key={id}
            className="collaborator-cursor"
            data-left={x - 24}
            data-top={y - 24}
            title={`${coll.name}'s cursor`}
            aria-label={`${coll.name}'s cursor`}
          >
            <UserAvatar name={coll.name} avatarUrl={coll.avatarUrl} size="sm" className="collaborator-avatar" />
            <span
              className="collaborator-cursor-dot"
              data-color={coll.color}
              aria-hidden="true"
            />
          </div>
        );
      })}
      <canvas ref={canvasRef} className={`chalk-canvas chalk-canvas-${activeTool}`}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp} onWheel={handleWheel} />
      <NotesLayer />

      {canEdit && showInsertShapes && (
        <InsertShapes onInsertShape={(shape: ShapeType) => toolboxInsertShape(shape)}
          pluginManifests={pluginManifests}
          onOpenPlugin={openPluginModal}
          onClose={() => { setShowInsertShapes(false); setHighlightedLinkId(null); }}
          links={links} hasSelection={selectedStrokeIds.length > 0} onNavigateToLink={handleNavigateToLink}
          onCreateLink={handleCreateLink} onDeleteLink={handleDeleteLink} onRenameLink={handleRenameLink}
          initialTab={insertShapesTab} highlightedLinkId={highlightedLinkId} />
      )}
      {canEdit && <button
        onClick={() => setShowInsertShapes(prev => !prev)}
        title="Insert Shape (Ctrl+1)"
        className="insert-shapes-fab"
      >
        <Shapes size={18} />
      </button>}
      <ChatPanel
        socket={socket}
        roomId={roomId}
        userId={userId}
        messages={chatMessages}
        members={displayedRoomMembers}
        unreadMentions={chatUnreadMentions}
        canEdit={canEdit}
        onClearUnread={clearChatNotifications}
      />
      <div className="hud-layer">
        {trimState.active && trimState.cropBox && (() => {
          const cropBox = trimState.cropBox;
          const initBox = trimState.initialBox;
          if (!initBox) return null;
          const screenLeft = cropBox.minX * zoom + panOffset.x;
          const screenTop = cropBox.minY * zoom + panOffset.y;
          const screenRight = cropBox.maxX * zoom + panOffset.x;
          const screenBottom = cropBox.maxY * zoom + panOffset.y;
          const fullLeft = initBox.minX * zoom + panOffset.x;
          const fullTop = initBox.minY * zoom + panOffset.y;
          const fullRight = initBox.maxX * zoom + panOffset.x;
          const fullBottom = initBox.maxY * zoom + panOffset.y;
          return (
            <>
              <div className="trim-overlay trim-overlay-top" data-left={fullLeft} data-top={fullTop} data-width={fullRight - fullLeft} data-height={Math.max(0, screenTop - fullTop)} />
              <div className="trim-overlay trim-overlay-bottom" data-left={fullLeft} data-top={screenBottom} data-width={fullRight - fullLeft} data-height={Math.max(0, fullBottom - screenBottom)} />
              <div className="trim-overlay trim-overlay-left" data-left={fullLeft} data-top={screenTop} data-width={Math.max(0, screenLeft - fullLeft)} data-height={screenBottom - screenTop} />
              <div className="trim-overlay trim-overlay-right" data-left={screenRight} data-top={screenTop} data-width={Math.max(0, fullRight - screenRight)} data-height={screenBottom - screenTop} />
              <div className="trim-selection-box" data-left={screenLeft} data-top={screenTop} data-width={screenRight - screenLeft} data-height={screenBottom - screenTop} />
              {[{ left: screenLeft - 5, top: screenTop - 5 }, { left: screenRight - 5, top: screenTop - 5 }, { left: screenLeft - 5, top: screenBottom - 5 }, { left: screenRight - 5, top: screenBottom - 5 }].map((pos, i) => (
                <div key={i} className="trim-handle" data-left={pos.left} data-top={pos.top} />
              ))}
              <div className="trim-toolbar" data-left={(screenLeft + screenRight) / 2} data-top={screenTop - 60}>
                <div className="trim-toolbar-copy">
                  <div className="trim-toolbar-title">CROP MODE</div>
                  <div className="trim-toolbar-hint">Enter to apply · Esc to cancel</div>
                </div>
                <div className="trim-toolbar-actions">
                  <button className="trim-apply-button" onClick={handleApplyTrim}>Apply</button>
                  <button className="trim-cancel-button" onClick={handleCancelTrim}>Cancel</button>
                </div>
              </div>
            </>
          );
        })()}
        {canEdit && selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const linkedLink = links.find(l => l.strokeIds.some(id => selectedStrokeIds.includes(id)));
          if (!linkedLink) return null;
          const LINK_PADDING = 12;
          const linkX = transformBox.minX * zoom + panOffset.x - LINK_PADDING - 24;
          const linkY = (transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y - 12;

          return (
            <button onClick={() => { setHighlightedLinkId(linkedLink.id); setInsertShapesTab('links'); setShowInsertShapes(true); }}
              className="selection-link-button"
              data-left={linkX}
              data-top={linkY}
              title="Click to view linked location">
              <LinkIcon />
            </button>
          );
        })()}

        {canEdit && selectedStrokeIds.length > 0 && transformBox && !transformMode && (() => {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const hasGroupId = selectedStrokes.length > 0 && selectedStrokes.every(s => s.groupId !== undefined);
          const actualColor = selectedStrokes.length > 0 ? selectedStrokes[0].color : activeColor;
          const actualFillColor = selectedStrokes.length > 0 ? (selectedStrokes[0].fillColor ?? 'transparent') : activeFillColor;

          // Compute panel position (mirrors SelectionToolbox logic)
          const BOX_SCREEN_LEFT = transformBox.minX * zoom + panOffset.x;
          const BOX_SCREEN_RIGHT = transformBox.maxX * zoom + panOffset.x;
          const BOX_SCREEN_CENTER_Y = (transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y;

          return (
            <>
              {showSelectionToolbox && (
                <SelectionToolbox
                  boxScreenLeft={BOX_SCREEN_LEFT}
                  boxScreenRight={BOX_SCREEN_RIGHT}
                  boxScreenCenterY={BOX_SCREEN_CENTER_Y}
                  activeColor={actualColor}
                  activeFillColor={actualFillColor}
                  onColorChange={(color) => { const updated = strokes.map(s => selectedStrokeIds.includes(s.id) && s.tool === 'chalk' ? { ...s, color } : s); setStrokes(updated); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onFillColorChange={(fillColor) => { const updated = strokes.map(s => selectedStrokeIds.includes(s.id) ? { ...s, fillColor } : s); setStrokes(updated); setActiveFillColor(fillColor); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onTrim={handleStartTrim} onResetTrim={handleResetTrim} onCut={handleCut}
                  onDelete={() => {
                    // Remove any links that reference the deleted strokes
                    const deletedIds = new Set(selectedStrokeIds);
                    links.forEach(l => {
                      if (l.strokeIds.some(id => deletedIds.has(id))) {
                        removeLink(l.id);
                      }
                    });
                    const updated = strokes.filter(s => !selectedStrokeIds.includes(s.id));
                    setStrokes(updated);
                    setSelectedStrokeIds([]);
                    setTransformBox(null);
                    setSelectionRotation(0);
                    socket.emit('undo-stroke', { roomId, strokes: updated });
                  }}
                  onDeselect={() => { if (trimState.active) handleApplyTrim(); setSelectedStrokeIds([]); setTransformBox(null); setSelectionRotation(0); }}
                  onIncreaseSize={handleIncreaseSize} onDecreaseSize={handleDecreaseSize}
                  onSetSize={(size) => { if (selectedStrokeIds.length === 0) return; const updated = strokes.map(s => selectedStrokeIds.includes(s.id) ? { ...s, size: Math.min(100, Math.max(1, size)) } : s); setStrokes(updated); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onCopy={handleCopy} onDuplicate={handleDuplicate} onGroup={handleGroup} onUngroup={handleUngroup}
                  onRotate={(angleDeg) => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const rotatable = selected.filter(s => s.pluginId !== 'chalkboard.tag'); const totalRotation = (rotatable[0]?.rotation ?? 0) + angleDeg; const rotated = rotateStrokesTo(rotatable, totalRotation); const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; }); setStrokes(updated); setSelectionRotation(totalRotation); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onResetRotation={() => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const box = getSelectionBoundingBox(selected); if (!box) return; const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }; const rotated = selected.filter(s => s.pluginId !== 'chalkboard.tag').map(s => { const currentAngle = s.rotation ?? 0; return { ...s, points: s.points.map(p => rotatePoint(p, center, -currentAngle)), rotation: 0 }; }); const updated = strokes.map(s => { const r = rotated.find(rs => rs.id === s.id); return r ? r : s; }); setStrokes(updated); setSelectionRotation(0); setTransformBox(getSelectionBoundingBox(selected)); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  onSetDimensions={(width, height) => { const selected = strokes.filter(s => selectedStrokeIds.includes(s.id)); const box = getCombinedBoundingBox(selected); if (!box) return; const newBox = { minX: box.minX, minY: box.minY, maxX: box.minX + width, maxY: box.minY + height }; const transformed = transformStrokes(selected, box, newBox); const updated = strokes.map(s => { const t = transformed.find(ts => ts.id === s.id); return t ? t : s; }); setStrokes(updated); setTransformBox(newBox); socket.emit('undo-stroke', { roomId, strokes: updated }); }}
                  currentRotation={selectionRotation} currentWidth={transformBox ? Math.round(transformBox.maxX - transformBox.minX) : 0}
                  currentHeight={transformBox ? Math.round(transformBox.maxY - transformBox.minY) : 0}
                  pluginSelectionTools={selectionToolsForCurrentSelection}
                  onRunPluginSelectionTool={runPluginSelectionTool}
                  selectedCount={selectedStrokeIds.length} isGrouped={hasGroupId} />
              )}
              {/* ── Selection toolbox toggle button ── */}
              <button
                onClick={() => setShowSelectionToolbox(prev => !prev)}
                title={`${showSelectionToolbox ? 'Hide' : 'Show'} Selection Toolbox (Ctrl+O)`}
                className={`selection-toolbox-toggle ${showSelectionToolbox ? 'active' : ''}`}
                data-left={BOX_SCREEN_RIGHT + 12}
                data-top={BOX_SCREEN_CENTER_Y - 11}
              >
                {showSelectionToolbox ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </>
          );
        })()}

        {canEdit && (
          <div className="board-actions-center">
            <Card className="board-actions-card">
              <ActionSticks onUndo={handleUndo} onRedo={handleRedo} onClear={handleClear}
                canUndo={strokes.some((s) => s.userId === socket.id || s.userId === 'local')} canRedo={redoStack.length > 0} />
            </Card>
          </div>
        )}

        <div className="board-header">
          <div className="board-header-tools">
            {!canEdit && (
              <div className="board-readonly-badge">Viewer · read only</div>
            )}
          </div>
          <div className="board-header-actions">
            <div className="room-details-menu" ref={roomDetailsRef}>
              <button
                type="button"
                className="room-details-trigger"
                onClick={() => { setRoomDetailsOpen((open) => !open); setRoleUpdateError(''); }}
                aria-expanded={roomDetailsOpen}
                aria-label="Open room details"
              >
                <UsersRound size={13} />
                <span>{onlineCount}</span>
                <ChevronDown size={11} className={roomDetailsOpen ? 'room-details-chevron open' : 'room-details-chevron'} />
              </button>
              {roomDetailsOpen && (
                <div className="room-details-popover">
                  <div className="room-details-heading">
                    <div>
                      <strong>{roomTitle}</strong>
                      <span>Room code: {roomId.toUpperCase()}</span>
                    </div>
                    <span className={canEdit ? 'room-role-pill room-role-editor' : 'room-role-pill'}>{roleLabel(effectiveRole)}</span>
                  </div>
                  {roomDescription && <p className="room-details-description">{roomDescription}</p>}
                  {canManageMembers && roomAccessMode === 'approval_required' && (
                    <section className="room-join-requests" aria-labelledby="room-join-requests-heading">
                      <div className="room-details-section-title" id="room-join-requests-heading">
                        Join requests <span>{joinRequests.length}</span>
                      </div>
                      {(joinRequestError || joinRequestsQuery.error) && <p className="room-details-error" role="alert">{joinRequestError || (joinRequestsQuery.error instanceof Error ? joinRequestsQuery.error.message : 'We could not load join requests.')}</p>}
                      {joinRequestsLoading ? (
                        <p className="room-join-requests-empty">Loading requests...</p>
                      ) : joinRequests.length === 0 ? (
                        <p className="room-join-requests-empty">No pending requests.</p>
                      ) : (
                        <div className="room-details-members">
                          {joinRequests.map((request) => {
                            const actionPending = Boolean(joinRequestAction);
                            return (
                              <div key={request.id} className="room-detail-member room-join-request-row">
                                <UserAvatar name={request.displayName} avatarUrl={request.avatarUrl} size="sm" className="room-member-avatar" />
                                <div className="room-member-name">
                                  <strong>{request.displayName}</strong>
                                  <span>{request.email || 'Waiting for approval'}</span>
                                </div>
                                <div className="room-join-request-controls">
                                  <span className="room-member-role">Pending</span>
                                  <button
                                    type="button"
                                    className="room-join-request-button room-join-request-approve"
                                    onClick={() => { void resolveJoinRequest(request, 'approve'); }}
                                    disabled={actionPending}
                                    aria-label={`Approve ${request.displayName}`}
                                  >
                                    {joinRequestAction === `approve:${request.userId}` ? '...' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    className="room-join-request-button room-join-request-deny"
                                    onClick={() => { void resolveJoinRequest(request, 'deny'); }}
                                    disabled={actionPending}
                                    aria-label={`Decline ${request.displayName}`}
                                  >
                                    {joinRequestAction === `deny:${request.userId}` ? '...' : 'Decline'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}
                  <div className="room-details-section-title">Members <span>{displayedRoomMembers.length} · {onlineCount} online</span></div>
                  <div className="room-details-members">
                    {displayedRoomMembers.map((member) => {
                      const collaborator = Object.values(collaborators).find((item) => item.userId === member.userId);
                      const isOnline = member.userId === userId || Boolean(collaborator);
                      return (
                        <div key={member.userId} className="room-detail-member">
                          <UserAvatar
                            name={member.displayName}
                            avatarUrl={member.avatarUrl || collaborator?.avatarUrl}
                            size="sm"
                            className="room-member-avatar"
                          />
                          <span className="room-member-presence" data-color={collaborator?.color || (member.userId === userId ? userCursorColor : '#64748b')} />
                          <div className="room-member-name">
                            <strong>{member.displayName}{member.userId === userId ? ' (You)' : ''}</strong>
                            <span>{isOnline ? 'Online' : 'Offline'}</span>
                          </div>
                          <div className="room-member-actions">
                            {canManageMembers && member.role !== 'owner' ? (
                              <select
                                className="room-member-role-select"
                                value={member.role}
                                onChange={(event) => updateMemberRole(member.userId, event.target.value as 'instructor' | 'viewer')}
                                aria-label={`Role for ${member.displayName}`}
                              >
                                <option value="instructor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            ) : (
                              <span className="room-member-role">{roleLabel(member.role)}</span>
                            )}
                            {canEdit && member.userId !== userId && member.role !== 'owner' && collaborator && (
                              <button
                                type="button"
                                className="room-member-kick-button"
                                onClick={() => requestKickMember(member, collaborator.id)}
                                disabled={Boolean(kickingMemberId)}
                                aria-label={`Kick ${member.displayName}`}
                              >
                                {kickingMemberId === member.userId ? '...' : 'Kick'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(roleUpdateError || kickMemberError) && <p className="room-details-error">{roleUpdateError || kickMemberError}</p>}
                  {canManageMembers && (
                    <button className="room-close-button" type="button" onClick={requestCloseRoom}>
                      Close room
                    </button>
                  )}
                </div>
              )}
            </div>
            <Card className="share-panel">
              <span className="room-code-badge">{roomId.toUpperCase()}</span>
              <Button variant="icon" onClick={handleCopyLink} title="Copy Invite Link">
                {isCopied ? <Check size={14} className="copy-success-icon" /> : <Copy size={14} />}
              </Button>
            </Card>
            <Button
              variant="icon"
              className="hud-panel fullscreen-toggle"
              onClick={() => { void toggleFullscreen(); }}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
            <Button variant="primary" className="hud-panel board-exit-button" onClick={onLeaveRoom}>Exit</Button>
          </div>
        </div>

        <div className="zoom-indicator">
          <Button variant="icon" className="zoom-control-button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.1))}><Minus size={12} /></Button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <Button variant="icon" className="zoom-control-button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.1))}><Plus size={12} /></Button>
          <Button variant="icon" className="zoom-control-button zoom-reset-button" onClick={resetPanZoom} title="Reset Pan/Zoom"><Maximize2 size={12} /></Button>
        </div>

        {canEdit && <Toolbar
          activeTool={activeTool}
          activeColor={activeColor}
          brushSize={brushSize}
          brushIntensity={brushIntensity}
          eraserWidth={eraserWidth}
          eraserHeight={eraserHeight}
          onToolChange={setActiveTool}
          onColorChange={setActiveColor}
          onBrushSizeChange={setBrushSize}
          onIntensityChange={setBrushIntensity}
          onEraserWidthChange={setEraserWidth}
          onEraserHeightChange={setEraserHeight} />}
      </div>
      {activePluginModals.map((modal) => {
        const plugin = pluginManifests.find((item) => item.id === modal.pluginId);
        if (!plugin) return null;
        const tools = pluginTools.filter((tool) => (tool.pluginId ?? plugin.id) === plugin.id);
        return <PluginModal key={modal.pluginId} plugin={plugin} tools={tools}
          selectedStrokes={strokes.filter((stroke) => selectedStrokeIds.includes(stroke.id))}
          selectionStrokeIds={selectedStrokeIds}
          sharedOutput={sharedPluginOutput}
          onPublishOutput={setSharedPluginOutput}
          pluginReady={!publishedCataloguePlugins.some((candidate) => candidate.pluginId === plugin.id)
            || publishedPluginDefinitions.some((definition) => definition.pluginId === plugin.id)}
          onClose={() => {
            setActivePluginModals((current) => current.filter((item) => item.pluginId !== modal.pluginId));
            if (activePublishedPluginId === modal.pluginId) setActivePublishedPluginId(null);
          }}
          onRunPluginTool={async (commandId, formValues, selectionIds) => {
            if (publishedCataloguePlugins.some((candidate) => candidate.pluginId === plugin.id)) {
              return publishedRuntime.execute(plugin.id, commandId, { formValues, selectionStrokeIds: selectionIds });
            }
            await activateInstalledPlugin(plugin.id);
            return pluginRegistry.executeCommand(commandId, { formValues, selectionStrokeIds: selectionIds });
          }} />;
      })}
      {noteEditorRequest && <NotesEditor />}
      {closeRoomPending && (
        <ConfirmModal
          title="Close this room?"
          message="Everyone will be taken out of the room and returned to their dashboard. The room will remain archived and cannot be reopened."
          confirmLabel={closingRoom ? 'Closing…' : 'Close room'}
          danger
          confirmDisabled={closingRoom}
          onCancel={() => setCloseRoomPending(false)}
          onConfirm={closeRoom}
        />
      )}
      {kickPending && (
        <ConfirmModal
          title={`Kick ${kickPending.member.displayName}?`}
          message="This member will be removed from the room and blocked from rejoining it."
          confirmLabel={kickingMemberId ? 'Kicking...' : 'Kick member'}
          confirmDisabled={Boolean(kickingMemberId)}
          danger
          onCancel={() => setKickPending(null)}
          onConfirm={kickMember}
        />
      )}
    </div>
  );
};

export default Chalkboard;
