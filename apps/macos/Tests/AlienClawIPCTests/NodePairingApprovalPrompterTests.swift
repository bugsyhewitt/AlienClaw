import Testing
@testable import AlienClaw

@Suite(.serialized)
@MainActor
struct NodePairingApprovalPrompterTests {
    @Test func nodePairingApprovalPrompterExercises() async {
        await NodePairingApprovalPrompter.exerciseForTesting()
    }
}
