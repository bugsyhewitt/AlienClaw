#!/usr/bin/env ruby
# frozen_string_literal: true

require "English"

class AlienClaw < Formula
  desc "Three-agent AI governance layer for OpenClaw — BossBot, AdvisorBot, CreatorBot"
  homepage "https://alienclaw.net"
  url "https://github.com/AlienTool/AlienClaw.git"
  version "2026.3.7"
  license "MIT"
  head "https://github.com/AlienTool/AlienClaw.git", branch: "main"

  depends_on "node" => ">=22.12.0"

  def install
    # Install OpenClaw if not present
    system "npm", "install", "-g", "openclaw" unless Formula["openclaw"].installed?

    # Run the AlienClaw installer
    system "bash", "install.sh"
  end

  def post_install
    # Verify the three agents are installed
    agents_dir = Dir.glob("#{ENV["HOME"]}/.openclaw/agents/*/").select { |d| Dir.exist?(d) }
    expected = %w[bossbot advisorbot creatorbot]
    installed = agents_dir.map { |d| File.basename(d) }

    missing = expected - installed
    return if missing.empty?

    onoe "AlienClaw installed but missing agents: #{missing.join(", ")}"
    onoe "Run 'bash #{opt_libexec/"install.sh"}' to complete setup"
  end

  def caveats
    <<~EOS
      AlienClaw has been installed!

      OpenClaw is now configured with three wired agents:
        - BossBot (default) 👽
        - AdvisorBot 🧠
        - CreatorBot 🔧

      Start chatting:
        openclaw chat

      List agents:
        openclaw agents list

      Uninstall AlienClaw agents (keep OpenClaw):
        bash #{opt_pkgshare/"install.sh"} --uninstall

      Note: The OpenClaw binary was installed globally. Use `npm install -g openclaw` to update it.
    EOS
  end
end