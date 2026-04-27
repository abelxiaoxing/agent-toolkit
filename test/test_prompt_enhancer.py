import argparse
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "skills" / "prompt-enhancer" / "scripts"


def load_module(module_name: str, file_name: str) -> types.ModuleType:
    file_path = SCRIPTS_DIR / file_name
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {file_path}")
    module = importlib.util.module_from_spec(spec)
    original_path = list(sys.path)
    try:
        sys.path.insert(0, str(SCRIPTS_DIR))
        spec.loader.exec_module(module)
    finally:
        sys.path[:] = original_path
    return module


class PromptEnhancerConfigTests(unittest.TestCase):
    def test_resolve_config_supports_legacy_openai_key(self) -> None:
        module = load_module("prompt_enhancer_enhance_legacy_openai", "enhance.py")
        args = argparse.Namespace(api_url=None, api_key=None, model=None, prompt=None, prompt_parts=[])

        with mock.patch.dict(
            "os.environ",
            {"OPENAI_API_KEY": "legacy-secret", "PE_MODEL": "gpt-4o-mini"},
            clear=True,
        ):
            provider, api_url, api_key, model = module.resolve_config(args)

        self.assertEqual((provider, api_url, api_key, model), ("openai", "", "legacy-secret", "gpt-4o-mini"))

    def test_resolve_config_supports_legacy_anthropic_key(self) -> None:
        module = load_module("prompt_enhancer_enhance_legacy_anthropic", "enhance.py")
        args = argparse.Namespace(api_url=None, api_key=None, model=None, prompt=None, prompt_parts=[])

        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "legacy-anthropic"}, clear=True):
            provider, api_url, api_key, model = module.resolve_config(args)

        self.assertEqual((provider, api_url, api_key, model), ("anthropic", "", "legacy-anthropic", "claude-sonnet-4-20250514"))

    def test_required_modules_merges_cli_and_env_sources(self) -> None:
        module = load_module("prompt_enhancer_entry_merge", "prompt_enhancer_entry.py")

        with mock.patch.dict("os.environ", {"PE_MODEL": "gpt-4o-mini"}, clear=True):
            with mock.patch.object(
                sys,
                "argv",
                [
                    "prompt_enhancer_entry.py",
                    "--url",
                    "https://example.com/v1",
                    "--api-key",
                    "secret",
                    "rewrite this prompt",
                ],
            ):
                self.assertEqual(module.required_modules(), ["openai"])

    def test_required_modules_bootstraps_legacy_anthropic(self) -> None:
        module = load_module("prompt_enhancer_entry_legacy_anthropic", "prompt_enhancer_entry.py")

        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "legacy-anthropic"}, clear=True):
            with mock.patch.object(sys, "argv", ["prompt_enhancer_entry.py", "rewrite this prompt"]):
                self.assertEqual(module.required_modules(), ["anthropic"])

    def test_required_modules_bootstraps_legacy_openai(self) -> None:
        module = load_module("prompt_enhancer_entry_legacy_openai", "prompt_enhancer_entry.py")

        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": "legacy-openai"}, clear=True):
            with mock.patch.object(sys, "argv", ["prompt_enhancer_entry.py", "rewrite this prompt"]):
                self.assertEqual(module.required_modules(), ["openai"])


if __name__ == "__main__":
    unittest.main()
