#!/usr/bin/env python3
"""Prompt Enhancer CLI for OpenAI-compatible endpoints."""

import argparse
import os
import sys
from typing import Tuple

from _dotenv import load_dotenv

load_dotenv()


SYSTEM_PROMPT = """
You are an expert Prompt Engineer for Coding Agents (Claude Code, Codex, Gemini CLI).
Your goal is to rewrite the user's raw input into a structured, high-context prompt that maximizes the agent's effectiveness.

Guidelines:
1. Structure: Use a clear Markdown structure with headers.
2. Chain of Thought: Explicitly ask the agent to "Think step-by-step" or "Analyze the file structure first".
3. Context: If the user's prompt is vague, add placeholders like "[Insert relevant file(s)]" or "[Specify tech stack]" in the rewritten prompt, or simply infer them if obvious.
4. Format:
   - Context: What is the current state? What files are involved?
   - Objective: What exactly should be done?
   - Constraints: specific libraries, coding styles, or "no placeholders".
   - Response Format: e.g., "Return only the code block" or "Explain step-by-step".

Output Template:

# Context
[Refined context description]

# Objective
[Precise task definition]

# Step-by-Step Instructions
1. [Step 1]
2. [Step 2]
...

# Constraints
- [Constraint 1]
- [Constraint 2]
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="prompt_enhancer_entry.py",
        description="Enhance a prompt through a third-party OpenAI-compatible API.",
    )
    parser.add_argument("--url", dest="api_url", help="Third-party OpenAI-compatible base URL.")
    parser.add_argument("--api-key", dest="api_key", help="Third-party OpenAI-compatible API key.")
    parser.add_argument("--model", help="Model name on the third-party endpoint.")
    parser.add_argument("--prompt", help="Prompt text to enhance.")
    parser.add_argument("prompt_parts", nargs="*", help=argparse.SUPPRESS)
    return parser.parse_args()


def debug_enabled() -> bool:
    value = os.environ.get("PE_DEBUG", "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


def resolve_prompt(args: argparse.Namespace) -> str:
    prompt = args.prompt.strip() if args.prompt else ""
    if prompt:
        return prompt
    joined = " ".join(args.prompt_parts).strip()
    if joined:
        return joined
    raise ValueError("Missing prompt. Pass --prompt \"...\" or a positional prompt.")


def first_non_empty(*values: str) -> str:
    for value in values:
        stripped = value.strip()
        if stripped:
            return stripped
    return ""


def env_value(*names: str) -> str:
    return first_non_empty(*(os.environ.get(name, "") for name in names))


def resolve_config(args: argparse.Namespace) -> Tuple[str, str, str, str]:
    api_url = (args.api_url or os.environ.get("PE_API_URL", "")).strip()
    api_key = (args.api_key or os.environ.get("PE_API_KEY", "")).strip()
    model = (args.model or os.environ.get("PE_MODEL", "")).strip()

    missing = []
    if not api_url:
        missing.append("url")
    if not api_key:
        missing.append("apiKey")
    if not model:
        missing.append("model")
    if missing:
        has_openai_compatible_transport = bool(api_url or api_key)
        if has_openai_compatible_transport:
            raise ValueError(
                "Missing third-party OpenAI-compatible config: "
                + ", ".join(missing)
                + ". If these fields are unavailable, use the current agent directly."
            )

        legacy_anthropic_key = env_value("ANTHROPIC_API_KEY")
        if legacy_anthropic_key:
            return "anthropic", "", legacy_anthropic_key, first_non_empty(model, "claude-sonnet-4-20250514")

        legacy_openai_key = env_value("OPENAI_API_KEY")
        if legacy_openai_key:
            return "openai", "", legacy_openai_key, first_non_empty(model, "gpt-4o")

        raise ValueError(
            "Missing third-party OpenAI-compatible config: "
            + ", ".join(missing)
            + ". If these fields are unavailable, use the current agent directly."
        )
    return "openai-compatible", api_url, api_key, model


def enhance_with_anthropic(prompt: str, api_key: str, model: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("Missing dependency: anthropic. Install dependencies for the configured provider.") from None

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def _extract_response_text(response) -> str:
    content = response.choices[0].message.content
    if isinstance(content, str):
        return content
    if content is None:
        raise RuntimeError("The provider returned an empty response.")
    return str(content)


def enhance_with_openai(prompt: str, api_key: str, model: str, api_url: str = "") -> str:
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("Missing dependency: openai. Install dependencies for the configured provider.") from None

    kwargs = {"api_key": api_key}
    if api_url:
        kwargs["base_url"] = api_url
    client = OpenAI(**kwargs)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )
    return _extract_response_text(response)


def main() -> None:
    try:
        args = parse_args()
        prompt = resolve_prompt(args)
        provider, api_url, api_key, model = resolve_config(args)
        if provider == "anthropic":
            print(enhance_with_anthropic(prompt, api_key, model))
        else:
            print(enhance_with_openai(prompt, api_key, model, api_url))
    except Exception as exc:
        if debug_enabled():
            print(f"Error: {exc}", file=sys.stderr)
        else:
            msg = str(exc)
            if "Missing third-party OpenAI-compatible config" in msg:
                print("Missing API configuration. Use the current agent directly instead, or set PE_API_URL, PE_API_KEY, PE_MODEL.", file=sys.stderr)
            else:
                print(msg, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
