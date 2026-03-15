// swift-tools-version: 6.2
// Package manifest for the AlienClaw macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "AlienClaw",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "AlienClawIPC", targets: ["AlienClawIPC"]),
        .library(name: "AlienClawDiscovery", targets: ["AlienClawDiscovery"]),
        .executable(name: "AlienClaw", targets: ["AlienClaw"]),
        .executable(name: "alienclaw-mac", targets: ["AlienClawMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/AlienClawKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "AlienClawIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlienClawDiscovery",
            dependencies: [
                .product(name: "AlienClawKit", package: "AlienClawKit"),
            ],
            path: "Sources/AlienClawDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "AlienClaw",
            dependencies: [
                "AlienClawIPC",
                "AlienClawDiscovery",
                .product(name: "AlienClawKit", package: "AlienClawKit"),
                .product(name: "AlienClawChatUI", package: "AlienClawKit"),
                .product(name: "AlienClawProtocol", package: "AlienClawKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/AlienClaw.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "AlienClawMacCLI",
            dependencies: [
                "AlienClawDiscovery",
                .product(name: "AlienClawKit", package: "AlienClawKit"),
                .product(name: "AlienClawProtocol", package: "AlienClawKit"),
            ],
            path: "Sources/AlienClawMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "AlienClawIPCTests",
            dependencies: [
                "AlienClawIPC",
                "AlienClaw",
                "AlienClawDiscovery",
                .product(name: "AlienClawProtocol", package: "AlienClawKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
