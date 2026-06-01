#!/usr/bin/env python3
"""
Phase 4 Feature Test - Employee Expense Management (EEM)
Tests Export, Bulk Actions, and GL Mapping Configuration

Features to test:
1. Export endpoints (Claims, Travel, Settlements) with date filters
2. Bulk approve (Claims, Travel, Settlements)
3. Bulk post GL (Settlements only)
4. GL Mapping CRUD operations
"""

import requests
import sys
import json
from datetime import datetime, timedelta

# Use public endpoint
API_BASE = "https://system-mapping-guide.preview.emergentagent.com"

class Phase4Tester:
    def __init__(self):
        self.base_url = API_BASE
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        # Test data IDs (will be populated during tests)
        self.test_claim_ids = []
        self.test_travel_ids = []
        self.test_settlement_ids = []
        self.test_mapping_id = None

    def log_result(self, test_name, passed, message=""):
        """Log test result"""
        self.tests_run += 1
        if passed:
            self.tests_passed += 1
            print(f"✅ PASS: {test_name}")
        else:
            print(f"❌ FAIL: {test_name} - {message}")
        
        self.test_results.append({
            "test": test_name,
            "passed": passed,
            "message": message
        })

    def test_login(self):
        """Test: Login with admin credentials"""
        print("\n🔐 Testing Login...")
        try:
            response = requests.post(
                f"{self.base_url}/api/auth/login",
                json={"email": "admin@garment.com", "password": "Admin@123"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if "token" in data:
                    self.token = data["token"]
                    self.log_result("Login", True)
                    return True
                else:
                    self.log_result("Login", False, "No token in response")
                    return False
            else:
                self.log_result("Login", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Login", False, str(e))
            return False

    # ========== EXPORT TESTS ==========
    
    def test_export_claims(self):
        """Test: Export Claims CSV with date filters"""
        print("\n📊 Testing Export Claims...")
        if not self.token:
            self.log_result("Export Claims", False, "No auth token")
            return False
        
        try:
            # Test with date range
            today = datetime.now().strftime('%Y-%m-%d')
            last_month = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            
            response = requests.get(
                f"{self.base_url}/api/hr/expenses/claims/export",
                params={
                    "from_date": last_month,
                    "to_date": today,
                    "status": "submitted,approved"
                },
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=15
            )
            
            if response.status_code == 200:
                # Check if response is CSV
                content_type = response.headers.get('Content-Type', '')
                if 'csv' in content_type.lower() or 'text/csv' in content_type:
                    # Check if filename is in headers
                    content_disp = response.headers.get('Content-Disposition', '')
                    if 'expense_claims_' in content_disp and '.csv' in content_disp:
                        self.log_result("Export Claims", True, f"CSV downloaded: {len(response.content)} bytes")
                        return True
                    else:
                        self.log_result("Export Claims", False, f"Invalid filename: {content_disp}")
                        return False
                else:
                    self.log_result("Export Claims", False, f"Not CSV: {content_type}")
                    return False
            else:
                self.log_result("Export Claims", False, f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            self.log_result("Export Claims", False, str(e))
            return False

    def test_export_travel(self):
        """Test: Export Travel Requests CSV"""
        print("\n📊 Testing Export Travel...")
        if not self.token:
            self.log_result("Export Travel", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/hr/expenses/travel/export",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=15
            )
            
            if response.status_code == 200:
                content_type = response.headers.get('Content-Type', '')
                if 'csv' in content_type.lower():
                    self.log_result("Export Travel", True, f"CSV downloaded: {len(response.content)} bytes")
                    return True
                else:
                    self.log_result("Export Travel", False, f"Not CSV: {content_type}")
                    return False
            else:
                self.log_result("Export Travel", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Export Travel", False, str(e))
            return False

    def test_export_settlements(self):
        """Test: Export Settlements CSV"""
        print("\n📊 Testing Export Settlements...")
        if not self.token:
            self.log_result("Export Settlements", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/hr/expenses/settlements/export",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=15
            )
            
            if response.status_code == 200:
                content_type = response.headers.get('Content-Type', '')
                if 'csv' in content_type.lower():
                    self.log_result("Export Settlements", True, f"CSV downloaded: {len(response.content)} bytes")
                    return True
                else:
                    self.log_result("Export Settlements", False, f"Not CSV: {content_type}")
                    return False
            else:
                self.log_result("Export Settlements", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Export Settlements", False, str(e))
            return False

    # ========== BULK APPROVE TESTS ==========
    
    def test_bulk_approve_claims(self):
        """Test: Bulk approve claims"""
        print("\n✅ Testing Bulk Approve Claims...")
        if not self.token:
            self.log_result("Bulk Approve Claims", False, "No auth token")
            return False
        
        try:
            # First, get submitted claims
            list_response = requests.get(
                f"{self.base_url}/api/hr/expenses/claims",
                params={"status": "submitted", "limit": 5},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if list_response.status_code != 200:
                self.log_result("Bulk Approve Claims", False, f"Failed to list claims: {list_response.status_code}")
                return False
            
            claims_data = list_response.json()
            submitted_claims = claims_data.get('items', [])
            
            if not submitted_claims:
                self.log_result("Bulk Approve Claims", True, "No submitted claims to test (OK)")
                return True
            
            # Get IDs of first 2 claims
            claim_ids = [c['id'] for c in submitted_claims[:2]]
            
            # Bulk approve
            response = requests.post(
                f"{self.base_url}/api/hr/expenses/claims/bulk-approve",
                json={
                    "claim_ids": claim_ids,
                    "approval_note": "Bulk approved via Phase 4 test"
                },
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok') and data.get('success_count', 0) > 0:
                    self.log_result("Bulk Approve Claims", True, 
                                  f"Approved {data['success_count']}/{data['total']} claims")
                    return True
                else:
                    self.log_result("Bulk Approve Claims", False, 
                                  f"No claims approved: {data}")
                    return False
            else:
                self.log_result("Bulk Approve Claims", False, 
                              f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            self.log_result("Bulk Approve Claims", False, str(e))
            return False

    def test_bulk_approve_travel(self):
        """Test: Bulk approve travel requests"""
        print("\n✅ Testing Bulk Approve Travel...")
        if not self.token:
            self.log_result("Bulk Approve Travel", False, "No auth token")
            return False
        
        try:
            # Get submitted travel requests
            list_response = requests.get(
                f"{self.base_url}/api/hr/expenses/travel",
                params={"status": "submitted", "limit": 5},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if list_response.status_code != 200:
                self.log_result("Bulk Approve Travel", False, f"Failed to list: {list_response.status_code}")
                return False
            
            travel_data = list_response.json()
            submitted_travel = travel_data.get('items', [])
            
            if not submitted_travel:
                self.log_result("Bulk Approve Travel", True, "No submitted travel to test (OK)")
                return True
            
            travel_ids = [t['id'] for t in submitted_travel[:2]]
            
            response = requests.post(
                f"{self.base_url}/api/hr/expenses/travel/bulk-approve",
                json={
                    "travel_ids": travel_ids,
                    "approval_note": "Bulk approved via Phase 4 test"
                },
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok'):
                    self.log_result("Bulk Approve Travel", True, 
                                  f"Approved {data['success_count']}/{data['total']} travel requests")
                    return True
                else:
                    self.log_result("Bulk Approve Travel", False, f"Failed: {data}")
                    return False
            else:
                self.log_result("Bulk Approve Travel", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Bulk Approve Travel", False, str(e))
            return False

    def test_bulk_approve_settlements(self):
        """Test: Bulk approve settlements"""
        print("\n✅ Testing Bulk Approve Settlements...")
        if not self.token:
            self.log_result("Bulk Approve Settlements", False, "No auth token")
            return False
        
        try:
            list_response = requests.get(
                f"{self.base_url}/api/hr/expenses/settlements",
                params={"status": "submitted", "limit": 5},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if list_response.status_code != 200:
                self.log_result("Bulk Approve Settlements", False, f"Failed to list: {list_response.status_code}")
                return False
            
            settlements_data = list_response.json()
            submitted_settlements = settlements_data.get('items', [])
            
            if not submitted_settlements:
                self.log_result("Bulk Approve Settlements", True, "No submitted settlements to test (OK)")
                return True
            
            settlement_ids = [s['id'] for s in submitted_settlements[:2]]
            
            response = requests.post(
                f"{self.base_url}/api/hr/expenses/settlements/bulk-approve",
                json={
                    "settlement_ids": settlement_ids,
                    "approval_note": "Bulk approved via Phase 4 test"
                },
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok'):
                    self.log_result("Bulk Approve Settlements", True, 
                                  f"Approved {data['success_count']}/{data['total']} settlements")
                    return True
                else:
                    self.log_result("Bulk Approve Settlements", False, f"Failed: {data}")
                    return False
            else:
                self.log_result("Bulk Approve Settlements", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Bulk Approve Settlements", False, str(e))
            return False

    def test_bulk_post_settlements(self):
        """Test: Bulk post GL for settlements"""
        print("\n💰 Testing Bulk Post GL Settlements...")
        if not self.token:
            self.log_result("Bulk Post Settlements", False, "No auth token")
            return False
        
        try:
            # Get approved settlements
            list_response = requests.get(
                f"{self.base_url}/api/hr/expenses/settlements",
                params={"status": "approved", "limit": 5},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if list_response.status_code != 200:
                self.log_result("Bulk Post Settlements", False, f"Failed to list: {list_response.status_code}")
                return False
            
            settlements_data = list_response.json()
            approved_settlements = settlements_data.get('items', [])
            
            if not approved_settlements:
                self.log_result("Bulk Post Settlements", True, "No approved settlements to test (OK)")
                return True
            
            settlement_ids = [s['id'] for s in approved_settlements[:2]]
            
            response = requests.post(
                f"{self.base_url}/api/hr/expenses/settlements/bulk-post",
                json={"settlement_ids": settlement_ids},
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=20
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok'):
                    self.log_result("Bulk Post Settlements", True, 
                                  f"Posted {data['success_count']}/{data['total']} settlements to GL")
                    return True
                else:
                    self.log_result("Bulk Post Settlements", False, f"Failed: {data}")
                    return False
            else:
                self.log_result("Bulk Post Settlements", False, f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            self.log_result("Bulk Post Settlements", False, str(e))
            return False

    # ========== GL MAPPING CRUD TESTS ==========
    
    def test_gl_mapping_list(self):
        """Test: List GL mappings"""
        print("\n📋 Testing GL Mapping List...")
        if not self.token:
            self.log_result("GL Mapping List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/hr/expenses/gl-mappings",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'items' in data and 'total' in data:
                    self.log_result("GL Mapping List", True, f"Found {data['total']} mappings")
                    return True
                else:
                    self.log_result("GL Mapping List", False, "Invalid response structure")
                    return False
            else:
                self.log_result("GL Mapping List", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("GL Mapping List", False, str(e))
            return False

    def test_gl_mapping_create(self):
        """Test: Create GL mapping"""
        print("\n➕ Testing GL Mapping Create...")
        if not self.token:
            self.log_result("GL Mapping Create", False, "No auth token")
            return False
        
        try:
            response = requests.post(
                f"{self.base_url}/api/hr/expenses/gl-mappings",
                json={
                    "category": "Test Category Phase4",
                    "gl_account_code": "6-3410",
                    "gl_account_name": "Biaya Transport Test",
                    "is_active": True
                },
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=10
            )
            
            if response.status_code == 201:
                data = response.json()
                if 'id' in data:
                    self.test_mapping_id = data['id']
                    self.log_result("GL Mapping Create", True, f"Created mapping ID: {self.test_mapping_id}")
                    return True
                else:
                    self.log_result("GL Mapping Create", False, "No ID in response")
                    return False
            else:
                self.log_result("GL Mapping Create", False, f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            self.log_result("GL Mapping Create", False, str(e))
            return False

    def test_gl_mapping_update(self):
        """Test: Update GL mapping"""
        print("\n✏️ Testing GL Mapping Update...")
        if not self.token:
            self.log_result("GL Mapping Update", False, "No auth token")
            return False
        
        if not self.test_mapping_id:
            self.log_result("GL Mapping Update", False, "No test mapping ID")
            return False
        
        try:
            response = requests.put(
                f"{self.base_url}/api/hr/expenses/gl-mappings/{self.test_mapping_id}",
                json={
                    "gl_account_name": "Biaya Transport Test (Updated)",
                    "is_active": False
                },
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('gl_account_name') == "Biaya Transport Test (Updated)":
                    self.log_result("GL Mapping Update", True, "Mapping updated successfully")
                    return True
                else:
                    self.log_result("GL Mapping Update", False, "Update not reflected")
                    return False
            else:
                self.log_result("GL Mapping Update", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("GL Mapping Update", False, str(e))
            return False

    def test_gl_mapping_delete(self):
        """Test: Delete GL mapping"""
        print("\n🗑️ Testing GL Mapping Delete...")
        if not self.token:
            self.log_result("GL Mapping Delete", False, "No auth token")
            return False
        
        if not self.test_mapping_id:
            self.log_result("GL Mapping Delete", False, "No test mapping ID")
            return False
        
        try:
            response = requests.delete(
                f"{self.base_url}/api/hr/expenses/gl-mappings/{self.test_mapping_id}",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok'):
                    self.log_result("GL Mapping Delete", True, "Mapping deleted successfully")
                    return True
                else:
                    self.log_result("GL Mapping Delete", False, "Delete not confirmed")
                    return False
            else:
                self.log_result("GL Mapping Delete", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("GL Mapping Delete", False, str(e))
            return False

    def run_all_tests(self):
        """Run all Phase 4 tests"""
        print("=" * 70)
        print("🚀 PHASE 4 FEATURE TESTING - Employee Expense Management")
        print("=" * 70)
        
        # Login first
        if not self.test_login():
            print("\n❌ Login failed. Cannot proceed with tests.")
            return False
        
        # Export tests
        print("\n" + "=" * 70)
        print("📊 EXPORT FUNCTIONALITY TESTS")
        print("=" * 70)
        self.test_export_claims()
        self.test_export_travel()
        self.test_export_settlements()
        
        # Bulk approve tests
        print("\n" + "=" * 70)
        print("✅ BULK APPROVE TESTS")
        print("=" * 70)
        self.test_bulk_approve_claims()
        self.test_bulk_approve_travel()
        self.test_bulk_approve_settlements()
        
        # Bulk post GL test
        print("\n" + "=" * 70)
        print("💰 BULK POST GL TEST")
        print("=" * 70)
        self.test_bulk_post_settlements()
        
        # GL Mapping CRUD tests
        print("\n" + "=" * 70)
        print("🗂️ GL MAPPING CRUD TESTS")
        print("=" * 70)
        self.test_gl_mapping_list()
        self.test_gl_mapping_create()
        self.test_gl_mapping_update()
        self.test_gl_mapping_delete()
        
        # Print summary
        print("\n" + "=" * 70)
        print("📊 TEST SUMMARY")
        print("=" * 70)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        # Print failed tests
        failed_tests = [r for r in self.test_results if not r['passed']]
        if failed_tests:
            print("\n❌ Failed Tests:")
            for test in failed_tests:
                print(f"  - {test['test']}: {test['message']}")
        
        return self.tests_passed == self.tests_run


def main():
    tester = Phase4Tester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
