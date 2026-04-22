const interactiveMenuDescriptors = [
  { value: "full-init", label: "完整初始化：同步工作流 + 可选安装/配置 Claude Code、Codex、技能环境" },
  { value: "install", label: "仅同步/更新工作流到 ~/.agents 并重新链接 Claude/Codex" },
  { value: "grok-search", label: "配置 grok-search 环境变量" },
  { value: "context7", label: "配置 context7-auto-research 环境变量" },
  { value: "prompt-enhancer", label: "配置 prompt-enhancer 环境变量" },
  { value: "claude-install", label: "安装或更新 Claude Code CLI" },
  { value: "claude-api", label: "配置 Claude Code 第三方 API" },
  { value: "codex-install", label: "安装或更新 Codex CLI" },
  { value: "codex-api", label: "配置 Codex 第三方 API" },
  { value: "exit", label: "退出" }
];

const interactiveMenuDefaultValue = "full-init";

function parseArgs(argv, { defaultAgentsDir, resolvePath }) {
  const options = {
    agentsDir: defaultAgentsDir,
    force: false,
    relinkOnly: false,
    command: "menu"
  };
  const positional = [];
  let helpRequested = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }
    if (arg === "--link-only") {
      options.relinkOnly = true;
      continue;
    }
    if (arg === "--agents-dir") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--agents-dir requires a path");
      }
      options.agentsDir = resolvePath(value);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h" || arg === "help") {
      helpRequested = true;
      options.command = "help";
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error(`Unknown argument: ${positional.slice(1).join(" ")}`);
  }

  if (positional[0]) {
    if (["menu", "init"].includes(positional[0])) {
      if (!helpRequested) {
        options.command = "menu";
      }
    } else if (["install", "sync"].includes(positional[0])) {
      if (!helpRequested) {
        options.command = "install";
      }
    } else {
      throw new Error(`Unknown command: ${positional[0]}`);
    }
  }

  if (options.command !== "install" && (options.force || options.relinkOnly || options.agentsDir !== defaultAgentsDir)) {
    throw new Error("`--force`、`--link-only`、`--agents-dir` 仅能与 `install` 命令一起使用");
  }

  return options;
}

function assertInteractiveMenuSupported({ command, inputIsTTY, outputIsTTY }) {
  if (command === "menu" && (!inputIsTTY || !outputIsTTY)) {
    throw new Error("交互式菜单需要 TTY 终端；非交互场景请显式使用 `npx abelworkflow install`");
  }
}

function resolvePromptValue(answer, { defaultValue, allowEmpty = false } = {}) {
  const value = String(answer).trim();
  if (!value && defaultValue !== undefined) {
    return { ok: true, value: defaultValue };
  }
  if (!value && !allowEmpty) {
    return { ok: false, error: "此项不能为空。" };
  }
  return { ok: true, value };
}

function resolveSelectValue(answer, choices) {
  const index = Number(answer) - 1;
  if (Number.isInteger(index) && index >= 0 && index < choices.length) {
    return { ok: true, value: choices[index].value };
  }
  const direct = choices.find((choice) => choice.value === answer);
  if (direct) {
    return { ok: true, value: direct.value };
  }
  return { ok: false, error: "无效选择，请重新输入。" };
}

function shouldUseVisibleSecretFallback({ inputIsTTY, platform }) {
  return !inputIsTTY || platform === "win32";
}

function getRunCommandSpawnOptions(platform = process.env.ABELWORKFLOW_TEST_PLATFORM || process.platform) {
  return {
    stdio: "inherit",
    shell: platform === "win32"
  };
}

export {
  assertInteractiveMenuSupported,
  getRunCommandSpawnOptions,
  interactiveMenuDefaultValue,
  interactiveMenuDescriptors,
  parseArgs,
  resolvePromptValue,
  resolveSelectValue,
  shouldUseVisibleSecretFallback
};
