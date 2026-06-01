#!/usr/bin/env python3
"""
Backend API Test - Phase B: 8 Frontend UI Modules
Tests all Phase B endpoints: Accruals, Asset Depreciation, Bad Debt Write-Off,
Asset Disposal, Purchase Discount, Employee Loans, Inventory Adjustments
"""

import requests
import sys
from datetime import datetime
import json

# Use public endpoint from frontend/.env
API_BASE = "https://context-mapping-dev.preview.emergentagent.com"

class PhaseBAPITester:
    def __init__(self):
        self.base_url = API_BASE
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

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

    def test_health_check(self):
        """Test 0: Health check endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    self.log_result("Health Check", True)
                    return True
                else:
                    self.log_result("Health Check", False, f"Unexpected status: {data.get('status')}")
                    return False
            else:
                self.log_result("Health Check", False, f"HTTP {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Health Check", False, str(e))
            return False

    def test_login(self):
        """Test 1: Login with admin credentials"""
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

    # ========== Module 1: Accruals ==========
    def test_accruals_list(self):
        """Test 2: GET /api/rahaza/finance/accruals"""
        if not self.token:
            self.log_result("Accruals - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/finance/accruals",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Accruals - List", True)
                    print(f"   📊 Found {len(data)} accrual entries")
                    return True
                else:
                    self.log_result("Accruals - List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Accruals - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Accruals - List", False, str(e))
            return False

    # ========== Module 2: Asset Depreciation ==========
    def test_asset_depreciation_due(self):
        """Test 3: GET /api/rahaza/finance/fixed-assets/depreciation-due"""
        if not self.token:
            self.log_result("Asset Depreciation - Due List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/finance/fixed-assets/depreciation-due",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Asset Depreciation - Due List", True)
                    print(f"   📊 Found {len(data)} assets due for depreciation")
                    return True
                else:
                    self.log_result("Asset Depreciation - Due List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Asset Depreciation - Due List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Asset Depreciation - Due List", False, str(e))
            return False

    def test_asset_list(self):
        """Test 4: GET /api/rahaza/finance/fixed-assets"""
        if not self.token:
            self.log_result("Fixed Assets - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/finance/fixed-assets",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Fixed Assets - List", True)
                    print(f"   📊 Found {len(data)} fixed assets")
                    return True
                else:
                    self.log_result("Fixed Assets - List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Fixed Assets - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Fixed Assets - List", False, str(e))
            return False

    # ========== Module 3: Bad Debt Write-Off ==========
    def test_ar_overdue_report(self):
        """Test 5: GET /api/rahaza/ar-invoices/overdue-report"""
        if not self.token:
            self.log_result("Bad Debt - Overdue Report", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/ar-invoices/overdue-report?days=30",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if "summary" in data and "invoices" in data:
                    self.log_result("Bad Debt - Overdue Report", True)
                    print(f"   📊 Overdue invoices: {data['summary'].get('total_overdue_invoices', 0)}")
                    return True
                else:
                    self.log_result("Bad Debt - Overdue Report", False, f"Missing expected fields")
                    return False
            else:
                self.log_result("Bad Debt - Overdue Report", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Bad Debt - Overdue Report", False, str(e))
            return False

    def test_ar_invoices_list(self):
        """Test 6: GET /api/rahaza/ar-invoices"""
        if not self.token:
            self.log_result("AR Invoices - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/ar-invoices",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("AR Invoices - List", True)
                    print(f"   📊 Found {len(data)} AR invoices")
                    return True
                else:
                    self.log_result("AR Invoices - List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("AR Invoices - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("AR Invoices - List", False, str(e))
            return False

    # ========== Module 4: Sales Discount (Marketing) ==========
    def test_marketing_discounts_list(self):
        """Test 7: GET /api/marketing/discounts"""
        if not self.token:
            self.log_result("Marketing Discounts - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/marketing/discounts",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                # Could be paginated or array
                if isinstance(data, (list, dict)):
                    self.log_result("Marketing Discounts - List", True)
                    if isinstance(data, list):
                        print(f"   📊 Found {len(data)} discount campaigns")
                    else:
                        print(f"   📊 Paginated response received")
                    return True
                else:
                    self.log_result("Marketing Discounts - List", False, f"Unexpected response type")
                    return False
            else:
                self.log_result("Marketing Discounts - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Marketing Discounts - List", False, str(e))
            return False

    # ========== Module 5: Asset Disposal ==========
    def test_active_assets_for_disposal(self):
        """Test 8: GET /api/rahaza/finance/fixed-assets?status=active"""
        if not self.token:
            self.log_result("Asset Disposal - Active Assets", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/finance/fixed-assets?status=active",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Asset Disposal - Active Assets", True)
                    print(f"   📊 Found {len(data)} active assets")
                    return True
                else:
                    self.log_result("Asset Disposal - Active Assets", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Asset Disposal - Active Assets", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Asset Disposal - Active Assets", False, str(e))
            return False

    # ========== Module 6: Purchase Discount (AP Payment) ==========
    def test_ap_invoices_list(self):
        """Test 9: GET /api/rahaza/ap-invoices"""
        if not self.token:
            self.log_result("AP Invoices - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/ap-invoices",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("AP Invoices - List", True)
                    print(f"   📊 Found {len(data)} AP invoices")
                    return True
                else:
                    self.log_result("AP Invoices - List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("AP Invoices - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("AP Invoices - List", False, str(e))
            return False

    # ========== Module 7: Employee Loans ==========
    def test_employee_loans_list(self):
        """Test 10: GET /api/rahaza/hr/employee-loans"""
        if not self.token:
            self.log_result("Employee Loans - List", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/hr/employee-loans",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Employee Loans - List", True)
                    print(f"   📊 Found {len(data)} employee loans")
                    return True
                else:
                    self.log_result("Employee Loans - List", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Employee Loans - List", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Employee Loans - List", False, str(e))
            return False

    # ========== Module 8: Inventory Adjustments ==========
    def test_material_stock_list(self):
        """Test 11: GET /api/rahaza/material-stock"""
        if not self.token:
            self.log_result("Inventory - Material Stock", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/material-stock",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Inventory - Material Stock", True)
                    print(f"   📊 Found {len(data)} material stock records")
                    return True
                else:
                    self.log_result("Inventory - Material Stock", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Inventory - Material Stock", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Inventory - Material Stock", False, str(e))
            return False

    def test_material_movements_list(self):
        """Test 12: GET /api/rahaza/material-movements"""
        if not self.token:
            self.log_result("Inventory - Material Movements", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/rahaza/material-movements",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Inventory - Material Movements", True)
                    print(f"   📊 Found {len(data)} material movements")
                    return True
                else:
                    self.log_result("Inventory - Material Movements", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Inventory - Material Movements", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Inventory - Material Movements", False, str(e))
            return False

    def run_all_tests(self):
        """Run all Phase B backend tests"""
        print("=" * 80)
        print("🧪 Phase B: 8 Frontend UI Modules - Backend API Tests")
        print(f"📍 Base URL: {self.base_url}")
        print(f"🕐 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        print()

        # Run tests in sequence
        self.test_health_check()
        
        if self.test_login():
            print("\n📦 Module 1: Accruals")
            self.test_accruals_list()
            
            print("\n📦 Module 2: Asset Depreciation")
            self.test_asset_depreciation_due()
            self.test_asset_list()
            
            print("\n📦 Module 3: Bad Debt Write-Off")
            self.test_ar_overdue_report()
            self.test_ar_invoices_list()
            
            print("\n📦 Module 4: Sales Discount (Marketing)")
            self.test_marketing_discounts_list()
            
            print("\n📦 Module 5: Asset Disposal")
            self.test_active_assets_for_disposal()
            
            print("\n📦 Module 6: Purchase Discount (AP Payment)")
            self.test_ap_invoices_list()
            
            print("\n📦 Module 7: Employee Loans")
            self.test_employee_loans_list()
            
            print("\n📦 Module 8: Inventory Adjustments")
            self.test_material_stock_list()
            self.test_material_movements_list()
        else:
            print("\n⚠️  Login failed - skipping authenticated tests")

        # Print summary
        print()
        print("=" * 80)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"✅ Success Rate: {success_rate:.1f}%")
        print("=" * 80)
        
        return 0 if self.tests_passed == self.tests_run else 1

def main():
    tester = PhaseBAPITester()
    exit_code = tester.run_all_tests()
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
