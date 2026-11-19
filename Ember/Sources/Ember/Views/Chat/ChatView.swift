import SwiftUI

public struct ChatView: View {
    @State private var viewModel: ChatViewModel
    @State private var draftText = ""
    @State private var isShowingBreakoutPicker = false
    @State private var activeBreakoutChat: Chat?

    let backend: ChatBackendServicing
    let volatileStore: VolatileChatStore
    let tombstoneLogger: BreakoutTombstoneLogger
    let currentUserID: String

    public init(
        viewModel: ChatViewModel,
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
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message, isMine: message.senderID == currentUserID)
                    }
                }
                .padding()
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y < 40
            } action: { _, isNearTop in
                if isNearTop { Task { await viewModel.loadOlder() } }
            }

            composer
        }
        .navigationTitle(viewModel.chat.title ?? "Chat")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Start Breakout") { isShowingBreakoutPicker = true }
            }
        }
        .task { await viewModel.loadInitial() }
        .sheet(isPresented: $isShowingBreakoutPicker) {
            BreakoutParticipantPicker(
                candidates: viewModel.chat.participantIDs.filter { $0 != currentUserID }
            ) { selectedIDs in
                isShowingBreakoutPicker = false
                Task {
                    if let breakout = try? await viewModel.startBreakout(with: selectedIDs) {
                        activeBreakoutChat = breakout
                    }
                }
            }
        }
        .navigationDestination(item: $activeBreakoutChat) { breakoutChat in
            BreakoutChatView(
                viewModel: BreakoutChatViewModel(
                    chat: breakoutChat,
                    store: volatileStore,
                    backend: backend,
                    tombstoneLogger: tombstoneLogger,
                    currentUserID: currentUserID
                )
            )
        }
    }

    private var composer: some View {
        HStack {
            TextField("Message", text: $draftText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .onChange(of: draftText) { _, newValue in
                    Task { await viewModel.setTyping(!newValue.isEmpty) }
                }
            Button {
                let text = draftText
                draftText = ""
                Task { try? await viewModel.send(text: text) }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
    }
}

private struct MessageBubble: View {
    let message: Message
    let isMine: Bool

    var body: some View {
        HStack {
            if isMine { Spacer() }
            Text(message.text ?? "")
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 14).fill(isMine ? Color.blue.opacity(0.15) : Color.gray.opacity(0.12)))
            if !isMine { Spacer() }
        }
    }
}

private struct BreakoutParticipantPicker: View {
    let candidates: [String]
    let onStart: ([String]) -> Void
    @State private var selected: Set<String> = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(candidates, id: \.self, selection: $selected) { userID in
                Text(userID)
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Start Breakout")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { onStart(Array(selected)) }
                        .disabled(selected.isEmpty)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
