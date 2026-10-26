"""Run the deployment script against disposable releases, doubling only external commands."""

import io
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "remote-deploy.sh"
REVISION = "a" * 40
PREVIOUS_REVISION = "b" * 40


class DeploymentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "installation"
        self.bin = Path(self.temp.name) / "bin"
        self.bin.mkdir()
        for path in [
            "deploy",
            "backend/data/processed",
            "backend/data/raw",
            "incoming",
        ]:
            (self.root / path).mkdir(parents=True, exist_ok=True)
        (self.root / "deploy/.env").write_text("DOMAIN=demo.example.com\n")
        (self.root / "backend/data/processed/network_nodes.parquet").write_bytes(
            b"original data"
        )
        (self.root / "backend/data/raw/MANIFEST.json").write_text("original manifest")
        (self.root / "compose.production.yaml").write_text("name: greenwave\n")
        self.state = Path(self.temp.name) / "active"
        self.state.write_text(str(self.root))
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "DEPLOY_TEST_STATE": str(self.state),
            "DEPLOY_TEST_ROOT": str(self.root),
        }
        self.executable("sudo", '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n')
        self.executable(
            "curl", '#!/bin/sh\nprintf "%s" "${DEPLOY_TEST_HTTP_STATUS:-401}"\n'
        )
        self.executable("flock", '#!/bin/sh\nexit "${DEPLOY_TEST_LOCK_FAILURE:-0}"\n')
        self.executable(
            "docker",
            """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
state = pathlib.Path(os.environ['DEPLOY_TEST_STATE'])
if args[0] == 'inspect':
    print(state.read_text())
    sys.exit(0)
directory = args[args.index('--project-directory') + 1]
if 'config' in args:
    if '--format' in args:
        print(json.dumps({'services': {'proxy': {'environment': {'DOMAIN': 'demo.example.com'}}}}))
elif 'build' in args:
    sys.exit(int(os.environ.get('DEPLOY_TEST_BUILD_FAILURE', '0')))
elif 'run' in args:
    if os.environ.get('DEPLOY_TEST_DRAIN_STDIN'):
        sys.stdin.read()
    nodes = pathlib.Path(os.environ['DEPLOY_TEST_ROOT']) / 'backend/data/processed/network_nodes.parquet'
    sys.exit(0 if nodes.exists() else 1)
elif 'up' in args:
    if os.environ.get('DEPLOY_TEST_ROLLBACK_FAILURE') and directory == os.environ['DEPLOY_TEST_ROOT']:
        sys.exit(1)
    if os.environ.get('DEPLOY_TEST_ACTIVATION_FAILURE') and directory.endswith('/' + 'a' * 40):
        state.write_text(directory)
        sys.exit(1)
    state.write_text(directory)
""",
        )
        self.archive(REVISION)

    def executable(self, name: str, source: str) -> None:
        path = self.bin / name
        path.write_text(source)
        path.chmod(0o755)

    def archive(self, revision: str) -> None:
        with tarfile.open(
            self.root / "incoming" / f"{revision}.tar.gz", "w:gz"
        ) as archive:
            for name, data in {
                "compose.production.yaml": b"name: greenwave\n",
                "backend/data/processed/.gitkeep": b"",
                "backend/data/raw/MANIFEST.json": b"archive manifest must not replace live manifest",
                "deploy/Caddyfile": b"demo.example.com {}\n",
            }.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

    def deploy(self, **env: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), str(self.root), REVISION],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_success_activates_revision_and_preserves_live_configuration_and_data(
        self,
    ) -> None:
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        release = self.root / "releases" / REVISION
        self.assertEqual((self.root / "current").resolve(), release)
        self.assertEqual(self.state.read_text(), str(release))
        self.assertEqual(
            (release / "backend/data/processed").resolve(),
            self.root / "backend/data/processed",
        )
        self.assertEqual(
            (release / "backend/data/raw/MANIFEST.json").read_text(),
            "original manifest",
        )
        self.assertEqual((release / "deploy/.env").resolve(), self.root / "deploy/.env")
        self.assertIn(
            f"greenwave-backend:{REVISION}", (release / "deploy/images.env").read_text()
        )

    def test_build_failure_leaves_current_service_untouched(self) -> None:
        result = self.deploy(DEPLOY_TEST_BUILD_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))
        self.assertFalse((self.root / "current").exists())
        self.assertTrue((self.root / "releases" / REVISION / ".revision").exists())

    def test_archive_permissions_remain_readable_to_nonroot_image_users(self) -> None:
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        source = self.root / "releases" / REVISION / "deploy/Caddyfile"
        self.assertEqual(source.stat().st_mode & 0o444, 0o444)

    def test_partial_activation_failure_restores_previous_compose_release(self) -> None:
        result = self.deploy(DEPLOY_TEST_ACTIVATION_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))
        self.assertIn("Rollback restored", result.stderr)

    def test_missing_configuration_fails_before_build_or_activation(self) -> None:
        (self.root / "deploy/.env").unlink()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("deploy/.env", result.stderr)
        self.assertEqual(self.state.read_text(), str(self.root))
        self.assertFalse((self.root / "releases").exists())

    def test_same_revision_can_be_redeployed(self) -> None:
        first = self.deploy()
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self.deploy(DEPLOY_TEST_BUILD_FAILURE="1")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(
            (self.root / "current").resolve(), self.root / "releases" / REVISION
        )

    def test_https_authentication_failure_rolls_back(self) -> None:
        result = self.deploy(DEPLOY_TEST_HTTP_STATUS="200")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))
        self.assertIn("Rollback restored", result.stderr)

    def test_failure_restores_a_previous_automated_release(self) -> None:
        previous = self.root / "releases" / PREVIOUS_REVISION
        (previous / "deploy").mkdir(parents=True)
        (previous / "compose.production.yaml").write_text("name: greenwave\n")
        (previous / "deploy/.env").symlink_to(self.root / "deploy/.env")
        (previous / "deploy/images.env").write_text(
            f"GREENWAVE_BACKEND_IMAGE=greenwave-backend:{PREVIOUS_REVISION}\n"
        )
        self.state.write_text(str(previous))
        result = self.deploy(DEPLOY_TEST_ACTIVATION_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(previous))
        self.assertEqual((self.root / "current").resolve(), previous)
        self.assertIn(PREVIOUS_REVISION, (previous / "deploy/images.env").read_text())

    def test_failed_rollback_remains_a_failed_deployment_with_explicit_diagnostics(
        self,
    ):
        result = self.deploy(
            DEPLOY_TEST_ACTIVATION_FAILURE="1", DEPLOY_TEST_ROLLBACK_FAILURE="1"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ROLLBACK FAILED", result.stderr)

    def test_retry_after_failed_rollback_cannot_report_unhealthy_release_as_success(
        self,
    ) -> None:
        first = self.deploy(
            DEPLOY_TEST_ACTIVATION_FAILURE="1", DEPLOY_TEST_ROLLBACK_FAILURE="1"
        )
        self.assertNotEqual(first.returncode, 0)
        retry = self.deploy(DEPLOY_TEST_ACTIVATION_FAILURE="1")
        self.assertNotEqual(retry.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))

    def test_missing_artifact_leaves_old_inmemory_service_untouched(self) -> None:
        (self.root / "backend/data/processed/network_nodes.parquet").unlink()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))

    def test_already_active_but_unhealthy_revision_is_not_reported_successful(
        self,
    ) -> None:
        first = self.deploy()
        self.assertEqual(first.returncode, 0, first.stderr)
        retry = self.deploy(DEPLOY_TEST_ACTIVATION_FAILURE="1")
        self.assertNotEqual(retry.returncode, 0)

    def test_missing_dataset_directory_does_not_modify_active_service(self) -> None:
        (self.root / "backend/data/processed/network_nodes.parquet").unlink()
        (self.root / "backend/data/processed").rmdir()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("backend/data/processed", result.stderr)
        self.assertEqual(self.state.read_text(), str(self.root))

    def test_malformed_revision_is_rejected(self) -> None:
        result = subprocess.run(
            ["bash", str(SCRIPT), str(self.root), "../../bad"],
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.state.read_text(), str(self.root))

    def test_competing_deployment_fails_without_changing_running_service(self) -> None:
        result = self.deploy(DEPLOY_TEST_LOCK_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))

    def test_streamed_ssh_script_reaches_activation_when_preflight_reads_stdin(
        self,
    ) -> None:
        result = subprocess.run(
            ["bash", "-s", "--", str(self.root), REVISION],
            input=SCRIPT.read_text(),
            env={**self.env, "DEPLOY_TEST_DRAIN_STDIN": "1"},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state.read_text(), str(self.root / "releases" / REVISION))
        self.assertEqual(
            (self.root / "current").resolve(), self.root / "releases" / REVISION
        )
        self.assertIn("Deployed", result.stdout)

    def test_streamed_ssh_script_propagates_activation_failure_and_rolls_back(
        self,
    ) -> None:
        result = subprocess.run(
            ["bash", "-s", "--", str(self.root), REVISION],
            input=SCRIPT.read_text(),
            env={
                **self.env,
                "DEPLOY_TEST_DRAIN_STDIN": "1",
                "DEPLOY_TEST_ACTIVATION_FAILURE": "1",
            },
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state.read_text(), str(self.root))
        self.assertIn("Rollback restored", result.stderr)


if __name__ == "__main__":
    unittest.main()
