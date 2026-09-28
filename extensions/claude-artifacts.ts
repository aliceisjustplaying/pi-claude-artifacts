// claude-artifacts: lets pi publish claude.ai artifacts (hosted HTML pages at
// https://claude.ai/artifact/<id>) by delegating to Claude Code's built-in
// `Artifact` tool, run headless with pi's own Anthropic OAuth login.
//
// How it works (reverse-engineered from claude-code 2.1.282):
// - The Artifact tool is off in `-p`/SDK mode ("sdk_default_off") unless
//   CLAUDE_CODE_ARTIFACT=1 is set.
// - It needs a claude.ai (subscription) login; CLAUDE_CODE_OAUTH_TOKEN works,
//   so we hand it pi's `anthropic` OAuth token.
// - We ask a cheap model to make exactly one Artifact call with our args and
//   return that tool's raw result (not the model's paraphrase).

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CLAUDE_BIN = process.env.PI_CLAUDE_BIN ?? "claude";
const MODEL = process.env.PI_ARTIFACT_MODEL ?? "haiku";

type RunResult = { toolResults: string[]; toolInputs: unknown[]; final: string; stderr: string; code: number | null };

function runClaude(prompt: string, token: string, cwd: string, signal?: AbortSignal): Promise<RunResult> {
	return new Promise((resolveP, reject) => {
		const child = spawn(
			CLAUDE_BIN,
			["-p", prompt, "--model", MODEL, "--allowedTools", "Artifact", "--max-turns", "6",
				"--output-format", "stream-json", "--verbose"],
			{ cwd, env: { ...process.env, CLAUDE_CODE_ARTIFACT: "1", CLAUDE_CODE_OAUTH_TOKEN: token }, signal },
		);
		let buf = "", stderr = "";
		const out: RunResult = { toolResults: [], toolInputs: [], final: "", stderr: "", code: null };
		const artifactIds = new Set<string>();
		const handle = (line: string) => {
			let d: any;
			try { d = JSON.parse(line); } catch { return; }
			for (const c of d?.message?.content ?? []) {
				if (c.type === "tool_use" && c.name === "Artifact") { artifactIds.add(c.id); out.toolInputs.push(c.input); }
				if (c.type === "tool_result" && artifactIds.has(c.tool_use_id)) {
					const t = typeof c.content === "string" ? c.content
						: (c.content ?? []).map((x: any) => x.text ?? "").join("\n");
					out.toolResults.push((c.is_error ? "[error] " : "") + t);
				}
			}
			if (d.type === "result") out.final = String(d.result ?? "");
		};
		child.stdout.on("data", (b) => {
			buf += b;
			let i;
			while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
		});
		child.stderr.on("data", (b) => (stderr += b));
		child.on("error", reject);
		child.on("close", (code) => { if (buf) handle(buf); out.code = code; out.stderr = stderr; resolveP(out); });
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(defineTool({
		name: "artifact",
		label: "Claude Artifact",
		description:
			"Publish, update, list, or read claude.ai artifacts (hosted web pages at https://claude.ai/artifact/<id>, " +
			"viewable in the browser; private to the user until they share them). " +
			"To publish: first write a complete self-contained HTML file, then call with action \"publish\" and its file_path. " +
			"To update an existing artifact, pass its `url`. Returns the artifact URL; show it to the user.",
		promptSnippet: "artifact: publish an HTML file as a shareable claude.ai artifact page",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("publish"), Type.Literal("list"), Type.Literal("read")], {
				description: "publish (default), list your artifacts, or read one by url",
			}),
			file_path: Type.Optional(Type.String({ description: "Path to the .html file to publish" })),
			title: Type.Optional(Type.String({ description: "Artifact title" })),
			url: Type.Optional(Type.String({ description: "Existing artifact URL (to update on publish, or to read)" })),
			description: Type.Optional(Type.String({ description: "Short description of the artifact" })),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const token = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
			if (!token || !token.startsWith("sk-ant-oat")) {
				throw new Error("Needs pi logged into Anthropic with a Claude subscription (/login → Anthropic). Artifacts require a claude.ai account.");
			}
			const args: Record<string, unknown> = { action: params.action ?? "publish" };
			let cwd = ctx.cwd;
			if (params.file_path) {
				const p = resolve(ctx.cwd, params.file_path);
				if (!existsSync(p)) throw new Error(`File not found: ${p}`);
				args.file_path = p;
				cwd = dirname(p);
			}
			for (const k of ["title", "url", "description"] as const) if (params[k]) args[k] = params[k];

			const prompt =
				`Call the Artifact tool exactly once with these arguments (add nothing else unless the tool rejects the call ` +
				`and says a field is required): ${JSON.stringify(args)}\n` +
				`If the tool refuses because you must read the live version first, do that read, then retry the publish once. ` +
				`Then reply with just the artifact URL(s), or the error.`;

			onUpdate?.({ content: [{ type: "text", text: `Running claude Artifact ${args.action}…` }], details: {} });
			const r = await runClaude(prompt, token, cwd, signal);
			if (r.toolResults.length === 0) {
				throw new Error(`claude produced no Artifact result (exit ${r.code}). ${r.final || r.stderr}`.trim());
			}
			const text = r.toolResults.join("\n\n---\n\n");
			const urls = [...new Set(text.match(/https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+/g) ?? [])];
			return {
				content: [{ type: "text", text }],
				details: { urls, inputs: r.toolInputs },
			};
		},
	}));
}
