import Foundation

public enum AlienClawChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(AlienClawChatEventPayload)
    case agent(AlienClawAgentEventPayload)
    case seqGap
}

public protocol AlienClawChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> AlienClawChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [AlienClawChatAttachmentPayload]) async throws -> AlienClawChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> AlienClawChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<AlienClawChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension AlienClawChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "AlienClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> AlienClawChatSessionsListResponse {
        throw NSError(
            domain: "AlienClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
