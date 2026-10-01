# Homebrew formula skeleton — checksums and version pinned in phase 9.
class AgentTodo < Formula
  desc "MCP task board for AI agents"
  homepage "https://github.com/saleeq/agent-todo"
  version "0.0.0-dev"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/saleeq/agent-todo/releases/latest/download/agent-todo-darwin-arm64"
      # sha256 "TBD"
    end
    on_intel do
      url "https://github.com/saleeq/agent-todo/releases/latest/download/agent-todo-darwin-x64"
      # sha256 "TBD"
    end
  end

  def install
    bin.install "agent-todo-darwin-#{Hardware::CPU.arm? ? "arm64" : "x64"}" => "agent-todo"
  end

  test do
    system "#{bin}/agent-todo", "--version"
  end
end
