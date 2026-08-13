import
React,
{
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  createContext,
  useContext,
} from 'react';
import {
  Check,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  SquarePlus,
  Eye,
  EyeOff,
  Hand,
  Smile,
  Mic,
  MicOff,
  WifiOff,
  Radio,
  RadioOff,
  Share2,
  Link,
  LogOut,
  UserPlus,
  UserX,
  Menu,
  X,
} from 'lucide-react';
import * as Avatar from '@radix-ui/react-avatar';
import { getApiError, isPlanLimitError } from '@/api/client';
import Toolbar from '@/pages/Toolbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import UserAvatar from '@/components/UserAvatar';
import ConfirmModal from '@/components/ui/ConfirmModal';
import LinkIcon from '@/components/svg/LinkIcon';
import ChalkboardLogo from '@/components/svg/ChalkboardLogo';
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
import type { PluginManifest, PluginToolContribution } from '@/plugins/types';
import ActionSticks from '@/components/tools/ActionSticks';
import SelectionToolbox from '@/components/tools/SelectionToolbox';
import InsertShapes from '@/components/tools/InsertShapes';
import LinksPanel from '@/components/tools/LinksPanel';
import ChatPanel from '@/components/ChatPanel';
import PluginModal from '@/components/tools/PluginModal';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
  useMaybeRoomContext,
} from '@livekit/components-react';
import { getVoiceToken } from '@/api/rooms';
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

const SpeakingParticipantsContext = createContext<ReadonlySet<string>>(new Set());

function VoiceAudioStarter() {
  const room = useMaybeRoomContext();

  useEffect(() => {
    if (!room) return;
    const unlockAudio = () => {
      if (room && !room.canPlaybackAudio) {
        void room.startAudio().catch(() => { });
      }
    };

    window.addEventListener('click', unlockAudio, { capture: true, passive: true });
    window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
    window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });

    return () => {
      window.removeEventListener('click', unlockAudio, { capture: true });
      window.removeEventListener('touchstart', unlockAudio, { capture: true });
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
    };
  }, [room]);

  return null;
}

function SpeakingParticipantsProvider({ children }: { children: React.ReactNode }) {
  const speakingParticipants = useSpeakingParticipants();
  const speakingIdentities = useMemo(
    () => new Set(speakingParticipants.map((participant) => participant.identity)),
    [speakingParticipants],
  );

  return (
    <SpeakingParticipantsContext.Provider value={speakingIdentities}>
      {children}
    </SpeakingParticipantsContext.Provider>
  );
}

function CollaboratorAvatar({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl?: string | null }) {
  const speakingIdentities = useContext(SpeakingParticipantsContext);
  const isSpeaking = speakingIdentities.has(userId);
  return (
    <UserAvatar
      name={name}
      avatarUrl={avatarUrl}
      size="sm"
      className={`collaborator-avatar${isSpeaking ? ' collaborator-avatar-speaking' : ''}`}
    />
  );
}

function RoomMemberAvatar({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl?: string | null }) {
  const speakingIdentities = useContext(SpeakingParticipantsContext);
  const isSpeaking = speakingIdentities.has(userId);
  return (
    <UserAvatar
      name={name}
      avatarUrl={avatarUrl}
      size="sm"
      className={`room-member-avatar${isSpeaking ? ' collaborator-avatar-speaking' : ''}`}
    />
  );
}

function avatarInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'C';
}

const REACTION_EMOJIS = ['👍', '👏', '😂', '😮', '❤️', '🎉'];

type RaisedHand = { userId: string; raisedAt: number };
type ActiveReaction = { id: string; userId: string; emoji: string; at: number; lane: number };

type PendingJoinRequest = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
};

interface RoomMemberVoiceControlsProps {
  memberUserId: string;
  effectiveRole: string;
  currentUserId: string;
  socket: unknown;
  roomId: string;
  voiceEnabled?: boolean;
  /** Whether the member row is currently online */
  isOnline: boolean;
  /** Display name of the member (used in disabled tooltips) */
  memberName: string;
  /** Whether the voice call itself is connected */
  voiceConnected: boolean;
}

function voiceDisabledReason({ voiceConnected, isOnline, memberName }: RoomMemberVoiceControlsProps): string | null {
  if (!isOnline) return `${memberName} is offline`;
  if (!voiceConnected) return 'Voice call is not connected';
  return null;
}

function RoomMemberVoiceControlsConnected({ memberUserId, effectiveRole, currentUserId, socket, roomId, isOnline, memberName, voiceConnected }: RoomMemberVoiceControlsProps) {
  const room = useMaybeRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  const participant = participants.find((candidate) => candidate.identity === memberUserId);
  const canSpeak = participant?.permissions?.canPublish === true;

  const isMe = memberUserId === currentUserId;
  const isOwner = effectiveRole === 'owner';

  const toggleMute = () => {
    if (room && !room.canPlaybackAudio) {
      void room.startAudio().catch(() => { });
    }
    if (localParticipant) {
      void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {
        useLoggerStore.getState().notify('Microphone access was blocked. Check your browser permissions and try again.', 'error', 6000);
      });
    }
  };

  const inviteUser = () => {
    (socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:invite', { roomId, targetUserId: memberUserId }, (res: { ok?: boolean; error?: string }) => {
      if (res && !res.ok) console.error('Failed to invite to voice:', res.error);
    });
  };

  const removeUser = () => {
    (socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:remove', { roomId, targetUserId: memberUserId }, (res: { ok?: boolean; error?: string }) => {
      if (res && !res.ok) console.error('Failed to remove from voice:', res.error);
    });
  };

  const disabledReason = voiceDisabledReason({ voiceConnected, isOnline, memberName, memberUserId, effectiveRole, currentUserId, socket, roomId });
  const voiceDisabled = Boolean(disabledReason);

  if (isMe) {
    if (localParticipant && (isOwner || canSpeak)) {
      return (
        <div className="voice-actions-group">
          <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`} title={disabledReason ?? undefined}>
            <button type="button" className="voice-action-btn" onClick={toggleMute} disabled={voiceDisabled} title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>{voiceDisabled ? <WifiOff size={14} /> : (isMicrophoneEnabled ? <Mic size={14} /> : <MicOff size={14} />)}</button>
          </span>
          {!isOwner && <button type="button" className="voice-action-btn" onClick={removeUser} title="Leave voice"><LogOut size={14} /></button>}
        </div>
      );
    }
    return null;
  }

  if (isOwner) {
    if (canSpeak) {
      return (
        <div className="voice-actions-group">
          <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`} title={disabledReason ?? undefined}>
            <button type="button" className="voice-action-btn" onClick={removeUser} disabled={voiceDisabled} title="Remove from voice">{voiceDisabled ? <WifiOff size={14} /> : <UserX size={14} />}</button>
          </span>
        </div>
      );
    }
    return (
      <div className="voice-actions-group">
        <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`} title={disabledReason ?? undefined}>
          <button type="button" className="voice-action-btn" onClick={inviteUser} disabled={voiceDisabled} title="Invite to voice">{voiceDisabled ? <WifiOff size={14} /> : <UserPlus size={14} />}</button>
        </span>
      </div>
    );
  }

  return null;
}

function RoomMemberVoiceControls(props: RoomMemberVoiceControlsProps) {
  if (!props.voiceEnabled) return null;

  const room = useMaybeRoomContext();
  if (!room) {
    const isMe = props.memberUserId === props.currentUserId;
    const isOwner = props.effectiveRole === 'owner';

    if (isOwner && !isMe) {
      const disabledReason = voiceDisabledReason(props);
      return (
        <div className="voice-actions-group">
          <span className={`voice-action-wrap${disabledReason ? ' is-disabled' : ''}`} title={disabledReason ?? undefined}>
            <button type="button" className="voice-action-btn" title="Invite to voice" disabled={Boolean(disabledReason)} onClick={() => {
              (props.socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:invite', { roomId: props.roomId, targetUserId: props.memberUserId }, (res: { ok?: boolean; error?: string }) => {
                if (res && !res.ok) console.error('Failed to invite to voice:', res.error);
              });
            }}>{disabledReason ? <WifiOff size={14} /> : <UserPlus size={14} />}</button>
          </span>
        </div>
      );
    }
    return null;
  }

  return <RoomMemberVoiceControlsConnected {...props} />;
}

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
    insertShapesTab,
    linksPanelOpen, setLinksPanelOpen,
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
  const [activePluginModals, setActivePluginModals] = useState<Array<{ pluginId: string }>>([]);
  const [sharedPluginOutput, setSharedPluginOutput] = useState<string | undefined>();
  const [liveRoomMembers, setLiveRoomMembers] = useState<RoomMember[] | null>(null);
  const [joinRequestAction, setJoinRequestAction] = useState<string | null>(null);
  const [joinRequestError, setJoinRequestError] = useState('');
  const [roomDetailsOpen, setRoomDetailsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [roleUpdateError, setRoleUpdateError] = useState('');
  const [kickMemberError, setKickMemberError] = useState('');
  const [kickingMemberId, setKickingMemberId] = useState<string | null>(null);
  const [kickPending, setKickPending] = useState<{ member: RoomMember; targetSocketId: string } | null>(null);
  const [closeRoomPending, setCloseRoomPending] = useState(false);
  const [voiceToken, setVoiceToken] = useState('');
  const [voiceUrl, setVoiceUrl] = useState('');
  const [voiceListening, setVoiceListening] = useState(true);
  const [raisedHands, setRaisedHands] = useState<RaisedHand[]>([]);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [activeReactions, setActiveReactions] = useState<ActiveReaction[]>([]);
  const voiceSwappingRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const handleVoiceInvited = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return;
      useLoggerStore.getState().notify('You have been added to voice. Unmute your microphone when you are ready.', 'success');
      // Clear existing token to force LiveKit to disconnect before
      // reconnecting with the new (speaker-enabled) token.
      voiceSwappingRef.current = true;
      setVoiceToken('');
      setVoiceUrl('');
      const connectVoice = async () => {
        try {
          const res = await getVoiceToken(roomId);
          if (res.token && res.url) {
            setVoiceToken(res.token);
            setVoiceUrl(res.url);
          } else {
            voiceSwappingRef.current = false;
          }
        } catch (error) {
          voiceSwappingRef.current = false;
          const apiError = getApiError(error);
          useLoggerStore.getState().notify(
            isPlanLimitError(apiError) ? apiError.message : 'Failed to join voice',
            'error',
            isPlanLimitError(apiError) ? 6000 : undefined,
          );
        }
      };
      void connectVoice();
    };

    const handleVoiceRemoved = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return;
      useLoggerStore.getState().notify('Speaking access was removed. You can still hear the room.', 'info');
      // Clear existing token to force LiveKit to disconnect before
      // reconnecting with the new (listener-only) token.
      voiceSwappingRef.current = true;
      setVoiceToken('');
      setVoiceUrl('');
      const refreshVoice = async () => {
        try {
          const res = await getVoiceToken(roomId);
          if (res.token && res.url) {
            setVoiceToken(res.token);
            setVoiceUrl(res.url);
          } else {
            voiceSwappingRef.current = false;
          }
        } catch (error) {
          voiceSwappingRef.current = false;
          const apiError = getApiError(error);
          useLoggerStore.getState().notify(
            isPlanLimitError(apiError) ? apiError.message : 'Voice access could not be refreshed',
            'error',
            isPlanLimitError(apiError) ? 6000 : undefined,
          );
        }
      };
      void refreshVoice();
    };

    const handleVoiceSpeakerAdded = (data: { roomId: string; targetUserId: string; displayName?: string }) => {
      if (data.roomId !== roomId || data.targetUserId === userId) return;
      const displayName = data.displayName?.trim() || 'A room member';
      useLoggerStore.getState().notify(`${displayName} can now speak in voice`, 'success');
    };

    socket.on('voice:invited', handleVoiceInvited);
    socket.on('voice:removed', handleVoiceRemoved);
    socket.on('voice:speaker-added', handleVoiceSpeakerAdded);

    return () => {
      socket.off('voice:invited', handleVoiceInvited);
      socket.off('voice:removed', handleVoiceRemoved);
      socket.off('voice:speaker-added', handleVoiceSpeakerAdded);
    };
  }, [socket, roomId, userId]);

  useEffect(() => {
    if (!socket) return;

    const handleRaisedHandsUpdate = (hands: RaisedHand[]) => {
      if (!Array.isArray(hands)) return;
      setRaisedHands([...hands].sort((a, b) => a.raisedAt - b.raisedAt));
    };

    const handleReactionReceived = (reaction: { userId?: string; emoji?: string; at?: number }) => {
      if (!reaction.userId || !reaction.emoji) return;
      const id = `${reaction.userId}-${reaction.at ?? Date.now()}-${Math.random().toString(36).slice(2)}`;
      setActiveReactions((current) => [
        ...current.slice(-11),
        {
          id,
          userId: reaction.userId!,
          emoji: reaction.emoji!,
          at: reaction.at ?? Date.now(),
          lane: Math.floor(Math.random() * 5),
        },
      ]);
      window.setTimeout(() => {
        setActiveReactions((current) => current.filter((item) => item.id !== id));
      }, 2600);
    };

    socket.on('raised-hands:update', handleRaisedHandsUpdate);
    socket.on('reaction:received', handleReactionReceived);
    return () => {
      socket.off('raised-hands:update', handleRaisedHandsUpdate);
      socket.off('reaction:received', handleReactionReceived);
    };
  }, [socket]);

  const [closingRoom, setClosingRoom] = useState(false);
  const roomClosureHandledRef = useRef(false);
  const linksPanelRef = useRef<HTMLDivElement | null>(null);
  const roomInfoRef = useRef<HTMLDivElement | null>(null);
  const roomMembersRef = useRef<HTMLDivElement | null>(null);
  const insertShapesWrapRef = useRef<HTMLDivElement | null>(null);
  const [roomInfoOpen, setRoomInfoOpen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const updateOrientation = () => {
      setIsMobilePortrait(window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches);
    };
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  const toggleFullscreen = async () => {
    const board = containerRef.current;
    if (!board) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        screen.orientation?.unlock?.();
      } else {
        await board.requestFullscreen();
        if (window.matchMedia('(max-width: 700px)').matches) {
          try {
            await screen.orientation?.lock?.('landscape');
          } catch {
            // Orientation locking is unavailable in some mobile browsers.
          }
        }
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
    const cataloguePlugin = publishedCataloguePlugins.find((plugin) => plugin.pluginId === pluginId);
    if (cataloguePlugin) {
      // The server will not hand over a locked Pro bundle, so asking for it
      // only produces a request that fails and a modal that spins forever.
      // Open the modal anyway; it renders its own locked state.
      if (!cataloguePlugin.locked) setActivePublishedPluginId(pluginId);
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
    ownerVoiceConnected,
    chatMessages,
    chatUnreadMentions,
    clearChatNotifications,
  } = useBoardSocket(socket, roomId, userName, userId, roomPassword);
  const roomQuery = useRoomQuery(roomId);
  const room = roomQuery.data?.room;

  useEffect(() => {
    if (!room?.voiceEnabled || !voiceListening || voiceToken || voiceSwappingRef.current) return;
    let cancelled = false;
    const connectVoiceForListening = async () => {
      try {
        const res = await getVoiceToken(roomId);
        if (!cancelled && res.token && res.url) {
          setVoiceToken(res.token);
          setVoiceUrl(res.url);
        }
      } catch (error) {
        if (!cancelled) {
          const apiError = getApiError(error);
          useLoggerStore.getState().notify(
            isPlanLimitError(apiError) ? apiError.message : 'Failed to connect room audio',
            'error',
            isPlanLimitError(apiError) ? 6000 : undefined,
          );
        }
      }
    };
    void connectVoiceForListening();
    return () => { cancelled = true; };
  }, [room?.voiceEnabled, roomId, voiceListening, voiceToken]);

  const roomTheme = room?.theme ?? 'classroom';
  const roomAccessMode = room?.accessMode ?? 'open';
  const roomTitle = room?.title?.trim() || `Room ${roomId}`;
  const roomDescription = typeof room?.description === 'string' ? room.description : '';
  const roomQueryMembers = roomQuery.data?.members;
  const roomMembers = useMemo(() => liveRoomMembers ?? roomQueryMembers ?? [], [liveRoomMembers, roomQueryMembers]);
  const effectiveRole = roomMembers.find((member) => member.userId === userId)?.role ?? currentRole;
  const voiceConnected = effectiveRole === 'owner'
    ? Boolean(voiceToken && voiceUrl)
    : ownerVoiceConnected;
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

  const raisedHandUserIds = useMemo(() => new Set(raisedHands.map((hand) => hand.userId)), [raisedHands]);
  const raisedHandCount = raisedHands.length;
  const isHandRaised = raisedHandUserIds.has(userId);

  const memberDisplayNames = useMemo(() => {
    const names = new Map<string, string>();
    displayedRoomMembers.forEach((member) => names.set(member.userId, member.displayName));
    return names;
  }, [displayedRoomMembers]);

  const sortedDisplayedRoomMembers = useMemo(() => {
    const order = new Map(raisedHands.map((hand, index) => [hand.userId, index]));
    return [...displayedRoomMembers].sort((a, b) => {
      const aOrder = order.get(a.userId);
      const bOrder = order.get(b.userId);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [displayedRoomMembers, raisedHands]);

  const onlineHeaderMembers = useMemo(() => {
    const onlineIds = new Set(Object.values(collaborators).map((collaborator) => collaborator.userId));
    return displayedRoomMembers.filter((member) => member.userId === userId || onlineIds.has(member.userId));
  }, [displayedRoomMembers, collaborators, userId]);

  const toggleRaisedHand = useCallback(() => {
    socket.emit('hand:raise', { roomId, raised: !isHandRaised }, (response: { ok?: boolean; error?: string }) => {
      if (response && !response.ok) useLoggerStore.getState().notify('Could not update your raised hand. Try again.', 'error');
    });
  }, [isHandRaised, roomId, socket]);

  const sendReaction = useCallback((emoji: string) => {
    setReactionPickerOpen(false);
    socket.emit('reaction:send', { roomId, emoji }, (response: { ok?: boolean; error?: string }) => {
      if (response && !response.ok) {
        const message = response.error === 'rate_limited' ? 'Slow down before sending another reaction.' : 'Could not send reaction.';
        useLoggerStore.getState().notify(message, 'warning');
      }
    });
  }, [roomId, socket]);

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
      if (!roomMembersRef.current?.contains(event.target as Node)) setRoomDetailsOpen(false);
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

  useEffect(() => {
    if (!linksPanelOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!linksPanelRef.current?.contains(event.target as Node)) setLinksPanelOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinksPanelOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [linksPanelOpen, setLinksPanelOpen]);

  useEffect(() => {
    if (!showInsertShapes) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!insertShapesWrapRef.current?.contains(event.target as Node)) setShowInsertShapes(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowInsertShapes(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showInsertShapes, setShowInsertShapes]);

  useEffect(() => {
    if (!roomInfoOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!roomInfoRef.current?.contains(event.target as Node)) setRoomInfoOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRoomInfoOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [roomInfoOpen]);

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

  // Register the canvas element in the board store. A callback ref is used
  // instead of a mount effect because LiveKitRoom renders its children one
  // commit after this component mounts, so `canvasRef.current` is still null
  // when mount effects run and the store would never receive the element.
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvas(node);
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
    if (canvasRef.current) canvasRef.current.style.cursor = canEdit ? canvasCursor : isPanning ? 'grabbing' : 'grab';
  }, [canEdit, canvasCursor, isPanning]);

  const mainContent = (
    <>
      <div className={`board-container room-theme-${roomTheme}`} ref={containerRef}>
        {isMobilePortrait && (
          <div className="mobile-landscape-hint" role="status" aria-live="polite">
            <strong>Rotate your device</strong>
            <span>Chalkboard works best in landscape.</span>
          </div>
        )}
        <div className="blackboard-slate" />
        <div className="reaction-overlay" aria-hidden="true">
          {activeReactions.map((reaction) => (
            <div
              key={reaction.id}
              className="reaction-bubble"
              style={{ right: `${18 + reaction.lane * 58}px` }}
              title={`${memberDisplayNames.get(reaction.userId) ?? 'Someone'} reacted ${reaction.emoji}`}
            >
              <span className="reaction-emoji">{reaction.emoji}</span>
              <span className="reaction-name">{memberDisplayNames.get(reaction.userId) ?? 'Someone'}</span>
            </div>
          ))}
        </div>
        {dustPuffs.map((p) => (
          <div key={p.id} className="dust-puff" data-left={p.x - 12} data-top={p.y - 12} data-size="24" />
        ))}
        {Object.entries(collaborators).map(([id, coll]) => {
          if (coll.role === 'viewer') return null;
          if (coll.cursor) {
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
                <CollaboratorAvatar userId={coll.userId} name={coll.name} avatarUrl={coll.avatarUrl} />
                <span
                  className="collaborator-cursor-dot"
                  data-color={coll.color}
                  aria-hidden="true"
                />
              </div>
            );
          }
          // Show avatar at a default position for users who can draw but haven't moved their cursor yet
          return (
            <div
              key={id}
              className="collaborator-cursor collaborator-cursor-default"
              title={`${coll.name}`}
              aria-label={`${coll.name}`}
            >
              <CollaboratorAvatar userId={coll.userId} name={coll.name} avatarUrl={coll.avatarUrl} />
            </div>
          );
        })}
        <canvas ref={attachCanvas} className={`chalk-canvas chalk-canvas-${activeTool}`}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp} onWheel={handleWheel} />
        <NotesLayer />

        <div className="board-actions-card board-utility-actions">
          {canEdit && (
            <div className="insert-shapes-trigger-wrap" ref={insertShapesWrapRef}>
              <button
                onClick={() => setShowInsertShapes(prev => !prev)}
                title="Insert Shape (Ctrl+1)"
                className={`insert-shapes-fab${showInsertShapes ? ' active' : ''}`}
              >
                <SquarePlus size={18} />
              </button>
              {showInsertShapes && (
                <InsertShapes onInsertShape={(shape: ShapeType) => toolboxInsertShape(shape)}
                  pluginManifests={pluginManifests}
                  onOpenPlugin={openPluginModal}
                  hasSelection={selectedStrokeIds.length > 0}
                  onClose={() => { setShowInsertShapes(false); setHighlightedLinkId(null); }}
                  initialTab={insertShapesTab} />
              )}
            </div>
          )}
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
        </div>
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
                <div className="trim-actions">
                  <button className="trim-apply-button" onClick={handleApplyTrim} title="Apply crop (Enter)" aria-label="Apply crop">
                    <Check size={20} />
                  </button>
                  <button className="trim-cancel-button" onClick={handleCancelTrim} title="Cancel crop (Esc)" aria-label="Cancel crop">
                    <X size={20} />
                  </button>
                </div>
              </>
            );
          })()}
          {canEdit && selectedStrokeIds.length > 0 && transformBox && !transformMode && !trimState.active && (() => {
            const linkedLink = links.find(l => l.strokeIds.some(id => selectedStrokeIds.includes(id)));
            if (!linkedLink) return null;
            const LINK_PADDING = 12;
            const linkX = transformBox.minX * zoom + panOffset.x - LINK_PADDING - 24;
            const linkY = (transformBox.minY + transformBox.maxY) / 2 * zoom + panOffset.y - 12;

            return (
              <button onClick={() => { setHighlightedLinkId(linkedLink.id); setLinksPanelOpen(true); }}
                className="selection-link-button"
                data-left={linkX}
                data-top={linkY}
                title="Click to view linked location">
                <LinkIcon />
              </button>
            );
          })()}

          {canEdit && selectedStrokeIds.length > 0 && transformBox && !transformMode && !trimState.active && (() => {
            const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
            const hasGroupId = selectedStrokes.length > 0 && selectedStrokes.every(s => s.groupId !== undefined);
            const actualColor = selectedStrokes.length > 0 ? selectedStrokes[0].color : activeColor;
            const actualFillColor = selectedStrokes.length > 0 ? (selectedStrokes[0].fillColor ?? 'transparent') : activeFillColor;

            // Compute panel position (mirrors SelectionToolbox logic)
            const BOX_SCREEN_LEFT = transformBox.minX * zoom + panOffset.x;
            const BOX_SCREEN_RIGHT = transformBox.maxX * zoom + panOffset.x;
            const BOX_SCREEN_TOP = transformBox.minY * zoom + panOffset.y;
            const BOX_SCREEN_BOTTOM = transformBox.maxY * zoom + panOffset.y;
            const BOX_SCREEN_CENTER_X = (BOX_SCREEN_LEFT + BOX_SCREEN_RIGHT) / 2;
            const BOX_SCREEN_CENTER_Y = (BOX_SCREEN_TOP + BOX_SCREEN_BOTTOM) / 2;

            return (
              <>
                {showSelectionToolbox && (
                  <SelectionToolbox
                    boxScreenCenterX={BOX_SCREEN_CENTER_X}
                    boxScreenTop={BOX_SCREEN_TOP}
                    boxScreenBottom={BOX_SCREEN_BOTTOM}
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
                    currentSize={selectedStrokes.length > 0 ? selectedStrokes[0].size : brushSize}
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
              <div className="board-actions-card board-brand-menu">
                <button type="button" className="board-brand" title="Chalkboard" aria-label="Chalkboard">
                  <ChalkboardLogo className="board-brand-logo" />
                  <span className="board-brand-name">Chalkboard</span>
                </button>
                <div className="room-info-trigger-wrap" ref={roomInfoRef}>
                  <button
                    type="button"
                    className={`header-icon-btn${roomInfoOpen ? ' active' : ''}`}
                    onClick={() => setRoomInfoOpen((open) => !open)}
                    title="Room info"
                    aria-label="Room info"
                  >
                    <Menu size={14} />
                  </button>
                  {roomInfoOpen && (
                    <div className="room-info-popover">
                      <strong className="room-info-popover-title">{roomTitle}</strong>
                      {roomDescription ? (
                        <p className="room-info-popover-description">{roomDescription}</p>
                      ) : (
                        <p className="room-info-popover-empty">No description yet.</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="room-links-trigger-wrap" ref={linksPanelRef}>
                  <button
                    type="button"
                    className={`header-icon-btn${linksPanelOpen ? ' active' : ''}`}
                    onClick={() => { setLinksPanelOpen(!linksPanelOpen); setHighlightedLinkId(null); }}
                    title="Links"
                    aria-label="Links"
                  >
                    <Link size={14} />
                  </button>
                  {linksPanelOpen && (
                    <div className="room-links-popover">
                      <LinksPanel
                        links={links}
                        hasSelection={selectedStrokeIds.length > 0}
                        onNavigateToLink={(link) => { handleNavigateToLink(link); setLinksPanelOpen(false); }}
                        onCreateLink={handleCreateLink}
                        onDeleteLink={handleDeleteLink}
                        onRenameLink={handleRenameLink}
                        highlightedLinkId={highlightedLinkId}
                        onClose={() => { setLinksPanelOpen(false); setHighlightedLinkId(null); }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="board-header-actions">
              <div className="board-actions-card board-header-actions-card">
                <div className="participation-actions">
                {raisedHandCount > 0 && <span className="raised-hand-count" title="Raised hands">✋ {raisedHandCount}</span>}
                <button
                  type="button"
                  className={`voice-action-btn participation-action-btn${isHandRaised ? ' active' : ''}`}
                  onClick={toggleRaisedHand}
                  title={isHandRaised ? 'Lower hand' : 'Raise hand'}
                  aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}
                >
                  <Hand size={14} />
                </button>
                <div className="reaction-picker-wrap">
                  <button
                    type="button"
                    className="voice-action-btn participation-action-btn"
                    onClick={() => setReactionPickerOpen((open) => !open)}
                    title="Send reaction"
                    aria-label="Send reaction"
                  >
                    <Smile size={14} />
                  </button>
                  {reactionPickerOpen && (
                    <div className="reaction-picker" role="menu" aria-label="Send a reaction">
                      {REACTION_EMOJIS.map((emoji) => (
                        <button key={emoji} type="button" onClick={() => sendReaction(emoji)} aria-label={`React ${emoji}`}>{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {effectiveRole === 'owner' && roomQuery.data?.room.voiceEnabled && (
                <button
                  type="button"
                  className="header-icon-btn"
                  onClick={() => {
                    if (voiceToken && voiceUrl) {
                      setVoiceListening(false);
                      setVoiceToken('');
                      setVoiceUrl('');
                    } else {
                      setVoiceListening(true);
                    }
                  }}
                  title={voiceConnected ? 'Disconnect Voice' : 'Connect Voice'}
                  aria-label={voiceConnected ? 'Disconnect voice' : 'Connect voice'}
                >
                  {voiceConnected ? <Radio size={14} /> : <RadioOff size={14} />}
                </button>
              )}
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => { void toggleFullscreen(); }}
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <div className="room-members-trigger-wrap" ref={roomMembersRef}>
              <button
                type="button"
                className={`room-details-trigger${roomDetailsOpen ? ' active' : ''}`}
                onClick={() => { setRoomDetailsOpen((open) => !open); setRoleUpdateError(''); }}
                aria-expanded={roomDetailsOpen}
                aria-label={`${onlineHeaderMembers.length} online — open room details`}
                title={`${onlineHeaderMembers.length} online`}
              >
                <span className="member-avatar-stack">
                  {onlineHeaderMembers.slice(0, 4).map((member) => (
                    <Avatar.Root key={member.userId} className="member-stack-avatar">
                      <Avatar.Image src={member.avatarUrl || undefined} alt={member.displayName} />
                      <Avatar.Fallback delayMs={300}>{avatarInitials(member.displayName)}</Avatar.Fallback>
                    </Avatar.Root>
                  ))}
                  {onlineHeaderMembers.length > 4 && (
                    <span className="member-stack-more">+{onlineHeaderMembers.length - 4}</span>
                  )}
                </span>
              </button>
              {roomDetailsOpen && (
                <div className="room-members-popover" role="dialog" aria-modal="false" aria-label="Members">
                    <div className="room-info-panel-header">
                      <h3>Members</h3>
                      <button
                        type="button"
                        className="room-info-panel-close"
                        onClick={() => { setRoomDetailsOpen(false); setRoleUpdateError(''); }}
                        aria-label="Close members"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="room-info-panel-body">
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
                    <div className="room-details-section-title">Members <span>{displayedRoomMembers.length} · {onlineCount} online{raisedHandCount > 0 ? ` · ${raisedHandCount} raised` : ''}</span></div>
                    <div className="room-details-members">
                      {sortedDisplayedRoomMembers.map((member) => {
                        const collaborator = Object.values(collaborators).find((item) => item.userId === member.userId);
                        const isOnline = member.userId === userId || Boolean(collaborator);
                        return (
                          <div key={member.userId} className="room-detail-member">
                            <RoomMemberAvatar
                              userId={member.userId}
                              name={member.displayName}
                              avatarUrl={member.avatarUrl || collaborator?.avatarUrl}
                            />
                            {raisedHandUserIds.has(member.userId) && <span className="room-member-hand-badge" title="Hand raised">✋</span>}
                            <span className="room-member-presence" data-color={collaborator?.color || (member.userId === userId ? userCursorColor : '#64748b')} />
                            <div className="room-member-name">
                              <strong>{member.displayName}{member.userId === userId ? ' (You)' : ''}</strong>
                              <span>{isOnline ? 'Online' : 'Offline'}</span>
                            </div>
                            <div className="room-member-actions">
                              <RoomMemberVoiceControls
                                memberUserId={member.userId}
                                effectiveRole={effectiveRole}
                                currentUserId={userId}
                                socket={socket}
                                roomId={roomId}
                                voiceEnabled={roomQuery.data?.room.voiceEnabled ?? false}
                                isOnline={isOnline}
                                memberName={member.displayName}
                                voiceConnected={voiceConnected}
                              />
                              {canManageMembers && member.role !== 'owner' ? (
                                <select className="room-member-role-select"
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
                    </div>
                )}
              </div>
              <button
                type="button"
                className="header-icon-btn"
                onClick={handleCopyLink}
                title="Copy Invite Link"
                aria-label="Copy invite link"
              >
                {isCopied ? <Check size={14} className="copy-success-icon" /> : <Share2 size={14} />}
              </button>
              <button
                type="button"
                className="header-icon-btn header-exit-btn"
                onClick={onLeaveRoom}
                title="Exit room"
                aria-label="Exit room"
              >
                <LogOut size={14} />
              </button>
              </div>
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
          // A locked Pro plugin has no bundle to wait for, so it is never
          // "loading" — the modal shows its upgrade state instead.
          const pluginLocked = Boolean(plugin.locked);
          return <PluginModal key={modal.pluginId} plugin={plugin} tools={tools}
            selectedStrokes={strokes.filter((stroke) => selectedStrokeIds.includes(stroke.id))}
            selectionStrokeIds={selectedStrokeIds}
            sharedOutput={sharedPluginOutput}
            onPublishOutput={setSharedPluginOutput}
            locked={pluginLocked}
            onUpgrade={() => window.open('/dashboard?tab=billing', '_blank', 'noopener,noreferrer')}
            pluginReady={pluginLocked
              || !publishedCataloguePlugins.some((candidate) => candidate.pluginId === plugin.id)
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
    </>
  );

  const hasVoiceCredentials = Boolean(voiceToken && voiceUrl);

  return (
    <LiveKitRoom
      video={false}
      // Join with playback enabled, but request the microphone only when the
      // user explicitly presses Unmute. This also keeps viewer tokens
      // (which intentionally cannot publish) from failing on join.
      audio={false}
      token={voiceToken || undefined}
      serverUrl={voiceUrl || undefined}
      connect={hasVoiceCredentials}
      onConnected={() => {
        voiceSwappingRef.current = false;
        if (effectiveRole === 'owner') socket.emit('voice:owner-connection', { roomId, connected: true });
      }}
      onDisconnected={() => {
        if (voiceSwappingRef.current) return;
        if (effectiveRole === 'owner') socket.emit('voice:owner-connection', { roomId, connected: false });
        setVoiceToken('');
        setVoiceUrl('');
      }}
      onError={() => {
        useLoggerStore.getState().notify('Voice connection error', 'error');
      }}
    >
      <VoiceAudioStarter />
      <SpeakingParticipantsProvider>
        {mainContent}
      </SpeakingParticipantsProvider>
      {hasVoiceCredentials && <RoomAudioRenderer />}
    </LiveKitRoom>
  );
};

export default Chalkboard;
