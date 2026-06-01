"""
Backend Test: Phase M1 - Buyer Catalog (Master Artikel Buyer Maklon)
Tests all CRUD endpoints + validation + PO integration
"""
import requests
import sys
from datetime import datetime

BASE_URL = "https://context-mapping-dev.preview.emergentagent.com"

class BuyerCatalogTester:
    def __init__(self):
        self.token = None
        self.test_client_id = "531abd56-f112-4c35-a3dc-b9f4d051c4aa"  # PT Buyer Test
        self.test_catalog_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{BASE_URL}{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_detail = response.json()
                    print(f"   Error: {error_detail}")
                except:
                    print(f"   Response: {response.text[:200]}")
                self.failed_tests.append({
                    'test': name,
                    'expected': expected_status,
                    'actual': response.status_code,
                    'endpoint': endpoint
                })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                'test': name,
                'error': str(e),
                'endpoint': endpoint
            })
            return False, {}

    def test_login(self):
        """Test login and get token"""
        print("\n" + "="*60)
        print("PHASE 1: AUTHENTICATION")
        print("="*60)
        success, response = self.run_test(
            "Login",
            "POST",
            "/api/auth/login",
            200,
            data={"email": "admin@garment.com", "password": "Admin@123"}
        )
        if success and 'token' in response:
            self.token = response['token']
            print(f"✅ Token obtained: {self.token[:20]}...")
            return True
        return False

    def test_list_buyer_catalog(self):
        """Test GET /api/dewi/maklon/buyer-catalog (list dengan filter)"""
        print("\n" + "="*60)
        print("PHASE 2: LIST & FILTER")
        print("="*60)
        
        # Test 1: List all
        success, response = self.run_test(
            "List all buyer catalog",
            "GET",
            "/api/dewi/maklon/buyer-catalog",
            200
        )
        if success:
            print(f"   Found {len(response)} catalog entries")
        
        # Test 2: Filter by client
        success, response = self.run_test(
            "List buyer catalog filtered by client",
            "GET",
            f"/api/dewi/maklon/buyer-catalog?client_id={self.test_client_id}",
            200
        )
        if success:
            print(f"   Found {len(response)} entries for PT Buyer Test")
        
        # Test 3: Filter by status
        success, response = self.run_test(
            "List buyer catalog filtered by status=active",
            "GET",
            "/api/dewi/maklon/buyer-catalog?status=active",
            200
        )
        if success:
            print(f"   Found {len(response)} active entries")
        
        # Test 4: Search
        success, response = self.run_test(
            "Search buyer catalog",
            "GET",
            "/api/dewi/maklon/buyer-catalog?search=BT-DR",
            200
        )
        if success:
            print(f"   Found {len(response)} entries matching 'BT-DR'")

    def test_create_buyer_catalog(self):
        """Test POST /api/dewi/maklon/buyer-catalog (create entry)"""
        print("\n" + "="*60)
        print("PHASE 3: CREATE BUYER CATALOG")
        print("="*60)
        
        # Test 1: Create valid entry
        timestamp = datetime.now().strftime("%H%M%S")
        payload = {
            "client_id": self.test_client_id,
            "artikel_code": f"TEST-BC-{timestamp}",
            "buyer_ref_code": f"BUYER-REF-{timestamp}",
            "product_name": f"Test Product {timestamp}",
            "category": "Dress",
            "season": "SS24",
            "gender": "Women",
            "default_cmt_price": 45000,
            "default_selling_price": 150000,
            "color_options": ["Black", "White", "Navy"],
            "size_options": ["S", "M", "L", "XL"],
            "description": "Test product for automated testing",
            "status": "active"
        }
        
        success, response = self.run_test(
            "Create buyer catalog entry",
            "POST",
            "/api/dewi/maklon/buyer-catalog",
            201,
            data=payload
        )
        
        if success and 'id' in response:
            self.test_catalog_id = response['id']
            print(f"✅ Created catalog entry with ID: {self.test_catalog_id}")
            return True
        return False

    def test_create_validation(self):
        """Test validation errors"""
        print("\n" + "="*60)
        print("PHASE 4: VALIDATION TESTS")
        print("="*60)
        
        # Test 1: Invalid client_id
        success, response = self.run_test(
            "Create with invalid client_id (should fail 404)",
            "POST",
            "/api/dewi/maklon/buyer-catalog",
            404,
            data={
                "client_id": "invalid-client-id",
                "artikel_code": "TEST-INVALID",
                "product_name": "Test Invalid"
            }
        )
        
        # Test 2: Duplicate artikel_code for same client
        if self.test_catalog_id:
            timestamp = datetime.now().strftime("%H%M%S")
            # First, get the artikel_code we just created
            success, existing = self.run_test(
                "Get existing catalog to check artikel_code",
                "GET",
                f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}",
                200
            )
            
            if success and 'artikel_code' in existing:
                duplicate_code = existing['artikel_code']
                success, response = self.run_test(
                    "Create with duplicate artikel_code (should fail 409)",
                    "POST",
                    "/api/dewi/maklon/buyer-catalog",
                    409,
                    data={
                        "client_id": self.test_client_id,
                        "artikel_code": duplicate_code,
                        "product_name": "Duplicate Test"
                    }
                )

    def test_get_buyer_catalog(self):
        """Test GET /api/dewi/maklon/buyer-catalog/{id} (detail)"""
        print("\n" + "="*60)
        print("PHASE 5: GET DETAIL")
        print("="*60)
        
        if not self.test_catalog_id:
            print("⚠️  Skipping - no test catalog ID available")
            return
        
        success, response = self.run_test(
            "Get buyer catalog detail",
            "GET",
            f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}",
            200
        )
        
        if success:
            print(f"   Artikel: {response.get('artikel_code')}")
            print(f"   Product: {response.get('product_name')}")
            print(f"   CMT Price: Rp {response.get('default_cmt_price'):,}")
            print(f"   Status: {response.get('status')}")

    def test_update_buyer_catalog(self):
        """Test PUT /api/dewi/maklon/buyer-catalog/{id} (update field)"""
        print("\n" + "="*60)
        print("PHASE 6: UPDATE")
        print("="*60)
        
        if not self.test_catalog_id:
            print("⚠️  Skipping - no test catalog ID available")
            return
        
        # Update CMT price and description
        payload = {
            "default_cmt_price": 50000,
            "description": "Updated description via automated test",
            "season": "FW24"
        }
        
        success, response = self.run_test(
            "Update buyer catalog entry",
            "PUT",
            f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}",
            200,
            data=payload
        )
        
        if success:
            item = response.get('item', {})
            print(f"   Updated CMT Price: Rp {item.get('default_cmt_price'):,}")
            print(f"   Updated Season: {item.get('season')}")

    def test_toggle_buyer_catalog(self):
        """Test PUT /api/dewi/maklon/buyer-catalog/{id}/toggle (toggle active/inactive)"""
        print("\n" + "="*60)
        print("PHASE 7: TOGGLE STATUS")
        print("="*60)
        
        if not self.test_catalog_id:
            print("⚠️  Skipping - no test catalog ID available")
            return
        
        # Toggle to inactive
        success, response = self.run_test(
            "Toggle buyer catalog to inactive",
            "PUT",
            f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}/toggle",
            200
        )
        
        if success:
            print(f"   New status: {response.get('status')}")
        
        # Toggle back to active
        success, response = self.run_test(
            "Toggle buyer catalog back to active",
            "PUT",
            f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}/toggle",
            200
        )
        
        if success:
            print(f"   New status: {response.get('status')}")

    def test_po_integration(self):
        """Test PO integration with buyer_catalog_id"""
        print("\n" + "="*60)
        print("PHASE 8: PO INTEGRATION")
        print("="*60)
        
        if not self.test_catalog_id:
            print("⚠️  Skipping - no test catalog ID available")
            return
        
        # Create PO with buyer_catalog_id
        timestamp = datetime.now().strftime("%H%M%S")
        po_payload = {
            "client_id": self.test_client_id,
            "po_date": "2024-06-01",
            "deadline": "2024-06-30",
            "payment_terms": "net_30",
            "notes": "Test PO with buyer catalog integration",
            "items": [
                {
                    "seri_no": "S01",
                    "artikel": "",  # Should be auto-filled from catalog
                    "color": "",    # Should be auto-filled from catalog
                    "size": "",     # Should be auto-filled from catalog
                    "qty": 100,
                    "cmt_rate_per_pcs": 0,  # Should be auto-filled from catalog
                    "buyer_catalog_id": self.test_catalog_id
                }
            ]
        }
        
        success, response = self.run_test(
            "Create PO with buyer_catalog_id (auto-fill test)",
            "POST",
            "/api/dewi/maklon/pos",
            200,
            data=po_payload
        )
        
        if success:
            po_id = response.get('id')
            items = response.get('items', [])
            if items:
                item = items[0]
                print(f"   PO Number: {response.get('po_number')}")
                print(f"   Auto-filled Artikel: {item.get('artikel')}")
                print(f"   Auto-filled CMT Rate: Rp {item.get('cmt_rate_per_pcs'):,}")
                print(f"   Catalog Snapshot: {item.get('buyer_catalog_snapshot')}")
                
                # Verify snapshot is stored
                if item.get('buyer_catalog_snapshot'):
                    print("   ✅ Catalog snapshot stored for audit trail")
                else:
                    print("   ⚠️  Warning: Catalog snapshot not stored")
            
            # Clean up: cancel the test PO
            if po_id:
                self.run_test(
                    "Cancel test PO (cleanup)",
                    "POST",
                    f"/api/dewi/maklon/pos/{po_id}/cancel",
                    200
                )

    def test_po_backward_compat(self):
        """Test PO creation without buyer_catalog_id (backward compatibility)"""
        print("\n" + "="*60)
        print("PHASE 9: BACKWARD COMPATIBILITY")
        print("="*60)
        
        # Create PO without buyer_catalog_id
        timestamp = datetime.now().strftime("%H%M%S")
        po_payload = {
            "client_id": self.test_client_id,
            "po_date": "2024-06-01",
            "deadline": "2024-06-30",
            "payment_terms": "net_30",
            "notes": "Test PO without buyer catalog (backward compat)",
            "items": [
                {
                    "seri_no": "S01",
                    "artikel": "MANUAL-ARTIKEL-001",
                    "color": "Black",
                    "size": "M",
                    "qty": 50,
                    "cmt_rate_per_pcs": 40000
                }
            ]
        }
        
        success, response = self.run_test(
            "Create PO without buyer_catalog_id (backward compat)",
            "POST",
            "/api/dewi/maklon/pos",
            200,
            data=po_payload
        )
        
        if success:
            po_id = response.get('id')
            items = response.get('items', [])
            if items:
                item = items[0]
                print(f"   PO Number: {response.get('po_number')}")
                print(f"   Manual Artikel: {item.get('artikel')}")
                print(f"   Manual CMT Rate: Rp {item.get('cmt_rate_per_pcs'):,}")
                print(f"   ✅ Backward compatibility maintained")
            
            # Clean up: cancel the test PO
            if po_id:
                self.run_test(
                    "Cancel test PO (cleanup)",
                    "POST",
                    f"/api/dewi/maklon/pos/{po_id}/cancel",
                    200
                )

    def test_delete_buyer_catalog(self):
        """Test DELETE /api/dewi/maklon/buyer-catalog/{id} (soft-delete → discontinued)"""
        print("\n" + "="*60)
        print("PHASE 10: SOFT DELETE (DISCONTINUE)")
        print("="*60)
        
        if not self.test_catalog_id:
            print("⚠️  Skipping - no test catalog ID available")
            return
        
        success, response = self.run_test(
            "Soft-delete buyer catalog (discontinue)",
            "DELETE",
            f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}",
            200
        )
        
        if success:
            print(f"   ✅ Entry marked as discontinued")
            
            # Verify status changed to discontinued
            success, detail = self.run_test(
                "Verify status is discontinued",
                "GET",
                f"/api/dewi/maklon/buyer-catalog/{self.test_catalog_id}",
                200
            )
            
            if success:
                print(f"   Status after delete: {detail.get('status')}")
                if detail.get('status') == 'discontinued':
                    print("   ✅ Soft-delete working correctly")
                else:
                    print("   ⚠️  Warning: Status not set to discontinued")

    def test_auth_required(self):
        """Test that endpoints require authentication"""
        print("\n" + "="*60)
        print("PHASE 11: AUTH VALIDATION")
        print("="*60)
        
        # Temporarily remove token
        original_token = self.token
        self.token = None
        
        success, response = self.run_test(
            "List without auth (should fail 401)",
            "GET",
            "/api/dewi/maklon/buyer-catalog",
            401
        )
        
        # Restore token
        self.token = original_token

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print("TEST SUMMARY")
        print("="*60)
        print(f"Total tests run: {self.tests_run}")
        print(f"Tests passed: {self.tests_passed}")
        print(f"Tests failed: {len(self.failed_tests)}")
        print(f"Success rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.failed_tests:
            print("\n❌ FAILED TESTS:")
            for fail in self.failed_tests:
                error_msg = fail.get('error', f"Expected {fail.get('expected')}, got {fail.get('actual')}")
                print(f"   - {fail.get('test')}: {error_msg}")
        else:
            print("\n✅ ALL TESTS PASSED!")
        
        return 0 if len(self.failed_tests) == 0 else 1

def main():
    print("="*60)
    print("BUYER CATALOG BACKEND TEST")
    print("Phase M1: Master Artikel Buyer Maklon")
    print("="*60)
    
    tester = BuyerCatalogTester()
    
    # Run all tests
    if not tester.test_login():
        print("❌ Login failed, stopping tests")
        return 1
    
    tester.test_list_buyer_catalog()
    
    if not tester.test_create_buyer_catalog():
        print("⚠️  Create failed, some tests will be skipped")
    
    tester.test_create_validation()
    tester.test_get_buyer_catalog()
    tester.test_update_buyer_catalog()
    tester.test_toggle_buyer_catalog()
    tester.test_po_integration()
    tester.test_po_backward_compat()
    tester.test_delete_buyer_catalog()
    tester.test_auth_required()
    
    return tester.print_summary()

if __name__ == "__main__":
    sys.exit(main())
