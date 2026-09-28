# pi-claude-artifacts

A [pi](https://pi.dev) extension that adds an `artifact` tool. It lets the agent publish, update, list and read claude.ai artifacts (hosted pages at `https://claude.ai/artifact/<id>`).

## Requirements

- pi logged into Anthropic with a Claude subscription (`/login` → Anthropic). Artifacts need a claude.ai account; API keys won't work.
- The `claude` CLI (Claude Code) on your `PATH`. It doesn't need its own login.

## Install

```sh
pi install git:github.com/aliceisjustplaying/pi-claude-artifacts
```

## Usage

Ask the agent to make something and publish it as an artifact. It writes an HTML file and calls:

| action    | arguments                                  |
|-----------|--------------------------------------------|
| `publish` | `file_path`, optional `title`, `description`, `url` (pass `url` to update an existing artifact) |
| `list`    | none                                       |
| `read`    | `url`                                      |

New artifacts are private. Share them from the page's Share menu.

## How it works

Claude Code has a built-in `Artifact` tool, but it's off in `claude -p` mode unless `CLAUDE_CODE_ARTIFACT=1` is set. The extension runs `claude -p --allowedTools Artifact` with that variable, passes pi's Anthropic OAuth token as `CLAUDE_CODE_OAUTH_TOKEN`, and returns the Artifact tool's raw result.

Each call costs one small model request (Haiku by default). Environment overrides:

- `PI_ARTIFACT_MODEL`: model for the delegated call (default `haiku`)
- `PI_CLAUDE_BIN`: path to the `claude` binary (default `claude`)

This relies on undocumented Claude Code behavior (tested with 2.1.282), so a Claude Code update could break it.
