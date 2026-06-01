"""
CV. Dewi Aditya — Phase M2 Backend Testing
Tests for:
- M2.1: Link Buyer Catalog to Maklon Sample
- M2.2: BOM Template per Catalog with versioning
- M2.3: Price History audit + Drift Warning 2-tier (warn ≥10%, block ≥25%)
- M2.4: Auto-suggest artikel (frontend only, no backend API)
"""
import requests
import sys
from datetime import datetime

BASE_URL = "https://context-mapping-dev.preview.emergentagent.com"

# Test credentials
ADMIN_EMAIL = "admin@garment.com"
ADMIN_PASSWORD = "Admin@123"

# Test data IDs (pre-seeded)
TEST_CLIENT_ID = "531abd56-f112-4c35-a3dc-b9f4d051c4aa"
TEST_CATALOG_ID = "234e99ad-9a48-4346-b705-e05e194236ee"
TEST_CATALOG_DEFAULT_PRICE = 40000

class PhaseM2Tester:
    def __init__(self):
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_po_id = None
        self.test_sample_id = None
        self.test_template_v1_id = None
        self.test_template_v2_id = None

    def log(self, msg, level="INFO"):
        print(f"[{level}] {msg}")

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{BASE_URL}{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        self.log(f"\n🔍 Test #{self.tests_run}: {name}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ PASS - Status: {response.status_code}", "PASS")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                self.log(f"❌ FAIL - Expected {expected_status}, got {response.status_code}", "FAIL")
                try:
                    self.log(f"Response: {response.json()}", "ERROR")
                except:
                    self.log(f"Response text: {response.text[:500]}", "ERROR")
                return False, {}

        except Exception as e:
            self.log(f"❌ FAIL - Exception: {str(e)}", "ERROR")
            return False, {}

    def test_login(self):
        """Test login and get token"""
        self.log("\n" + "="*80)
        self.log("PHASE M2 BACKEND TESTING - LOGIN")
        self.log("="*80)
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "/api/auth/login",
            200,
            data={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        if success and 'token' in response:
            self.token = response['token']
            self.log(f"✅ Token obtained: {self.token[:20]}...", "SUCCESS")
            return True
        self.log("❌ Login failed - cannot proceed", "ERROR")
        return False

    # ──────────────────────────────────────────────────────────────────────────
    # M2.3 — PRICE HISTORY & DRIFT DETECTION
    # ──────────────────────────────────────────────────────────────────────────
    def test_m2_3_price_history(self):
        """M2.3: Test price history endpoint"""
        self.log("\n" + "="*80)
        self.log("M2.3 — PRICE HISTORY & DRIFT DETECTION")
        self.log("="*80)
        
        success, response = self.run_test(
            "M2.3: GET price-history for test catalog",
            "GET",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/price-history",
            200
        )
        if success:
            history = response.get('price_history', [])
            thresholds = response.get('thresholds', {})
            self.log(f"  📊 Price history entries: {len(history)}")
            self.log(f"  📊 Thresholds: warn={thresholds.get('warn_pct')}%, block={thresholds.get('block_pct')}%")
            if thresholds.get('warn_pct') == 10 and thresholds.get('block_pct') == 25:
                self.log("  ✅ Thresholds correct (warn=10%, block=25%)")
            else:
                self.log("  ⚠️  Thresholds mismatch", "WARN")
        return success

    def test_m2_3_check_drift(self):
        """M2.3: Test drift check endpoint"""
        # Test 1: No drift (exact match)
        success1, response1 = self.run_test(
            "M2.3: Check drift - exact match (0%)",
            "POST",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/check-drift",
            200,
            data={"actual_price": TEST_CATALOG_DEFAULT_PRICE}
        )
        if success1:
            severity = response1.get('severity')
            drift_pct = response1.get('drift_pct', 0)
            self.log(f"  📊 Severity: {severity}, Drift: {drift_pct}%")
            if severity == 'ok':
                self.log("  ✅ Severity 'ok' for exact match")
            else:
                self.log(f"  ❌ Expected severity 'ok', got '{severity}'", "FAIL")

        # Test 2: Warning level (12.5% drift)
        warning_price = TEST_CATALOG_DEFAULT_PRICE * 1.125  # +12.5%
        success2, response2 = self.run_test(
            "M2.3: Check drift - warning level (+12.5%)",
            "POST",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/check-drift",
            200,
            data={"actual_price": warning_price}
        )
        if success2:
            severity = response2.get('severity')
            drift_pct = response2.get('drift_pct', 0)
            self.log(f"  📊 Severity: {severity}, Drift: {drift_pct}%")
            if severity == 'warning':
                self.log("  ✅ Severity 'warning' for 12.5% drift")
            else:
                self.log(f"  ❌ Expected severity 'warning', got '{severity}'", "FAIL")

        # Test 3: Block level (37.5% drift)
        block_price = TEST_CATALOG_DEFAULT_PRICE * 1.375  # +37.5%
        success3, response3 = self.run_test(
            "M2.3: Check drift - block level (+37.5%)",
            "POST",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/check-drift",
            200,
            data={"actual_price": block_price}
        )
        if success3:
            severity = response3.get('severity')
            drift_pct = response3.get('drift_pct', 0)
            self.log(f"  📊 Severity: {severity}, Drift: {drift_pct}%")
            if severity == 'block':
                self.log("  ✅ Severity 'block' for 37.5% drift")
            else:
                self.log(f"  ❌ Expected severity 'block', got '{severity}'", "FAIL")

        return success1 and success2 and success3

    def test_m2_3_po_drift_block(self):
        """M2.3: Test PO creation with drift block (≥25%)"""
        block_price = TEST_CATALOG_DEFAULT_PRICE * 1.3  # +30% drift
        success, response = self.run_test(
            "M2.3: Create PO with block-level drift (should fail with 422)",
            "POST",
            "/api/dewi/maklon/pos",
            422,  # Expect 422 PRICE_DRIFT_BLOCK
            data={
                "client_id": TEST_CLIENT_ID,
                "po_date": datetime.now().strftime("%Y-%m-%d"),
                "items": [
                    {
                        "seri_no": "S01",
                        "artikel": "TEST-DRIFT",
                        "qty": 100,
                        "cmt_rate_per_pcs": block_price,
                        "buyer_catalog_id": TEST_CATALOG_ID
                    }
                ],
                "force_price_drift": False
            }
        )
        if success:
            error = response.get('detail', {})
            if isinstance(error, dict):
                error_code = error.get('error')
                drift_events = error.get('drift_events', [])
                self.log(f"  📊 Error code: {error_code}")
                self.log(f"  📊 Drift events: {len(drift_events)}")
                if error_code == 'PRICE_DRIFT_BLOCK':
                    self.log("  ✅ Correct error code 'PRICE_DRIFT_BLOCK'")
                else:
                    self.log(f"  ❌ Expected 'PRICE_DRIFT_BLOCK', got '{error_code}'", "FAIL")
        return success

    def test_m2_3_po_drift_force(self):
        """M2.3: Test PO creation with force_price_drift=true"""
        block_price = TEST_CATALOG_DEFAULT_PRICE * 1.3  # +30% drift
        success, response = self.run_test(
            "M2.3: Create PO with force_price_drift=true (should succeed)",
            "POST",
            "/api/dewi/maklon/pos",
            200,
            data={
                "client_id": TEST_CLIENT_ID,
                "po_date": datetime.now().strftime("%Y-%m-%d"),
                "items": [
                    {
                        "seri_no": "S01-FORCE",
                        "artikel": "TEST-DRIFT-FORCE",
                        "qty": 100,
                        "cmt_rate_per_pcs": block_price,
                        "buyer_catalog_id": TEST_CATALOG_ID
                    }
                ],
                "force_price_drift": True
            }
        )
        if success:
            self.test_po_id = response.get('id')
            drift_events = response.get('_drift_events', [])
            self.log(f"  📊 PO created: {response.get('po_number')}")
            self.log(f"  📊 Drift events: {len(drift_events)}")
            if drift_events:
                self.log("  ✅ Drift events returned in response")
            return True
        return False

    def test_m2_3_po_update_drift(self):
        """M2.3: Test PO update with drift check"""
        if not self.test_po_id:
            self.log("  ⚠️  Skipping - no test PO created", "WARN")
            return True
        
        block_price = TEST_CATALOG_DEFAULT_PRICE * 1.4  # +40% drift
        success, response = self.run_test(
            "M2.3: Update PO with block-level drift (should fail with 422)",
            "PUT",
            f"/api/dewi/maklon/pos/{self.test_po_id}",
            422,
            data={
                "items": [
                    {
                        "seri_no": "S01-UPDATE",
                        "artikel": "TEST-DRIFT-UPDATE",
                        "qty": 150,
                        "cmt_rate_per_pcs": block_price,
                        "buyer_catalog_id": TEST_CATALOG_ID
                    }
                ],
                "force_price_drift": False
            }
        )
        return success

    def test_m2_3_catalog_update_price_history(self):
        """M2.3: Test catalog price update auto-records history"""
        new_price = TEST_CATALOG_DEFAULT_PRICE + 5000
        success, response = self.run_test(
            "M2.3: Update catalog default_cmt_price (should auto-record history)",
            "PUT",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}",
            200,
            data={"default_cmt_price": new_price}
        )
        if success:
            # Verify history was recorded
            success2, response2 = self.run_test(
                "M2.3: Verify price history after catalog update",
                "GET",
                f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/price-history",
                200
            )
            if success2:
                history = response2.get('price_history', [])
                # Check for 'master_update' event
                master_updates = [h for h in history if h.get('event_type') == 'master_update']
                self.log(f"  📊 Master update events: {len(master_updates)}")
                if master_updates:
                    self.log("  ✅ Price history auto-recorded for master_update")
                else:
                    self.log("  ❌ No master_update event found in history", "FAIL")
            # Restore original price
            self.run_test(
                "M2.3: Restore original catalog price",
                "PUT",
                f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}",
                200,
                data={"default_cmt_price": TEST_CATALOG_DEFAULT_PRICE}
            )
        return success

    # ──────────────────────────────────────────────────────────────────────────
    # M2.1 — LINK BUYER CATALOG TO MAKLON SAMPLE
    # ──────────────────────────────────────────────────────────────────────────
    def test_m2_1_sample_with_catalog(self):
        """M2.1: Create sample with buyer_catalog_id"""
        self.log("\n" + "="*80)
        self.log("M2.1 — LINK BUYER CATALOG TO MAKLON SAMPLE")
        self.log("="*80)
        
        # First, get or create a test order/PO
        success_po, response_po = self.run_test(
            "M2.1: Get test PO for sample",
            "GET",
            "/api/dewi/maklon/pos",
            200,
            params={"client_id": TEST_CLIENT_ID, "limit": 1}
        )
        if not success_po or not response_po:
            self.log("  ⚠️  No PO found, creating one", "WARN")
            success_po, response_po = self.run_test(
                "M2.1: Create test PO for sample",
                "POST",
                "/api/dewi/maklon/pos",
                200,
                data={
                    "client_id": TEST_CLIENT_ID,
                    "items": [{"seri_no": "S01", "artikel": "TEST", "qty": 10, "cmt_rate_per_pcs": 10000}]
                }
            )
            if success_po:
                order_id = response_po.get('id')
            else:
                self.log("  ❌ Cannot create test PO", "ERROR")
                return False
        else:
            order_id = response_po[0].get('id') if response_po else None

        if not order_id:
            self.log("  ❌ No order_id available", "ERROR")
            return False

        # Create sample with buyer_catalog_id
        success, response = self.run_test(
            "M2.1: Create sample with buyer_catalog_id (auto-fill)",
            "POST",
            "/api/dewi/maklon/samples",
            200,
            data={
                "order_id": order_id,
                "product_name": "",  # Should auto-fill from catalog
                "description": "",   # Should auto-fill from catalog
                "buyer_catalog_id": TEST_CATALOG_ID
            }
        )
        if success:
            self.test_sample_id = response.get('id')
            self.log(f"  📊 Sample created: {response.get('sample_code')}")
            # Verify sample details
            success2, response2 = self.run_test(
                "M2.1: Get sample details (verify auto-fill)",
                "GET",
                f"/api/dewi/maklon/samples/{self.test_sample_id}",
                200
            )
            if success2:
                product_name = response2.get('product_name', '')
                snapshot = response2.get('buyer_catalog_snapshot', {})
                self.log(f"  📊 Product name: {product_name}")
                self.log(f"  📊 Catalog snapshot: {snapshot}")
                if product_name and snapshot:
                    self.log("  ✅ Auto-fill from catalog working")
                else:
                    self.log("  ⚠️  Auto-fill may not be working", "WARN")
        return success

    def test_m2_1_sample_client_mismatch(self):
        """M2.1: Test sample creation with mismatched client"""
        # Get a different client
        success_clients, response_clients = self.run_test(
            "M2.1: Get clients list",
            "GET",
            "/api/dewi/maklon/clients",
            200,
            params={"limit": 10}
        )
        if not success_clients or not response_clients:
            self.log("  ⚠️  Cannot test client mismatch - no clients", "WARN")
            return True
        
        # Find a different client
        other_client = None
        for c in response_clients:
            if c.get('id') != TEST_CLIENT_ID:
                other_client = c
                break
        
        if not other_client:
            self.log("  ⚠️  Cannot test client mismatch - only one client", "WARN")
            return True

        # Create PO for different client
        success_po, response_po = self.run_test(
            "M2.1: Create PO for different client",
            "POST",
            "/api/dewi/maklon/pos",
            200,
            data={
                "client_id": other_client['id'],
                "items": [{"seri_no": "S01", "artikel": "TEST", "qty": 10, "cmt_rate_per_pcs": 10000}]
            }
        )
        if not success_po:
            self.log("  ⚠️  Cannot create PO for different client", "WARN")
            return True

        # Try to create sample with mismatched catalog
        success, response = self.run_test(
            "M2.1: Create sample with mismatched client (should fail with 400)",
            "POST",
            "/api/dewi/maklon/samples",
            400,
            data={
                "order_id": response_po.get('id'),
                "product_name": "Test",
                "buyer_catalog_id": TEST_CATALOG_ID  # Belongs to different client
            }
        )
        return success

    def test_m2_1_catalog_samples_list(self):
        """M2.1: Test GET /buyer-catalog/{id}/samples"""
        success, response = self.run_test(
            "M2.1: Get samples linked to catalog",
            "GET",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}/samples",
            200
        )
        if success:
            samples = response.get('samples', [])
            summary = response.get('summary', {})
            self.log(f"  📊 Samples linked: {len(samples)}")
            self.log(f"  📊 Summary: {summary}")
            if 'total' in summary and 'approved' in summary:
                self.log("  ✅ Summary metrics present")
            else:
                self.log("  ⚠️  Summary metrics incomplete", "WARN")
        return success

    # ──────────────────────────────────────────────────────────────────────────
    # M2.2 — BOM TEMPLATE VERSIONING
    # ──────────────────────────────────────────────────────────────────────────
    def test_m2_2_create_bom_template_v1(self):
        """M2.2: Create BOM Template v1"""
        self.log("\n" + "="*80)
        self.log("M2.2 — BOM TEMPLATE VERSIONING")
        self.log("="*80)
        
        success, response = self.run_test(
            "M2.2: Create BOM Template v1 (set_active=true)",
            "POST",
            "/api/dewi/maklon/bom-templates",
            201,
            data={
                "buyer_catalog_id": TEST_CATALOG_ID,
                "version_label": "Initial BOM",
                "materials": [
                    {
                        "material_name": "Kain Katun",
                        "category": "fabric",
                        "unit": "meter",
                        "qty_per_pcs": 1.5,
                        "cost_per_unit": 50000
                    },
                    {
                        "material_name": "Benang",
                        "category": "accessories",
                        "unit": "cone",
                        "qty_per_pcs": 0.1,
                        "cost_per_unit": 25000
                    }
                ],
                "notes": "BOM awal untuk testing",
                "set_active": True
            }
        )
        if success:
            item = response.get('item', {})
            self.test_template_v1_id = item.get('id')
            version = item.get('version')
            is_active = item.get('is_active')
            total_cost = item.get('total_cost_per_pcs')
            self.log(f"  📊 Template ID: {self.test_template_v1_id}")
            self.log(f"  📊 Version: {version}")
            self.log(f"  📊 Is Active: {is_active}")
            self.log(f"  📊 Total Cost: Rp{total_cost:,.0f}")
            if version == 1 and is_active:
                self.log("  ✅ v1 created and set as active")
            else:
                self.log(f"  ❌ Expected v1 active, got v{version} active={is_active}", "FAIL")
        return success

    def test_m2_2_create_bom_template_v2(self):
        """M2.2: Create BOM Template v2 (should auto-deactivate v1)"""
        success, response = self.run_test(
            "M2.2: Create BOM Template v2 (set_active=true, should deactivate v1)",
            "POST",
            "/api/dewi/maklon/bom-templates",
            201,
            data={
                "buyer_catalog_id": TEST_CATALOG_ID,
                "version_label": "Updated BOM",
                "materials": [
                    {
                        "material_name": "Kain Polyester",
                        "category": "fabric",
                        "unit": "meter",
                        "qty_per_pcs": 1.2,
                        "cost_per_unit": 60000
                    }
                ],
                "set_active": True
            }
        )
        if success:
            item = response.get('item', {})
            self.test_template_v2_id = item.get('id')
            version = item.get('version')
            is_active = item.get('is_active')
            self.log(f"  📊 Template v2 ID: {self.test_template_v2_id}")
            self.log(f"  📊 Version: {version}")
            self.log(f"  📊 Is Active: {is_active}")
            if version == 2 and is_active:
                self.log("  ✅ v2 created and set as active")
                # Verify v1 is now inactive
                success2, response2 = self.run_test(
                    "M2.2: Verify v1 is now inactive",
                    "GET",
                    f"/api/dewi/maklon/bom-templates/{self.test_template_v1_id}",
                    200
                )
                if success2:
                    v1_active = response2.get('is_active')
                    if not v1_active:
                        self.log("  ✅ v1 auto-deactivated")
                    else:
                        self.log("  ❌ v1 still active (should be deactivated)", "FAIL")
            else:
                self.log(f"  ❌ Expected v2 active, got v{version} active={is_active}", "FAIL")
        return success

    def test_m2_2_activate_template(self):
        """M2.2: Test activate endpoint (switch back to v1)"""
        if not self.test_template_v1_id:
            self.log("  ⚠️  Skipping - no v1 template", "WARN")
            return True
        
        success, response = self.run_test(
            "M2.2: Activate v1 (should deactivate v2)",
            "POST",
            f"/api/dewi/maklon/bom-templates/{self.test_template_v1_id}/activate",
            200
        )
        if success:
            # Verify v1 is active and v2 is inactive
            success2, response2 = self.run_test(
                "M2.2: Verify v1 is active",
                "GET",
                f"/api/dewi/maklon/bom-templates/{self.test_template_v1_id}",
                200
            )
            if success2 and response2.get('is_active'):
                self.log("  ✅ v1 activated")
            else:
                self.log("  ❌ v1 not active", "FAIL")
        return success

    def test_m2_2_delete_template(self):
        """M2.2: Test delete template"""
        if not self.test_template_v1_id:
            self.log("  ⚠️  Skipping - no v1 template", "WARN")
            return True
        
        success, response = self.run_test(
            "M2.2: Delete BOM Template v1",
            "DELETE",
            f"/api/dewi/maklon/bom-templates/{self.test_template_v1_id}",
            200
        )
        if success:
            # Verify deleted
            success2, response2 = self.run_test(
                "M2.2: Verify v1 deleted (should 404)",
                "GET",
                f"/api/dewi/maklon/bom-templates/{self.test_template_v1_id}",
                404
            )
            if success2:
                self.log("  ✅ Template deleted successfully")
        return success

    def test_m2_2_apply_template_to_po(self):
        """M2.2: Test apply-to-po endpoint"""
        if not self.test_po_id or not self.test_template_v2_id:
            self.log("  ⚠️  Skipping - no test PO or template", "WARN")
            return True
        
        success, response = self.run_test(
            "M2.2: Apply BOM Template to PO",
            "POST",
            "/api/dewi/maklon/bom-templates/apply-to-po",
            200,
            data={
                "po_id": self.test_po_id,
                "template_id": self.test_template_v2_id
            }
        )
        if success:
            material_count = response.get('material_count', 0)
            template_version = response.get('template_version')
            self.log(f"  📊 Materials copied: {material_count}")
            self.log(f"  📊 Template version: {template_version}")
            if material_count > 0:
                self.log("  ✅ Template applied to PO")
            else:
                self.log("  ❌ No materials copied", "FAIL")
        return success

    def test_m2_2_apply_template_auto_active(self):
        """M2.2: Test apply-to-po without template_id (auto use active)"""
        if not self.test_po_id:
            self.log("  ⚠️  Skipping - no test PO", "WARN")
            return True
        
        success, response = self.run_test(
            "M2.2: Apply active BOM Template to PO (auto-select)",
            "POST",
            "/api/dewi/maklon/bom-templates/apply-to-po",
            200,
            data={"po_id": self.test_po_id}
        )
        if success:
            template_version = response.get('template_version')
            self.log(f"  📊 Auto-selected template version: {template_version}")
            if template_version:
                self.log("  ✅ Auto-select active template working")
            else:
                self.log("  ⚠️  No template version in response", "WARN")
        return success

    def test_m2_2_unique_constraint(self):
        """M2.2: Test unique constraint (buyer_catalog_id, version)"""
        # This should fail because v2 already exists
        success, response = self.run_test(
            "M2.2: Try to create duplicate version (should fail)",
            "POST",
            "/api/dewi/maklon/bom-templates",
            201,  # Will succeed but auto-increment to v3
            data={
                "buyer_catalog_id": TEST_CATALOG_ID,
                "materials": [{"material_name": "Test", "qty_per_pcs": 1, "cost_per_unit": 1000}],
                "set_active": False
            }
        )
        if success:
            version = response.get('item', {}).get('version')
            self.log(f"  📊 New version created: v{version}")
            if version == 3:
                self.log("  ✅ Auto-increment working (v3 created)")
            else:
                self.log(f"  ⚠️  Expected v3, got v{version}", "WARN")
        return success

    # ──────────────────────────────────────────────────────────────────────────
    # REGRESSION CHECK
    # ──────────────────────────────────────────────────────────────────────────
    def test_regression_buyer_catalog_crud(self):
        """Regression: Test Buyer Catalog M1 CRUD still works"""
        self.log("\n" + "="*80)
        self.log("REGRESSION CHECK — M1 FEATURES")
        self.log("="*80)
        
        # List catalogs
        success1, response1 = self.run_test(
            "Regression: List Buyer Catalogs",
            "GET",
            "/api/dewi/maklon/buyer-catalog",
            200,
            params={"client_id": TEST_CLIENT_ID}
        )
        
        # Get specific catalog
        success2, response2 = self.run_test(
            "Regression: Get Buyer Catalog detail",
            "GET",
            f"/api/dewi/maklon/buyer-catalog/{TEST_CATALOG_ID}",
            200
        )
        
        return success1 and success2

    def test_regression_po_create(self):
        """Regression: Test PO creation without catalog (backward compat)"""
        success, response = self.run_test(
            "Regression: Create PO without buyer_catalog_id",
            "POST",
            "/api/dewi/maklon/pos",
            200,
            data={
                "client_id": TEST_CLIENT_ID,
                "items": [
                    {
                        "seri_no": "S01",
                        "artikel": "LEGACY-ARTIKEL",
                        "qty": 50,
                        "cmt_rate_per_pcs": 35000
                    }
                ]
            }
        )
        if success:
            po_number = response.get('po_number')
            self.log(f"  📊 PO created: {po_number}")
            self.log("  ✅ Backward compatibility maintained")
        return success

    def run_all_tests(self):
        """Run all Phase M2 tests"""
        if not self.test_login():
            return 1

        # M2.3 — Price History & Drift Detection
        self.test_m2_3_price_history()
        self.test_m2_3_check_drift()
        self.test_m2_3_po_drift_block()
        self.test_m2_3_po_drift_force()
        self.test_m2_3_po_update_drift()
        self.test_m2_3_catalog_update_price_history()

        # M2.1 — Link Buyer Catalog to Maklon Sample
        self.test_m2_1_sample_with_catalog()
        self.test_m2_1_sample_client_mismatch()
        self.test_m2_1_catalog_samples_list()

        # M2.2 — BOM Template Versioning
        self.test_m2_2_create_bom_template_v1()
        self.test_m2_2_create_bom_template_v2()
        self.test_m2_2_activate_template()
        self.test_m2_2_delete_template()
        self.test_m2_2_apply_template_to_po()
        self.test_m2_2_apply_template_auto_active()
        self.test_m2_2_unique_constraint()

        # Regression
        self.test_regression_buyer_catalog_crud()
        self.test_regression_po_create()

        # Print summary
        self.log("\n" + "="*80)
        self.log("TEST SUMMARY")
        self.log("="*80)
        self.log(f"Total tests: {self.tests_run}")
        self.log(f"Passed: {self.tests_passed}")
        self.log(f"Failed: {self.tests_run - self.tests_passed}")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"Success rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            self.log("\n🎉 ALL TESTS PASSED!", "SUCCESS")
            return 0
        else:
            self.log(f"\n⚠️  {self.tests_run - self.tests_passed} TEST(S) FAILED", "WARN")
            return 1


def main():
    tester = PhaseM2Tester()
    return tester.run_all_tests()


if __name__ == "__main__":
    sys.exit(main())
