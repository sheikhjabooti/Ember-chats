import { initials, shortTime } from "../format";
import type { SocketStatus } from "../socket";
import type { Chat, Me } from "../types";

const STATUS_LABEL: Record<SocketStatus, string> = {
  open: "Live",
  connecting: "Connecting…",
  closed: "Offline, retrying",
};

export function Sidebar(props: {
  me: Me;
  chats: Chat[];
  loading: boolean;
  status: SocketStatus;
  selectedChatId: string | null;
  unread: Set<string>;
  invitesByParent: Record<string, number>;
  titleOf: (chat: Chat) => string;
  onOpen: (chatId: string) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const { me, chats } = props;
  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="me">
          <span className="avatar" aria-hidden>
            {initials(me.displayName)}
          </span>
          <div className="me-text">
            <strong>{me.displayName}</strong>
            <span className={`status status-${props.status}`}>{STATUS_LABEL[props.status]}</span>
          </div>
        </div>
        <div className="head-actions">
          <button className="icon-btn" onClick={props.onSettings} title="Settings" aria-label="Settings">
            ⚙
          </button>
          <button className="ghost" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <button className="primary new-chat" onClick={props.onNewChat}>
        + New chat
      </button>

      <nav className="chat-list" aria-label="Chats">
        {props.loading && chats.length === 0 && <p className="muted pad">Loading chats…</p>}
        {!props.loading && chats.length === 0 && (
          <p className="muted pad">No chats yet. Start one with someone who has signed up.</p>
        )}
        {chats.map((chat) => {
          const title = props.titleOf(chat);
          const invites = props.invitesByParent[chat.id] ?? 0;
          const isUnread = props.unread.has(chat.id);
          return (
            <button
              key={chat.id}
              className={`chat-row ${props.selectedChatId === chat.id ? "selected" : ""} ${isUnread ? "unread" : ""}`}
              onClick={() => props.onOpen(chat.id)}
            >
              <span className="avatar" aria-hidden>
                {chat.kind === "group" ? "#" : initials(title)}
              </span>
              <span className="chat-row-text">
                <span className="chat-row-top">
                  <span className="chat-row-title">{title}</span>
                  <span className="chat-row-time">{shortTime(chat.lastMessageAt ?? chat.createdAt)}</span>
                </span>
                <span className="chat-row-preview">{chat.lastMessagePreview ?? "No messages yet"}</span>
              </span>
              {invites > 0 && (
                <span className="badge volatile" title="You were invited to a breakout here">
                  🔥 {invites}
                </span>
              )}
              {isUnread && invites === 0 && <span className="dot" aria-label="Unread" />}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
