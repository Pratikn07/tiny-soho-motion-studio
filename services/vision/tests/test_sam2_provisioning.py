from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class Sam2ProvisioningTests(unittest.TestCase):
    def test_checkpoint_spec_is_pinned_to_the_official_sam2_source(self) -> None:
        provisioning = importlib.import_module("services.vision.sam2_provisioning")

        spec = provisioning.checkpoint_spec()

        self.assertEqual(spec.model_id, "sam2.1_hiera_tiny")
        self.assertEqual(spec.source_commit, "2b90b9f5ceec907a1c18123530e92e794ad901a4")
        self.assertEqual(spec.checkpoint_license, "Apache-2.0")
        self.assertTrue(spec.checkpoint_url.startswith("https://dl.fbaipublicfiles.com/"))
        self.assertGreater(spec.expected_bytes, 100_000_000)

    def test_provisioning_rejects_checkpoint_paths_inside_the_repository(self) -> None:
        provisioning = importlib.import_module("services.vision.sam2_provisioning")

        with self.assertRaises(ValueError):
            provisioning.validate_destination(REPOSITORY_ROOT / "models" / "sam2.1_hiera_tiny.pt")

        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = Path(temporary_directory) / "sam2.1_hiera_tiny.pt"
            self.assertEqual(provisioning.validate_destination(destination), destination.resolve())
