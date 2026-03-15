import Foundation

public enum AlienClawDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum AlienClawBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum AlienClawThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum AlienClawNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum AlienClawNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct AlienClawBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: AlienClawBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: AlienClawBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct AlienClawThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: AlienClawThermalState

    public init(state: AlienClawThermalState) {
        self.state = state
    }
}

public struct AlienClawStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct AlienClawNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: AlienClawNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [AlienClawNetworkInterfaceType]

    public init(
        status: AlienClawNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [AlienClawNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct AlienClawDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: AlienClawBatteryStatusPayload
    public var thermal: AlienClawThermalStatusPayload
    public var storage: AlienClawStorageStatusPayload
    public var network: AlienClawNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: AlienClawBatteryStatusPayload,
        thermal: AlienClawThermalStatusPayload,
        storage: AlienClawStorageStatusPayload,
        network: AlienClawNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct AlienClawDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
