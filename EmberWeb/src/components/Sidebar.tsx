import { useState } from "react";
import { initials, shortTime } from "../format";
import { draftFor } from "./Messages";
import type { SocketStatus } from "../socket";
import type { Chat, Me } from "../types";

export type SidebarTab = "chats" | "kept";

const STATUS_LABEL: Record<SocketStatus, string> = {
  open: "Live",
  connecting: "Connecting…",
  closed: "Offline, retrying",
};

export function Sidebar(props: {
  me: Me;
  chats: Chat[];
  kept: Chat[];
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  loading: boolean;
  status: SocketStatus;
  selectedChatId: string | null;
  unread: Record<string, number>;
  invitesByParent: Record<string, number>;
  titleOf: (chat: Chat) => string;
  parentTitleOf: (chat: Chat) => string | undefined;
  onOpen: (chatId: string) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const { me, tab } = props;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const all = tab === "chats" ? props.chats : props.kept;
  const list = q
    ? all.filter((c) =>
        [props.titleOf(c), c.lastMessagePreview ?? "", props.parentTitleOf(c) ?? ""].some((s) => s.toLowerCase().includes(q))
      )
    : all;
  const keptUnread = props.kept.reduce((n, c) => n + (props.unread[c.id] ?? 0), 0);

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

      <div className="tabs" role="tablist" aria-label="Lists">
        <button role="tab" aria-selected={tab === "chats"} onClick={() => props.onTab("chats")}>
          Chats
        </button>
        <button role="tab" aria-selected={tab === "kept"} onClick={() => props.onTab("kept")}>
          Kept breakouts
          {props.kept.length > 0 && <span className="tab-count">{keptUnread > 0 ? keptUnread : props.kept.length}</span>}
        </button>
      </div>

      <div className="sidebar-search">
        <input
          type="search"
          placeholder={tab === "chats" ? "Search chats" : "Search kept breakouts"}
          aria-label="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
      </div>

      <nav className="chat-list" aria-label={tab === "chats" ? "Chats" : "Kept breakouts"}>
        {props.loading && list.length === 0 && <p className="muted pad">Loading…</p>}
        {q && list.length === 0 && <p className="muted pad">Nothing matches "{query.trim()}".</p>}
        {!q && !props.loading && list.length === 0 && tab === "chats" && (
          <p className="muted pad">No chats yet. Start one with someone who has signed up.</p>
        )}
        {!q && !props.loading && list.length === 0 && tab === "kept" && (
          <p className="muted pad">
            Breakouts that someone chose to keep end up here. Nothing yet.
          </p>
        )}
        {list.map((chat) => {
          const title = props.titleOf(chat);
          const invites = props.invitesByParent[chat.id] ?? 0;
          const unread = props.unread[chat.id] ?? 0;
          const parent = tab === "kept" ? props.parentTitleOf(chat) : undefined;
          const draft = props.selectedChatId === chat.id ? "" : draftFor(chat.id);
          return (
            <button
              key={chat.id}
              className={`chat-row ${props.selectedChatId === chat.id ? "selected" : ""} ${unread > 0 ? "unread" : ""}`}
              onClick={() => props.onOpen(chat.id)}
            >
              <span className={`avatar ${tab === "kept" ? "kept" : ""}`} aria-hidden>
                {chat.kind === "group" ? "#" : initials(title)}
              </span>
              <span className="chat-row-text">
                <span className="chat-row-top">
                  <span className="chat-row-title">{title}</span>
                  <span className="chat-row-time">{shortTime(chat.lastMessageAt ?? chat.createdAt)}</span>
                </span>
                {parent && <span className="chat-row-from">from {parent}</span>}
                <span className="chat-row-preview">
                  {draft ? (
                    <>
                      <span className="draft-label">Draft:</span> {draft}
                    </>
                  ) : (
                    chat.lastMessagePreview ?? "No messages yet"
                  )}
                </span>
              </span>
              {invites > 0 && (
                <span className="badge volatile" title="You were invited to a breakout here">
                  {invites} live
                </span>
              )}
              {unread > 0 && (
                <span className="count-badge" aria-label={`${unread} unread`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
