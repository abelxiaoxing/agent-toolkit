import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexConfigContent,
  mergeCodexAuthData,
  resolveExistingCodexApiConfig
} from "../lib/cli.mjs";

test("buildCodexConfigContent preserves unrelated fields and target provider extras", () => {
  const currentContent = `custom = "keep"
model_provider = "custom-provider"
preferred_auth_method = "device"

[model_providers.custom-provider]
name = "Custom"
base_url = "https://old.example/v1"
wire_api = "chat"
custom_flag = true

[model_providers.other]
name = "Other"
base_url = "https://other.example/v1"

[features]
foo = true
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://new.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.match(nextContent, /^custom = "keep"$/mu);
  assert.match(nextContent, /^model_provider = "custom-provider"$/mu);
  assert.match(nextContent, /^preferred_auth_method = "apikey"$/mu);
  assert.match(nextContent, /\[model_providers\.custom-provider\][\s\S]*^custom_flag = true$/mu);
  assert.match(nextContent, /\[model_providers\.custom-provider\][\s\S]*^base_url = "https:\/\/new\.example\/v1"$/mu);
  assert.match(nextContent, /\[model_providers\.other\][\s\S]*^base_url = "https:\/\/other\.example\/v1"$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^foo = true$/mu);
  assert.equal((nextContent.match(/\[model_providers\.custom-provider\]/gu) || []).length, 1);
});

test("buildCodexConfigContent is idempotent", () => {
  const templateContent = `personality = "pragmatic"
model_provider = "abelworkflow"

[features]
js_repl = true
`;

  const once = buildCodexConfigContent("", {
    templateContent,
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });
  const twice = buildCodexConfigContent(once, {
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.equal(twice, once);
});

test("mergeCodexAuthData preserves unrelated keys and removes only legacy keys", () => {
  const nextAuth = mergeCodexAuthData({
    OPENAI_API_KEY: "old",
    CUSTOM_API_KEY: "keep",
    metadata: { source: "user" }
  }, "ABEL_API_KEY", "new", ["OPENAI_API_KEY", "IGNORED_API_KEY"]);

  assert.deepEqual(nextAuth, {
    ABEL_API_KEY: "new",
    CUSTOM_API_KEY: "keep",
    metadata: { source: "user" }
  });
});

test("buildCodexConfigContent removes duplicate managed fields in target provider section", () => {
  const currentContent = `[model_providers.abelworkflow]
base_url = "https://old.example/v1"
base_url = "https://older.example/v1"
wire_api = "chat"
wire_api = "legacy"
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.equal((nextContent.match(/^base_url = /gmu) || []).length, 1);
  assert.equal((nextContent.match(/^wire_api = /gmu) || []).length, 1);
});

test("buildCodexConfigContent preserves provider section headers with inline comments", () => {
  const currentContent = `model_provider = "abelworkflow"

[model_providers.abelworkflow] # keep this section
name = "Old"
base_url = "https://old.example/v1"
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.equal((nextContent.match(/\[model_providers\.abelworkflow\]/gu) || []).length, 1);
  assert.match(nextContent, /^\[model_providers\.abelworkflow\] # keep this section$/mu);
  assert.match(
    nextContent,
    /\[model_providers\.abelworkflow\] # keep this section[\s\S]*^base_url = "https:\/\/api\.example\/v1"$/mu
  );
});

test("buildCodexConfigContent preserves existing features and agents values with inline comments", () => {
  const currentContent = `model_provider = "custom-provider"

[agents] # tuned locally
max_threads = 4 # keep this limit

[features] # user overrides
js_repl = false # keep disabled
guardian_approval = false # keep disabled
`;
  const templateContent = `[agents]
max_threads = 10
max_depth = 2

[features]
js_repl = true
guardian_approval = true
multi_agent = true
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent,
    mergeMissingTemplateDefaults: true,
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.match(nextContent, /\[agents\] # tuned locally[\s\S]*^max_threads = 4 # keep this limit$/mu);
  assert.match(nextContent, /\[agents\] # tuned locally[\s\S]*^max_depth = 2$/mu);
  assert.match(nextContent, /\[features\] # user overrides[\s\S]*^js_repl = false # keep disabled$/mu);
  assert.match(nextContent, /\[features\] # user overrides[\s\S]*^guardian_approval = false # keep disabled$/mu);
  assert.match(nextContent, /\[features\] # user overrides[\s\S]*^multi_agent = true$/mu);
});

test("buildCodexConfigContent merges missing template defaults for existing configs", () => {
  const currentContent = `model = "gpt-4.1"
model_provider = "custom-provider"
preferred_auth_method = "device"

[model_providers.custom-provider]
name = "Custom"
base_url = "https://old.example/v1"
wire_api = "chat"

[features]
js_repl = false
`;
  const templateContent = `personality = "pragmatic"
disable_response_storage = true
approvals_reviewer = "reviewer"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
service_tier = "fast"
model = "gpt-5.4"
model_reasoning_effort = "high"
developer_instructions = """
Act as the default orchestrator for specialized subagents.
"""

[agents]
max_threads = 10
max_depth = 2
job_max_runtime_seconds = 2400

[features]
multi_agent = true
js_repl = true
guardian_approval = true
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent,
    mergeMissingTemplateDefaults: true,
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://new.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.match(nextContent, /^personality = "pragmatic"$/mu);
  assert.match(nextContent, /^disable_response_storage = true$/mu);
  assert.match(nextContent, /^approvals_reviewer = "reviewer"$/mu);
  assert.match(nextContent, /^model = "gpt-4\.1"$/mu);
  assert.match(nextContent, /^developer_instructions = """$/mu);
  assert.match(nextContent, /\[agents\][\s\S]*^max_threads = 10$/mu);
  assert.match(nextContent, /\[agents\][\s\S]*^job_max_runtime_seconds = 2400$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^multi_agent = true$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^guardian_approval = true$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^js_repl = false$/mu);
  assert.match(nextContent, /\[model_providers\.custom-provider\][\s\S]*^base_url = "https:\/\/new\.example\/v1"$/mu);
});

test("buildCodexConfigContent does not duplicate existing template defaults", () => {
  const currentContent = `developer_instructions = """
Keep existing instructions.
"""

[features]
multi_agent = false
guardian_approval = false
`;
  const templateContent = `developer_instructions = """
Act as the default orchestrator for specialized subagents.
"""

[features]
multi_agent = true
guardian_approval = true
js_repl = true
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent,
    mergeMissingTemplateDefaults: true,
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.equal((nextContent.match(/^developer_instructions = """$/gmu) || []).length, 1);
  assert.match(nextContent, /^Keep existing instructions\.$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^multi_agent = false$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^guardian_approval = false$/mu);
  assert.match(nextContent, /\[features\][\s\S]*^js_repl = true$/mu);
});

test("buildCodexConfigContent keeps template defaults out of top-level multiline strings", () => {
  const currentContent = `model_provider = "custom-provider"
developer_instructions = """
Keep existing instructions.
[not-a-section]
Still inside string.
"""

[features]
js_repl = false
`;
  const templateContent = `personality = "pragmatic"
approval_policy = "on-request"

[features]
multi_agent = true
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent,
    mergeMissingTemplateDefaults: true,
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.match(nextContent, /^Keep existing instructions\.$/mu);
  assert.match(nextContent, /^\[not-a-section\]$/mu);
  assert.ok(nextContent.indexOf("Still inside string.\n\"\"\"\npersonality = \"pragmatic\"") !== -1);
  assert.ok(nextContent.indexOf("personality = \"pragmatic\"") < nextContent.indexOf("\n[features]\n"));
});

test("buildCodexConfigContent omits subagent defaults when subagents are disabled", () => {
  const templateContent = `personality = "pragmatic"
approvals_reviewer = "reviewer"
developer_instructions = """
Act as the default orchestrator for specialized subagents.
"""

[agents]
max_threads = 10

[features]
multi_agent = true
guardian_approval = true
js_repl = true
`;

  const nextContent = buildCodexConfigContent("", {
    templateContent,
    mergeMissingTemplateDefaults: false,
    includeSubagentDefaults: false,
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.doesNotMatch(nextContent, /^approvals_reviewer = "reviewer"$/mu);
  assert.doesNotMatch(nextContent, /^developer_instructions = """$/mu);
  assert.doesNotMatch(nextContent, /^Act as the default orchestrator for specialized subagents\.$/mu);
  assert.doesNotMatch(nextContent, /^\[agents\]$/mu);
  assert.doesNotMatch(nextContent, /^multi_agent = true$/mu);
  assert.doesNotMatch(nextContent, /^guardian_approval = true$/mu);
  assert.match(nextContent, /^js_repl = true$/mu);
  assert.match(nextContent, /^model_provider = "abelworkflow"$/mu);
  assert.match(nextContent, /^\[model_providers\.abelworkflow\]$/mu);
});

test("buildCodexConfigContent strips existing subagent defaults when subagents are disabled", () => {
  const currentContent = `approvals_reviewer = "reviewer"
developer_instructions = """
Keep subagents enabled.
"""
model_provider = "custom-provider"

[agents]
max_threads = 4

[features]
multi_agent = true
guardian_approval = true
js_repl = false
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent: `personality = "pragmatic"

[features]
js_repl = true
`,
    mergeMissingTemplateDefaults: true,
    includeSubagentDefaults: false,
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.doesNotMatch(nextContent, /^approvals_reviewer = "reviewer"$/mu);
  assert.doesNotMatch(nextContent, /^developer_instructions = """$/mu);
  assert.doesNotMatch(nextContent, /^\[agents\]$/mu);
  assert.doesNotMatch(nextContent, /^multi_agent = true$/mu);
  assert.doesNotMatch(nextContent, /^guardian_approval = true$/mu);
  assert.match(nextContent, /^js_repl = false$/mu);
});

test("buildCodexConfigContent updates top-level fields after multiline strings", () => {
  const currentContent = `model_provider = "custom-provider"
developer_instructions = """
Keep existing instructions.
[not-a-section]
Still inside string.
"""

[features]
js_repl = false
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    providerId: "custom-provider",
    providerName: "Custom",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.ok(nextContent.includes("Still inside string.\n\"\"\"\npreferred_auth_method = \"apikey\""));
  assert.ok(!nextContent.includes("[not-a-section]\npreferred_auth_method = \"apikey\""));
  assert.match(nextContent, /^preferred_auth_method = "apikey"$/mu);
});

test("buildCodexConfigContent migrates bundled reviewer alias to installed reviewer agent", () => {
  const currentContent = `approvals_reviewer = "guardian_subagent"
model_provider = "abelworkflow"
`;

  const nextContent = buildCodexConfigContent(currentContent, {
    templateContent: `approvals_reviewer = "reviewer"
`,
    mergeMissingTemplateDefaults: true,
    includeSubagentDefaults: true,
    providerId: "abelworkflow",
    providerName: "abelworkflow",
    baseUrl: "https://api.example/v1",
    envKey: "OPENAI_API_KEY"
  });

  assert.doesNotMatch(nextContent, /^approvals_reviewer = "guardian_subagent"$/mu);
  assert.match(nextContent, /^approvals_reviewer = "reviewer"$/mu);
});

test("resolveExistingCodexApiConfig prefers configured provider key over unrelated OPENAI_API_KEY", () => {
  const content = `model_provider = "abelworkflow"

[model_providers.abelworkflow]
name = "AbelWorkflow"
base_url = "https://api.example/v1"
temp_env_key = "ABELWORKFLOW_API_KEY"
requires_openai_auth = true
`;

  const existing = resolveExistingCodexApiConfig(content, {
    OPENAI_API_KEY: "shared-openai-key",
    ABELWORKFLOW_API_KEY: "provider-specific-key"
  });

  assert.equal(existing.envKey, "ABELWORKFLOW_API_KEY");
  assert.equal(existing.apiKey, "provider-specific-key");
  assert.deepEqual(existing.legacyEnvKeys, []);
});
