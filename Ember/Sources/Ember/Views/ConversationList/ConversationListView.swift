import SwiftUI

public struct ConversationListView: View {
    @State private var viewModel: ConversationListViewModel
    let backend: ChatBackendServicing
    let volatileStore: VolatileChatStore
    let tombstoneLogger: BreakoutTombstoneLogger
    let currentUserID: String

    public init(
        viewModel: ConversationListViewModel,
        backend: ChatBackendServicing,
        volatileStore: VolatileChatStore,
        tombstoneLogger: BreakoutTombstoneLogger,
        currentUserID: String
    ) {
        _viewModel = State(initial: viewModel)
        self.backend = backend
        self.volatileStore = volatileStore
        self.tombstoneLogger = tombstoneLogger
        self.currentUserID = currentUserID
    }

    public var body: some View {
        List {
            ForEach(viewModel.chats) { chat in
                NavigationLink(value: chat) {
                    ConversationRow(chat: chat)
                }
            }
        }
        .navigationTitle("Chats")
        .navigationDestination(for: Chat.self) { chat in
            ChatView(
                viewModel: ChatViewModel(chat: chat, backend: backend, currentUserID: currentUserID),
                backend: backend,
                volatileStore: volatileStore,
                tombstoneLogger: tombstoneLogger,
                currentUserID: currentUserID
            )
        }
        .refreshable { await viewModel.load() }
        .task { await viewModel.load() }
        .overlay {
            if viewModel.isLoading && viewModel.chats.isEmpty {
                ProgressView()
            } else if viewModel.chats.isEmpty {
                ContentUnavailableView("No conversations yet", systemImage: "bubble.left.and.bubble.right")
            }
        }
    }
}

private struct ConversationRow: View {
    let chat: Chat

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(chat.title ?? "Direct chat")
                    .font(.body.bold())
                if let preview = chat.lastMessagePreview {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if chat.kind == .breakout {
                Text("Volatile")
                    .font(.caption2.bold())
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(Color.orange.opacity(0.2)))
            }
        }
        .accessibilityElement(children: .combine)
    }
}
