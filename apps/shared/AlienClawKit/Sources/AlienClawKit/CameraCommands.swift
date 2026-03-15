import Foundation

public enum AlienClawCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum AlienClawCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum AlienClawCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum AlienClawCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct AlienClawCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: AlienClawCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: AlienClawCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: AlienClawCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: AlienClawCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct AlienClawCameraClipParams: Codable, Sendable, Equatable {
    public var facing: AlienClawCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: AlienClawCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: AlienClawCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: AlienClawCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
