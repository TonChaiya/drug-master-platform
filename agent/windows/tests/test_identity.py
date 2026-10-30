from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from tmt_agent.api import IssuedCredential
from tmt_agent.config import ConfigStore, MachineIdentityStore
from tmt_agent.single_instance import MUTEX_NAME


class MachineIdentityStoreTest(unittest.TestCase):
    def test_single_instance_mutex_is_machine_wide(self) -> None:
        self.assertTrue(MUTEX_NAME.startswith("Global\\"))

    def test_existing_machine_identity_wins_over_local_config(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "installation.json"
            existing = str(uuid.uuid4())
            path.write_text(json.dumps({"version": 1, "installationId": existing}), encoding="utf-8")

            resolved = MachineIdentityStore(path).resolve(str(uuid.uuid4()))

            self.assertEqual(resolved, existing)

    def test_local_config_identity_is_migrated_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "installation.json"
            legacy = str(uuid.uuid4())

            resolved = MachineIdentityStore(path).resolve(legacy)

            self.assertEqual(resolved, legacy)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["installationId"], legacy)

    def test_missing_identity_is_generated_once_and_reused(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            store = MachineIdentityStore(Path(folder) / "installation.json")

            first = store.resolve(None)
            second = store.resolve(None)

            self.assertEqual(second, first)
            uuid.UUID(first)

    def test_server_canonical_identity_can_replace_temporary_identity(self) -> None:
        canonical = str(uuid.uuid4())
        issued = IssuedCredential("key", "secret", "05957", canonical)

        self.assertEqual(issued.installation_id, canonical)

    def test_unreadable_user_secret_does_not_replace_machine_identity(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            installation_id = str(uuid.uuid4())
            identity = MachineIdentityStore(root / "installation.json")
            identity.replace(installation_id)
            config_path = root / "config.json"
            config_path.write_text(
                json.dumps({"installation_id": str(uuid.uuid4()), "secret_dpapi": "invalid"}),
                encoding="utf-8",
            )
            store = ConfigStore(config_path, identity)

            with patch("tmt_agent.config._crypt_unprotect", side_effect=ValueError("bad DPAPI")):
                with self.assertRaises(ValueError):
                    store.load()

            self.assertEqual(store.blank().installation_id, installation_id)


if __name__ == "__main__":
    unittest.main()
