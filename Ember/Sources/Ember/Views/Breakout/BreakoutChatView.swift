import SwiftUI

public struct BreakoutChatView: View {
    @State private var viewModel: BreakoutChatViewModel
    @State private var draftText: String = ""
    @Environment(\.dismiss) private var dismiss

    public init(viewModel: BreakoutChatViewModel) {
        _viewModel = State(initial: viewModel)
    }

    public var body: some View {
        VStack(spacing: 0) {
            volatileBanner

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.messages) { message in
                        BreakoutBubble(message: message)
                    }
                }
                .padding()
            }

            composer
        }
        .navigationTitle("Breakout")
        .toolbar {
            ToolbarItem(placement: .principal) {
                VolatilePill(secondsUntilClear: viewModel.isShowingClearWarning ? viewModel.secondsUntilClear : nil)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("End Breakout") {
                    Task { await viewModel.endBreakout() }
                }
            }
        }
        .task { await viewModel.start() }
        .onDisappear { Task { await viewModel.participantLeft() } }
        .onChange(of: viewModel.wasPurged) { _, purged in
            if purged { dismiss() }
        }
        .sheet(isPresented: Binding(
            get: { viewModel.isShowingClearWarning },
            set: { _ in }
        )) {
            ClearanceWarningSheet(
                secondsRemaining: viewModel.secondsUntilClear,
                onKeep: {
                    Task { try? await viewModel.keepChat() }
                }
            )
            .presentationDetents([.height(220)])
            .interactiveDismissDisabled()
        }
    }

    private var volatileBanner: some View {
        HStack {
            Image(systemName: "flame")
            Text("This chat will be cleared when everyone leaves.")
                .font(.footnote)
            Spacer()
            Button("Keep Chat") {
                Task { try? await viewModel.keepChat() }
            }
            .font(.footnote.bold())
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.15))
        .accessibilityElement(children: .combine)
    }

    private var composer: some View {
        HStack {
            TextField("Message", text: $draftText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            Button {
                let text = draftText
                draftText = ""
                Task { try? await viewModel.send(text: text) }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
    }
}

private struct BreakoutBubble: View {
    let message: Message

    var body: some View {
        Text(message.text ?? "")
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.orange, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
                    .background(RoundedRectangle(cornerRadius: 14).fill(Color.orange.opacity(0.08)))
            )
            .accessibilityLabel("Breakout message: \(message.text ?? "")")
    }
}

private struct VolatilePill: View {
    let secondsUntilClear: Int?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(Color.orange).frame(width: 6, height: 6)
            Text(secondsUntilClear.map { "Volatile · clears in \($0)s" } ?? "Volatile")
                .font(.caption.bold())
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color.orange.opacity(0.15)))
        .accessibilityLabel(secondsUntilClear.map { "Volatile chat, clearing in \($0) seconds" } ?? "Volatile chat")
    }
}

private struct ClearanceWarningSheet: View {
    let secondsRemaining: Int
    let onKeep: () -> Void

    public var body: some View {
        VStack(spacing: 16) {
            Text("This breakout chat is about to be cleared.")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("Clearing in \(secondsRemaining)s")
                .font(.largeTitle.monospacedDigit())
                .foregroundStyle(.orange)
            Button("Keep Chat", action: onKeep)
                .buttonStyle(.borderedProminent)
                .tint(.orange)
            Text("Let it go — nothing else to do.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
