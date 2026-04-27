import test from "node:test";
import assert from "node:assert/strict";
import {
  assertInteractiveMenuSupported,
  getRunCommandSpawnOptions,
  interactiveMenuDefaultValue,
  interactiveMenuDescriptors,
  parseArgs,
  resolvePromptValue,
  resolveSelectValue,
  shouldUseVisibleSecretFallback
} from "../lib/cli/logic.mjs";
import {
  hasPromptEnhancerApiConfig,
  mergeCodexAuthData,
  resolvePromptEnhancerMode
} from "../lib/cli.mjs";

const defaultAgentsDir = "/home/test/.agents";
const resolvePath = (value) => `/resolved/${value.replace(/^\/+/, "")}`;

const expectedMenuDescriptors = [
  {
    value: "full-init",
    label: "完整初始化：同步工作流 + 可选安装/配置 Claude Code、Codex、技能环境"
  },
  {
    value: "install",
    label: "仅同步/更新工作流到 ~/.agents 并重新链接 Claude/Codex"
  },
  {
    value: "grok-search",
    label: "配置 grok-search 环境变量"
  },
  {
    value: "context7",
    label: "配置 context7-auto-research 环境变量"
  },
  {
    value: "prompt-enhancer",
    label: "配置 prompt-enhancer 环境变量"
  },
  {
    value: "claude-install",
    label: "安装或更新 Claude Code CLI"
  },
  {
    value: "claude-api",
    label: "配置 Claude Code 第三方 API"
  },
  {
    value: "codex-install",
    label: "安装或更新 Codex CLI"
  },
  {
    value: "codex-api",
    label: "配置 Codex 第三方 API"
  },
  {
    value: "exit",
    label: "退出"
  }
];

function assertParse(argv, expected) {
  assert.deepEqual(parseArgs(argv, { defaultAgentsDir, resolvePath }), expected);
}

function assertParseError(argv, expectedMessage) {
  assert.throws(
    () => parseArgs(argv, { defaultAgentsDir, resolvePath }),
    (error) => error instanceof Error && error.message === expectedMessage
  );
}

test("parseArgs normalizes command aliases and help routing", () => {
  const cases = [
    {
      argv: [],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "menu"
      }
    },
    {
      argv: ["menu"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "menu"
      }
    },
    {
      argv: ["init"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "menu"
      }
    },
    {
      argv: ["install"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "install"
      }
    },
    {
      argv: ["sync"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "install"
      }
    },
    {
      argv: ["--help"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "help"
      }
    },
    {
      argv: ["-h", "install"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "help"
      }
    },
    {
      argv: ["help", "install"],
      expected: {
        agentsDir: defaultAgentsDir,
        force: false,
        relinkOnly: false,
        command: "help"
      }
    },
    {
      argv: ["install", "--force", "--link-only", "--agents-dir", "custom/path"],
      expected: {
        agentsDir: "/resolved/custom/path",
        force: true,
        relinkOnly: true,
        command: "install"
      }
    },
    {
      argv: ["--force", "--link-only", "--agents-dir", "custom/path", "install"],
      expected: {
        agentsDir: "/resolved/custom/path",
        force: true,
        relinkOnly: true,
        command: "install"
      }
    }
  ];

  for (const { argv, expected } of cases) {
    assertParse(argv, expected);
  }
});

test("parseArgs gates install-only options outside install command", () => {
  const menuCommands = [[], ["menu"], ["init"], ["--help"], ["help"]];
  const installOnlyOptionSets = [
    { args: ["--force"] },
    { args: ["-f"] },
    { args: ["--link-only"] },
    { args: ["--agents-dir", "custom/path"] },
    { args: ["--force", "--link-only"] },
    { args: ["--force", "--agents-dir", "custom/path"] },
    { args: ["--link-only", "--agents-dir", "custom/path"] },
    { args: ["--force", "--link-only", "--agents-dir", "custom/path"] }
  ];

  for (const command of menuCommands) {
    for (const optionSet of installOnlyOptionSets) {
      assertParseError(
        [...command, ...optionSet.args],
        "`--force`、`--link-only`、`--agents-dir` 仅能与 `install` 命令一起使用"
      );
    }
  }

  for (const optionSet of installOnlyOptionSets) {
    const result = parseArgs(["install", ...optionSet.args], { defaultAgentsDir, resolvePath });
    assert.equal(result.command, "install");
  }
});

test("parseArgs rejects unknown tokens and extra positional arguments", () => {
  const unknownFlagCases = ["--unknown", "-x", "--verbose"];
  for (const token of unknownFlagCases) {
    assertParseError([token], `Unknown argument: ${token}`);
  }

  const unknownCommandCases = [
    [["deploy"], "Unknown command: deploy"],
    [["foo"], "Unknown command: foo"],
    [["help", "deploy"], "Unknown command: deploy"]
  ];
  for (const [argv, message] of unknownCommandCases) {
    assertParseError(argv, message);
  }

  const extraPositionalCases = [
    [["install", "extra"], "Unknown argument: extra"],
    [["menu", "extra"], "Unknown argument: extra"],
    [["install", "extra", "more"], "Unknown argument: extra more"]
  ];
  for (const [argv, message] of extraPositionalCases) {
    assertParseError(argv, message);
  }

  assertParseError(["--agents-dir"], "--agents-dir requires a path");
});

test("assertInteractiveMenuSupported enforces TTY only for menu command", () => {
  const commands = ["help", "install", "menu"];
  const ttyStates = [
    { inputIsTTY: true, outputIsTTY: true, shouldThrow: false },
    { inputIsTTY: true, outputIsTTY: false, shouldThrow: true },
    { inputIsTTY: false, outputIsTTY: true, shouldThrow: true },
    { inputIsTTY: false, outputIsTTY: false, shouldThrow: true }
  ];

  for (const command of commands) {
    for (const ttyState of ttyStates) {
      const act = () => assertInteractiveMenuSupported({ command, ...ttyState });
      if (command === "menu" && ttyState.shouldThrow) {
        assert.throws(
          act,
          (error) => error instanceof Error
            && error.message === "交互式菜单需要 TTY 终端；非交互场景请显式使用 `npx abelworkflow install`"
        );
        continue;
      }
      assert.doesNotThrow(act);
    }
  }
});

test("interactive menu descriptors keep order, uniqueness, default membership, and display closure", () => {
  assert.deepEqual(interactiveMenuDescriptors, expectedMenuDescriptors);
  assert.equal(interactiveMenuDefaultValue, "full-init");

  const values = interactiveMenuDescriptors.map((descriptor) => descriptor.value);
  const labels = interactiveMenuDescriptors.map((descriptor) => descriptor.label);
  assert.equal(new Set(values).size, values.length);
  assert.ok(labels.every((label) => typeof label === "string" && label.length > 0));
  assert.ok(values.includes(interactiveMenuDefaultValue));
  assert.equal(values[values.length - 1], "exit");
  assert.equal(values.filter((value) => value === "exit").length, 1);

  const displayChoices = interactiveMenuDescriptors.map(({ value, label }) => ({ value, label }));
  assert.deepEqual(displayChoices, expectedMenuDescriptors);
});

test("resolvePromptValue trims input, applies defaults, and preserves empty-input errors", () => {
  const blankInputs = ["", " ", "\t", "\n", "  \t  "];
  for (const answer of blankInputs) {
    assert.deepEqual(resolvePromptValue(answer, { allowEmpty: false }), {
      ok: false,
      error: "此项不能为空。"
    });
    assert.deepEqual(resolvePromptValue(answer, { defaultValue: "fallback", allowEmpty: false }), {
      ok: true,
      value: "fallback"
    });
    assert.deepEqual(resolvePromptValue(answer, { defaultValue: "", allowEmpty: true }), {
      ok: true,
      value: ""
    });
  }

  const trimmedCases = [
    { answer: " value ", value: "value" },
    { answer: "\ttrimmed\n", value: "trimmed" },
    { answer: "0", value: "0" }
  ];
  for (const { answer, value } of trimmedCases) {
    assert.deepEqual(resolvePromptValue(answer, { allowEmpty: false }), {
      ok: true,
      value
    });
  }

  assert.deepEqual(resolvePromptValue("   ", { allowEmpty: true }), {
    ok: true,
    value: ""
  });
});

test("resolveSelectValue supports 1-based indices, direct values, and keeps invalid-input errors", () => {
  const choiceSets = [
    expectedMenuDescriptors,
    [
      { value: true, label: "是" },
      { value: false, label: "否" }
    ]
  ];

  for (const choices of choiceSets) {
    assert.deepEqual(resolveSelectValue("1", choices), {
      ok: true,
      value: choices[0].value
    });
    assert.deepEqual(resolveSelectValue(String(choices.length), choices), {
      ok: true,
      value: choices[choices.length - 1].value
    });
  }

  assert.deepEqual(resolveSelectValue("full-init", expectedMenuDescriptors), {
    ok: true,
    value: "full-init"
  });
  assert.deepEqual(resolveSelectValue("codex-api", expectedMenuDescriptors), {
    ok: true,
    value: "codex-api"
  });
  assert.deepEqual(resolveSelectValue(true, [
    { value: true, label: "是" },
    { value: false, label: "否" }
  ]), {
    ok: true,
    value: true
  });

  const invalidAnswers = ["0", "-1", "11", "1.5", " FULL-INIT ", "unknown"];
  for (const answer of invalidAnswers) {
    assert.deepEqual(resolveSelectValue(answer, expectedMenuDescriptors), {
      ok: false,
      error: "无效选择，请重新输入。"
    });
  }
});

test("getRunCommandSpawnOptions and shouldUseVisibleSecretFallback preserve platform contracts", () => {
  const platforms = ["win32", "linux", "darwin", "freebsd", "unknown"];
  for (const platform of platforms) {
    assert.deepEqual(getRunCommandSpawnOptions(platform), {
      stdio: "inherit",
      shell: platform === "win32"
    });
  }

  const visibilityCases = [
    { inputIsTTY: true, platform: "linux", expected: false },
    { inputIsTTY: true, platform: "win32", expected: true },
    { inputIsTTY: false, platform: "linux", expected: true },
    { inputIsTTY: false, platform: "win32", expected: true }
  ];
  for (const testCase of visibilityCases) {
    assert.equal(shouldUseVisibleSecretFallback(testCase), testCase.expected);
  }
});

test("getRunCommandSpawnOptions default preserves ABELWORKFLOW_TEST_PLATFORM override", { concurrency: false }, () => {
  const previousPlatform = process.env.ABELWORKFLOW_TEST_PLATFORM;
  process.env.ABELWORKFLOW_TEST_PLATFORM = "win32";

  try {
    assert.deepEqual(getRunCommandSpawnOptions(), {
      stdio: "inherit",
      shell: true
    });
  } finally {
    if (previousPlatform === undefined) {
      delete process.env.ABELWORKFLOW_TEST_PLATFORM;
      return;
    }
    process.env.ABELWORKFLOW_TEST_PLATFORM = previousPlatform;
  }
});

test("mergeCodexAuthData preserves unrelated keys while replacing env key and removing legacy keys", () => {
  const authCases = [
    {
      auth: {},
      envKey: "OPENAI_API_KEY",
      apiKey: "new-secret",
      legacyEnvKeys: [],
      expected: { OPENAI_API_KEY: "new-secret" }
    },
    {
      auth: {
        OPENAI_API_KEY: "old-secret",
        OPENAI_BASE_URL: "https://example.com/v1",
        LEGACY_ONE: "legacy-1",
        LEGACY_TWO: "legacy-2"
      },
      envKey: "OPENAI_API_KEY",
      apiKey: "new-secret",
      legacyEnvKeys: ["LEGACY_ONE", "LEGACY_TWO"],
      expected: {
        OPENAI_API_KEY: "new-secret",
        OPENAI_BASE_URL: "https://example.com/v1"
      }
    },
    {
      auth: {
        CUSTOM_KEY: "keep-me",
        OPENAI_API_KEY: "old-secret"
      },
      envKey: "OPENAI_API_KEY",
      apiKey: "fresh-secret",
      legacyEnvKeys: ["OPENAI_API_KEY", "UNUSED_LEGACY"],
      expected: {
        CUSTOM_KEY: "keep-me",
        OPENAI_API_KEY: "fresh-secret"
      }
    }
  ];

  for (const testCase of authCases) {
    assert.deepEqual(
      mergeCodexAuthData(testCase.auth, testCase.envKey, testCase.apiKey, testCase.legacyEnvKeys),
      testCase.expected
    );
  }
});

test("hasPromptEnhancerApiConfig requires complete OpenAI-compatible config", () => {
  const cases = [
    {
      value: {
        PE_API_URL: "https://example.com/v1",
        PE_API_KEY: "secret",
        PE_MODEL: "gpt-4o-mini"
      },
      expected: true
    },
    {
      value: {
        PE_API_URL: "https://example.com/v1",
        PE_API_KEY: "secret"
      },
      expected: false
    },
    {
      value: {
        PE_API_URL: "",
        PE_API_KEY: "secret",
        PE_MODEL: "gpt-4o-mini"
      },
      expected: false
    }
  ];

  for (const testCase of cases) {
    assert.equal(hasPromptEnhancerApiConfig(testCase.value), testCase.expected);
  }
});

test("resolvePromptEnhancerMode prefers OpenAI-compatible config and otherwise falls back to current agent mode", () => {
  const cases = [
    {
      existing: {
        PE_API_URL: "https://example.com/v1",
        PE_API_KEY: "secret",
        PE_MODEL: "gpt-4o-mini"
      },
      expected: "openai-compatible"
    },
    {
      existing: {
        OPENAI_API_KEY: "legacy-secret",
        PE_MODEL: "gpt-4o"
      },
      expected: "agent"
    },
    {
      existing: {
        ANTHROPIC_API_KEY: "legacy-anthropic"
      },
      expected: "agent"
    }
  ];

  for (const testCase of cases) {
    assert.equal(resolvePromptEnhancerMode(testCase.existing), testCase.expected);
  }
});
