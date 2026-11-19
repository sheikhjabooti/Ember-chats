import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Session } from "../App";
import { chatTitle, sortChats } from "../format";
import { useEnsurePeople, usePeople } from "../people";
import { EmberSocket, SocketStatus } from "../socket";
import type { Breakout, Chat, Me, Message, ServerFrame } from "../types";
import { BreakoutPane } from "./BreakoutPane";
import { ChatPane } from "./ChatPane";
import { NewChatDialog } from "./NewChatDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar, SidebarTab } from "./Sidebar";

export type View = { type: "chat"; chatId: string } | { type: "breakout"; breakoutId: string; parentChatId: string } | null;

function previewOf(m: Message): string | null {
  if (m.deletionState === "deletedForEveryone") return "Message deleted";
  return m.text?.slice(0, 120) ?? null;
}

export function Workspace({
  session,
  onSignOut,
  onMeChanged,
}: {
  session: Session;
  onSignOut: () => void;
  onMeChanged: (me: Me) => void;
}) {
  const { me } = session;
  const people = usePeople([me]);
  const socket = useMemo(() => new EmberSocket(session.token), [session.token]);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [chats, setChats] = useState<Chat[]>([]);
  const [kept, setKept] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  /** Live breakouts we're in, by parent chat id. */
  const [active, setActive] = useState<Record<string, Breakout[]>>({});
  const [invites, setInvites] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<SidebarTab>("chats");
  const [view, setView] = useState<View>(null);
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null);

  // --- loading -----------------------------------------------------------

  const loadActive = useCallback(async (chatId: string) => {
    try {
      const { active: list } = await api.activeBreakouts(chatId);
      setActive((prev) => ({ ...prev, [chatId]: list }));
      return list;
    } catch {
      return [];
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const [list, keptList] = await Promise.all([api.chats(), api.keptBreakouts()]);
      setChats(sortChats(list));
      setKept(sortChats(keptList));
      setUnread(Object.fromEntries([...list, ...keptList].map((c) => [c.id, c.unreadCount])));
      // Find live breakouts we were invited to while we were away.
      const groups = list.filter((c) => c.kind === "group");
      const results = await Promise.all(groups.map((c) => loadActive(c.id)));
      setInvites((prev) => {
        const next = new Set(prev);
        for (const r of results) for (const b of r) if (b.createdByUserId !== me.id) next.add(b.id);
        return next;
      });
    } finally {
      setLoadingChats(false);
    }
  }, [loadActive, me.id]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEnsurePeople(people, [...chats, ...kept].flatMap((c) => c.participantIds));

  // --- realtime ----------------------------------------------------------

  useEffect(() => {
    socket.connect();
    const offStatus = socket.onStatus(setStatus);
    const offAuth = socket.onUnauthorized(onSignOut);
    return () => {
      offStatus();
      offAuth();
      socket.close();
    };
  }, [socket, onSignOut]);

  // Read by the socket handler, which should not re-subscribe on every change.
  const knownChatIds = useRef(new Set<string>());
  const liveBreakoutIds = useRef(new Set<string>());
  knownChatIds.current = new Set([...chats, ...kept].map((c) => c.id));
  liveBreakoutIds.current = new Set(Object.values(active).flatMap((list) => list.map((b) => b.id)));
  const viewedChatId = view?.type === "chat" ? view.chatId : null;
  const viewedRef = useRef(viewedChatId);
  viewedRef.current = viewedChatId;

  useEffect(() => {
    const updateChat = (id: string, fn: (c: Chat) => Chat) => {
      setChats((prev) => sortChats(prev.map((c) => (c.id === id ? fn(c) : c))));
      setKept((prev) => sortChats(prev.map((c) => (c.id === id ? fn(c) : c))));
    };
    const dropInvite = (id: string) =>
      setInvites((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    const removeActive = (parentId: string, id: string) =>
      setActive((prev) => ({ ...prev, [parentId]: (prev[parentId] ?? []).filter((b) => b.id !== id) }));

    return socket.on((frame: ServerFrame) => {
      switch (frame.type) {
        case "message": {
          const { chatId, message } = frame;
          if (!knownChatIds.current.has(chatId)) {
            // Live breakout traffic is handled by the breakout view. Anything
            // else is a chat we haven't loaded yet.
            if (!liveBreakoutIds.current.has(chatId)) loadChats();
            break;
          }
          updateChat(chatId, (c) => ({ ...c, lastMessagePreview: previewOf(message), lastMessageAt: message.sentAt }));
          if (chatId !== viewedRef.current && message.senderId !== me.id) {
            setUnread((prev) => ({ ...prev, [chatId]: (prev[chatId] ?? 0) + 1 }));
          }
          break;
        }
        case "message:updated": {
          const { chatId, message } = frame;
          updateChat(chatId, (c) => (c.lastMessageAt === message.sentAt ? { ...c, lastMessagePreview: previewOf(message) } : c));
          break;
        }
        case "read": {
          const { chatId, userId, lastReadAt } = frame;
          updateChat(chatId, (c) => ({ ...c, readState: { ...c.readState, [userId]: lastReadAt } }));
          // Read on another of our devices.
          if (userId === me.id) setUnread((prev) => ({ ...prev, [chatId]: 0 }));
          break;
        }
        case "chat:added": {
          const chat = frame.chat;
          if (chat.kind === "breakout") break;
          setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : sortChats([chat, ...prev])));
          break;
        }
        case "chat:updated": {
          const chat = frame.chat;
          updateChat(chat.id, (c) => ({ ...chat, unreadCount: c.unreadCount, lastMessageAt: c.lastMessageAt ?? chat.lastMessageAt }));
          break;
        }
        case "chat:removed": {
          const { chatId } = frame;
          setChats((prev) => prev.filter((c) => c.id !== chatId));
          setView((v) => (v?.type === "chat" && v.chatId === chatId ? null : v));
          break;
        }
        case "breakout:started": {
          const b = frame.breakout;
          setActive((prev) => {
            const list = prev[b.parentChatId] ?? [];
            return list.some((x) => x.id === b.id) ? prev : { ...prev, [b.parentChatId]: [...list, b] };
          });
          if (b.createdByUserId !== me.id) setInvites((prev) => new Set(prev).add(b.id));
          if (!knownChatIds.current.has(b.parentChatId)) loadChats();
          break;
        }
        case "breakout:promoted": {
          const { chatId, parentChatId, chat } = frame;
          removeActive(parentChatId, chatId);
          dropInvite(chatId);
          if (chat) setKept((prev) => (prev.some((k) => k.id === chat.id) ? prev : sortChats([chat, ...prev])));
          break;
        }
        case "breakout:cleared": {
          removeActive(frame.parentChatId, frame.chatId);
          dropInvite(frame.chatId);
          break;
        }
      }
    });
  }, [socket, me.id, loadChats]);

  // --- navigation --------------------------------------------------------

  const openChat = useCallback((chatId: string) => {
    setView({ type: "chat", chatId });
  }, []);

  const openBreakout = useCallback((b: Breakout) => {
    setView({ type: "breakout", breakoutId: b.id, parentChatId: b.parentChatId });
    setInvites((prev) => {
      const next = new Set(prev);
      next.delete(b.id);
      return next;
    });
  }, []);

  const findChat = (id: string): Chat | undefined => chats.find((c) => c.id === id) ?? kept.find((c) => c.id === id);
  const nameFor = (chat: Chat) => chatTitle(chat, me, people.nameOf);
  const titleOf = (id: string | null | undefined) => {
    const c = id ? findChat(id) : undefined;
    return c ? nameFor(c) : undefined;
  };

  const currentChat = view?.type === "chat" ? findChat(view.chatId) : undefined;
  const currentBreakout = view?.type === "breakout" ? active[view.parentChatId]?.find((b) => b.id === view.breakoutId) : undefined;

  const invitesByParent = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [parentId, list] of Object.entries(active)) counts[parentId] = list.filter((b) => invites.has(b.id)).length;
    return counts;
  }, [active, invites]);

  const replaceChat = (chat: Chat) => {
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...chat, lastMessageAt: c.lastMessageAt ?? chat.lastMessageAt } : c)));
  };

  return (
    <div className={`workspace ${view ? "has-view" : ""}`}>
      <Sidebar
        me={me}
        chats={chats}
        kept={kept}
        tab={tab}
        onTab={setTab}
        loading={loadingChats}
        status={status}
        selectedChatId={view?.type === "chat" ? view.chatId : view?.type === "breakout" ? view.parentChatId : null}
        unread={unread}
        invitesByParent={invitesByParent}
        titleOf={nameFor}
        parentTitleOf={(c) => titleOf(c.parentChatId)}
        onOpen={openChat}
        onNewChat={() => setDialog("new")}
        onSettings={() => setDialog("settings")}
        onSignOut={onSignOut}
      />

      <section className="pane">
        {view?.type === "chat" && currentChat && (
          <ChatPane
            key={currentChat.id}
            chat={currentChat}
            me={me}
            socket={socket}
            people={people}
            title={nameFor(currentChat)}
            parentTitle={titleOf(currentChat.parentChatId)}
            activeBreakouts={active[currentChat.id] ?? []}
            invites={invites}
            onRefreshBreakouts={() => loadActive(currentChat.id)}
            onOpenBreakout={openBreakout}
            onOpenChat={(id) => {
              setTab(kept.some((k) => k.id === id) ? "kept" : "chats");
              openChat(id);
            }}
            onBack={() => setView(null)}
            onRead={(chatId) => setUnread((prev) => ({ ...prev, [chatId]: 0 }))}
            onChatChanged={replaceChat}
            onLeft={(chatId) => {
              setChats((prev) => prev.filter((c) => c.id !== chatId));
              setView(null);
            }}
            onSent={(message) =>
              setChats((prev) =>
                sortChats(prev.map((c) => (c.id === message.chatId ? { ...c, lastMessagePreview: previewOf(message), lastMessageAt: message.sentAt } : c)))
              )
            }
          />
        )}

        {view?.type === "breakout" && (
          <BreakoutPane
            key={view.breakoutId}
            breakoutId={view.breakoutId}
            initial={currentBreakout}
            parentTitle={titleOf(view.parentChatId) ?? "chat"}
            me={me}
            socket={socket}
            people={people}
            onBack={() => openChat(view.parentChatId)}
            onOpenKept={(chatId) => {
              setTab("kept");
              openChat(chatId);
            }}
          />
        )}

        {view?.type === "chat" && !currentChat && <div className="empty">That chat isn't available.</div>}

        {!view && (
          <div className="empty">
            <h2>Pick a chat</h2>
            <p className="muted">
              In any group, start a <strong>breakout</strong> with some of the people in it. Only they see it. It
              clears itself after everyone leaves, unless someone asks to keep it and nobody says no.
            </p>
            <button className="primary" onClick={() => setDialog("new")}>
              Start a new chat
            </button>
          </div>
        )}
      </section>

      {dialog === "new" && (
        <NewChatDialog
          people={people}
          onClose={() => setDialog(null)}
          onCreated={(chat) => {
            setDialog(null);
            setTab("chats");
            setChats((prev) => sortChats(prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
            openChat(chat.id);
          }}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          me={me}
          onClose={() => setDialog(null)}
          onSignedOutEverywhere={onSignOut}
          onSaved={(updated) => {
            onMeChanged(updated);
            people.remember([updated]);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
