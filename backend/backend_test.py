#!/usr/bin/env python3
"""
Backend API Test - Portal Aksesoris MVP (Session #11.21)
Tests health check, accessories dashboard, and accessories items endpoints
"""

import requests
import sys
from datetime import datetime

# Use public endpoint from frontend/.env
API_BASE = "https://compliance-check-dev-1.preview.emergentagent.com"

class AccessoriesAPITester:
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
        """Test 1: Health check endpoint"""
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
        """Test 2: Login with admin credentials"""
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

    def test_accessories_dashboard(self):
        """Test 3: GET /api/acc/dashboard"""
        if not self.token:
            self.log_result("Accessories Dashboard", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/acc/dashboard",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                # Check for expected KPI fields
                required_fields = ["total_items", "out_of_stock", "low_stock", 
                                 "pending_requests", "active_loans", "pending_pr"]
                missing = [f for f in required_fields if f not in data]
                
                if not missing:
                    self.log_result("Accessories Dashboard", True)
                    print(f"   📊 Dashboard KPIs: total_items={data.get('total_items')}, "
                          f"low_stock={data.get('low_stock')}, pending_requests={data.get('pending_requests')}")
                    return True
                else:
                    self.log_result("Accessories Dashboard", False, f"Missing fields: {missing}")
                    return False
            else:
                self.log_result("Accessories Dashboard", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Accessories Dashboard", False, str(e))
            return False

    def test_accessories_items(self):
        """Test 4: GET /api/acc/items"""
        if not self.token:
            self.log_result("Accessories Items", False, "No auth token")
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/api/acc/items",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Accessories Items", True)
                    print(f"   📦 Found {len(data)} accessory items")
                    return True
                else:
                    self.log_result("Accessories Items", False, f"Expected array, got {type(data)}")
                    return False
            else:
                self.log_result("Accessories Items", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_result("Accessories Items", False, str(e))
            return False

    def run_all_tests(self):
        """Run all backend tests"""
        print("=" * 70)
        print("🧪 Portal Aksesoris Backend API Tests")
        print(f"📍 Base URL: {self.base_url}")
        print(f"🕐 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)
        print()

        # Run tests in sequence
        self.test_health_check()
        
        if self.test_login():
            self.test_accessories_dashboard()
            self.test_accessories_items()
        else:
            print("\n⚠️  Login failed - skipping authenticated tests")

        # Print summary
        print()
        print("=" * 70)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        print("=" * 70)
        
        return 0 if self.tests_passed == self.tests_run else 1

def main():
    tester = AccessoriesAPITester()
    exit_code = tester.run_all_tests()
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
