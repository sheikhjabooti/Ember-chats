import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Session } from "../App";
import { chatTitle, sortChats } from "../format";
import { useEnsurePeople, usePeople } from "../people";
import { EmberSocket, SocketStatus } from "../socket";
import type { Breakout, BreakoutsForChat, Chat, Me, ServerFrame } from "../types";
import { BreakoutPane } from "./BreakoutPane";
import { ChatPane } from "./ChatPane";
import { NewChatDialog } from "./NewChatDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";

export type View = { type: "chat"; chatId: string } | { type: "breakout"; breakoutId: string; parentChatId: string } | null;

const EMPTY: BreakoutsForChat = { active: [], kept: [] };

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
  const [loadingChats, setLoadingChats] = useState(true);
  const [breakouts, setBreakouts] = useState<Record<string, BreakoutsForChat>>({});
  const [invites, setInvites] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(null);
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null);

  // --- loading -----------------------------------------------------------

  const loadBreakouts = useCallback(async (chatId: string) => {
    try {
      const data = await api.breakoutsFor(chatId);
      setBreakouts((prev) => ({ ...prev, [chatId]: data }));
      return data;
    } catch {
      return EMPTY;
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const list = await api.chats();
      setChats(sortChats(list));
      // Find live breakouts we were invited to while we were away.
      const results = await Promise.all(list.map((c) => loadBreakouts(c.id)));
      setInvites((prev) => {
        const next = new Set(prev);
        for (const r of results) for (const b of r.active) if (b.createdByUserId !== me.id) next.add(b.id);
        return next;
      });
    } finally {
      setLoadingChats(false);
    }
  }, [loadBreakouts, me.id]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEnsurePeople(
    people,
    chats.flatMap((c) => c.participantIds)
  );

  // --- realtime ----------------------------------------------------------

  useEffect(() => {
    socket.connect();
    const offStatus = socket.onStatus(setStatus);
    return () => {
      offStatus();
      socket.close();
    };
  }, [socket]);

  const viewedChatId = view?.type === "chat" ? view.chatId : null;

  // Read by the socket handler, which should not re-subscribe on every change.
  const knownChatIds = useRef(new Set<string>());
  const liveBreakoutIds = useRef(new Set<string>());
  knownChatIds.current = new Set([...chats.map((c) => c.id), ...Object.values(breakouts).flatMap((b) => b.kept.map((k) => k.id))]);
  liveBreakoutIds.current = new Set(Object.values(breakouts).flatMap((b) => b.active.map((a) => a.id)));

  useEffect(() => {
    const updateBreakouts = (parentId: string, fn: (b: BreakoutsForChat) => BreakoutsForChat) =>
      setBreakouts((prev) => ({ ...prev, [parentId]: fn(prev[parentId] ?? EMPTY) }));

    return socket.on((frame: ServerFrame) => {
      switch (frame.type) {
        case "message": {
          const { chatId, message } = frame;
          // A message in a live breakout arrives with the breakout's id,
          // which is in neither list. Only persisted chats are tracked here.
          if (!knownChatIds.current.has(chatId)) {
            if (!liveBreakoutIds.current.has(chatId)) loadChats(); // a chat someone just started with us
            break;
          }
          const bump = (c: Chat) =>
            c.id === chatId ? { ...c, lastMessagePreview: message.text?.slice(0, 120) ?? null, lastMessageAt: message.sentAt } : c;
          setChats((prev) => sortChats(prev.map(bump)));
          setBreakouts((prev) => {
            const next: Record<string, BreakoutsForChat> = {};
            for (const [k, v] of Object.entries(prev)) next[k] = { ...v, kept: v.kept.map(bump) };
            return next;
          });
          if (chatId !== viewedChatId && message.senderId !== me.id) {
            setUnread((prev) => new Set(prev).add(chatId));
          }
          break;
        }
        case "breakout:started": {
          const b = frame.breakout;
          updateBreakouts(b.parentChatId, (cur) => ({
            ...cur,
            active: cur.active.some((x) => x.id === b.id) ? cur.active : [...cur.active, b],
          }));
          if (b.createdByUserId !== me.id) setInvites((prev) => new Set(prev).add(b.id));
          // Someone may have started a chat with us that we have not loaded yet.
          if (!knownChatIds.current.has(b.parentChatId)) loadChats();
          break;
        }
        case "breakout:promoted": {
          const { chatId, parentChatId, chat } = frame;
          updateBreakouts(parentChatId, (cur) => ({
            active: cur.active.filter((x) => x.id !== chatId),
            kept: chat && !cur.kept.some((k) => k.id === chat.id) ? [chat, ...cur.kept] : cur.kept,
          }));
          setInvites((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
          break;
        }
        case "breakout:cleared": {
          const { chatId, parentChatId } = frame;
          updateBreakouts(parentChatId, (cur) => ({ ...cur, active: cur.active.filter((x) => x.id !== chatId) }));
          setInvites((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
          break;
        }
      }
    });
  }, [socket, me.id, viewedChatId, loadChats]);

  // --- navigation --------------------------------------------------------

  const openChat = useCallback(
    (chatId: string) => {
      setView({ type: "chat", chatId });
      setUnread((prev) => {
        const next = new Set(prev);
        next.delete(chatId);
        return next;
      });
    },
    []
  );

  const openBreakout = useCallback((b: Breakout) => {
    setView({ type: "breakout", breakoutId: b.id, parentChatId: b.parentChatId });
    setInvites((prev) => {
      const next = new Set(prev);
      next.delete(b.id);
      return next;
    });
  }, []);

  const findChat = (id: string): Chat | undefined =>
    chats.find((c) => c.id === id) ?? Object.values(breakouts).flatMap((b) => b.kept).find((c) => c.id === id);

  const currentChat = view?.type === "chat" ? findChat(view.chatId) : undefined;
  const currentBreakout =
    view?.type === "breakout" ? breakouts[view.parentChatId]?.active.find((b) => b.id === view.breakoutId) : undefined;

  const invitesByParent = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [parentId, b] of Object.entries(breakouts)) {
      counts[parentId] = b.active.filter((x) => invites.has(x.id)).length;
    }
    return counts;
  }, [breakouts, invites]);

  const nameFor = (chat: Chat) => chatTitle(chat, me, people.nameOf);

  return (
    <div className={`workspace ${view ? "has-view" : ""}`}>
      <Sidebar
        me={me}
        chats={chats}
        loading={loadingChats}
        status={status}
        selectedChatId={view?.type === "chat" ? view.chatId : view?.type === "breakout" ? view.parentChatId : null}
        unread={unread}
        invitesByParent={invitesByParent}
        titleOf={nameFor}
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
            breakouts={breakouts[currentChat.id] ?? EMPTY}
            invites={invites}
            onRefreshBreakouts={() => loadBreakouts(currentChat.id)}
            onOpenBreakout={openBreakout}
            onOpenChat={openChat}
            onBack={() => setView(null)}
            onSent={(message) =>
              setChats((prev) =>
                sortChats(
                  prev.map((c) =>
                    c.id === message.chatId
                      ? { ...c, lastMessagePreview: message.text ?? null, lastMessageAt: message.sentAt }
                      : c
                  )
                )
              )
            }
          />
        )}

        {view?.type === "breakout" && (
          <BreakoutPane
            key={view.breakoutId}
            breakoutId={view.breakoutId}
            initial={currentBreakout}
            parentTitle={findChat(view.parentChatId) ? nameFor(findChat(view.parentChatId)!) : "chat"}
            me={me}
            socket={socket}
            people={people}
            onBack={() => openChat(view.parentChatId)}
            onOpenKept={(chatId) => {
              loadBreakouts(view.parentChatId).then(() => openChat(chatId));
            }}
          />
        )}

        {view?.type === "chat" && !currentChat && <div className="empty">That chat isn't available.</div>}

        {!view && (
          <div className="empty">
            <div className="empty-mark" aria-hidden>
              🔥
            </div>
            <h2>Pick a chat</h2>
            <p className="muted">
              Inside any chat, start a <strong>breakout</strong> with some of the people in it. It lives only in
              the server's memory and clears itself after everyone leaves, unless someone taps Keep.
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
            setChats((prev) => sortChats(prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
            openChat(chat.id);
          }}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          me={me}
          onClose={() => setDialog(null)}
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
