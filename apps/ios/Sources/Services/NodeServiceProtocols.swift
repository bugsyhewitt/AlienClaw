import CoreLocation
import Foundation
import AlienClawKit
import UIKit

typealias AlienClawCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias AlienClawCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: AlienClawCameraSnapParams) async throws -> AlienClawCameraSnapResult
    func clip(params: AlienClawCameraClipParams) async throws -> AlienClawCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: AlienClawLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: AlienClawLocationGetParams,
        desiredAccuracy: AlienClawLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: AlienClawLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> AlienClawDeviceStatusPayload
    func info() -> AlienClawDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: AlienClawPhotosLatestParams) async throws -> AlienClawPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: AlienClawContactsSearchParams) async throws -> AlienClawContactsSearchPayload
    func add(params: AlienClawContactsAddParams) async throws -> AlienClawContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: AlienClawCalendarEventsParams) async throws -> AlienClawCalendarEventsPayload
    func add(params: AlienClawCalendarAddParams) async throws -> AlienClawCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: AlienClawRemindersListParams) async throws -> AlienClawRemindersListPayload
    func add(params: AlienClawRemindersAddParams) async throws -> AlienClawRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: AlienClawMotionActivityParams) async throws -> AlienClawMotionActivityPayload
    func pedometer(params: AlienClawPedometerParams) async throws -> AlienClawPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: AlienClawWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
