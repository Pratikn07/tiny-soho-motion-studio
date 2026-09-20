from __future__ import annotations

import importlib
import ssl
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class PaddleProvisioningTests(unittest.TestCase):
    def test_mobile_model_specs_are_pinned_to_official_paddle_revisions(self) -> None:
        provisioning = importlib.import_module("services.vision.paddle_provisioning")

        specs = provisioning.mobile_model_specs()

        self.assertEqual([spec.model_id for spec in specs], ["PP-OCRv5_mobile_det", "en_PP-OCRv5_mobile_rec"])
        for spec in specs:
            self.assertEqual(len(spec.revision), 40)
            self.assertTrue(spec.source_repository.startswith("https://huggingface.co/PaddlePaddle/"))
            self.assertEqual(spec.model_license, "Apache-2.0")

    def test_provisioning_rejects_a_destination_inside_the_repository(self) -> None:
        provisioning = importlib.import_module("services.vision.paddle_provisioning")

        with self.assertRaises(ValueError):
            provisioning.validate_destination(REPOSITORY_ROOT / "models")

        with tempfile.TemporaryDirectory() as temporary_directory:
            self.assertEqual(provisioning.validate_destination(Path(temporary_directory)), Path(temporary_directory).resolve())

    def test_provisioning_keeps_certificate_and_hostname_validation_enabled(self) -> None:
        provisioning = importlib.import_module("services.vision.paddle_provisioning")

        context = provisioning.trusted_ssl_context()

        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
