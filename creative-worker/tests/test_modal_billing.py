import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('modal_billing', Path(__file__).parents[1] / 'src/modal_billing.py')
billing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(billing)

class BillingTests(unittest.TestCase):
    def test_official_sdk_uses_display_labels_for_adjustments(self):
        from decimal import Decimal
        self.assertEqual(billing.normalize_summary({
            'metered_cost': Decimal('0.54233468'), 'billed_cost': Decimal('0E-8'),
            'adjustments': {'Free Storage': Decimal('-0.19233468'), 'Credits': Decimal('-0.35000000')},
        }), {'usageUsd': 0.35, 'creditsAppliedUsd': 0.35, 'billedUsd': 0.0})

    def test_free_storage_is_not_misreported_as_credit_funded_usage(self):
        result = billing.normalize_summary({
            'metered_cost': '0.54233468', 'billed_cost': '0E-8',
            'adjustments': {'free_storage': '-0.19233468', 'credits': '-0.35'},
        })
        self.assertEqual(result, {'usageUsd': 0.35, 'creditsAppliedUsd': 0.35, 'billedUsd': 0.0})

    def test_partial_credit_coverage_keeps_real_billed_amount(self):
        self.assertEqual(billing.normalize_summary({
            'metered_cost': '35', 'billed_cost': '5', 'adjustments': {'credits': '-30'},
        }), {'usageUsd': 35.0, 'creditsAppliedUsd': 30.0, 'billedUsd': 5.0})

    def test_zero_usage_is_valid(self):
        self.assertEqual(billing.normalize_summary({
            'metered_cost': '0', 'billed_cost': '0', 'adjustments': {},
        }), {'usageUsd': 0.0, 'creditsAppliedUsd': 0.0, 'billedUsd': 0.0})

    def test_incomplete_and_nonfinite_data_is_unavailable_instead_of_fake_zero(self):
        for data in [{}, {'metered_cost': '0', 'billed_cost': 'NaN', 'adjustments': {}},
                     {'metered_cost': '0', 'billed_cost': '-1', 'adjustments': {}},
                     {'metered_cost': '2', 'billed_cost': '0', 'adjustments': {'credits': 'Infinity'}}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                billing.normalize_summary(data)

if __name__ == '__main__':
    unittest.main()
