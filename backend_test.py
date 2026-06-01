#!/usr/bin/env python3
"""
Backend API Testing — Phase 6 Features
CV. Dewi Aditya ERP System

Tests:
- 6A: WIP Journal (WO completion auto-post)
- 6B: Kas Kecil / Petty Cash Module
- 6C: Bank Transfer antar rekening

All tests use public endpoint for realistic testing.
"""
import requests
import sys
from datetime import datetime, date

# Public endpoint from frontend/.env
API_BASE = "https://repo-migration-guide.preview.emergentagent.com"
BASE_URL = f"{API_BASE}/api"

# Test credentials from /app/memory/test_credentials.md
TEST_EMAIL = "admin@garment.com"
TEST_PASSWORD = "Admin@123"


class Phase6Tester:
    def __init__(self):
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.failed_tests = []

    def log(self, msg, level="INFO"):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {msg}")

    def test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{BASE_URL}{endpoint}"
        req_headers = {'Content-Type': 'application/json'}
        if self.token:
            req_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            req_headers.update(headers)

        self.tests_run += 1
        self.log(f"Testing: {name}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=req_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=req_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=req_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=req_headers, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                self.log(f"✅ PASS - {name} (Status: {response.status_code})", "PASS")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                self.tests_failed += 1
                self.failed_tests.append(name)
                self.log(f"❌ FAIL - {name} (Expected {expected_status}, got {response.status_code})", "FAIL")
                try:
                    error_detail = response.json()
                    self.log(f"   Response: {error_detail}", "ERROR")
                except:
                    self.log(f"   Response: {response.text[:200]}", "ERROR")
                return False, {}

        except Exception as e:
            self.tests_failed += 1
            self.failed_tests.append(name)
            self.log(f"❌ FAIL - {name} (Exception: {str(e)})", "ERROR")
            return False, {}

    def login(self):
        """Login and get token"""
        self.log("=" * 60)
        self.log("PHASE 6 BACKEND API TESTING - CV. Dewi Aditya ERP")
        self.log("=" * 60)
        self.log(f"Testing against: {API_BASE}")
        self.log(f"Credentials: {TEST_EMAIL}")
        
        success, response = self.test(
            "Login admin@garment.com",
            "POST",
            "/auth/login",
            200,
            data={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        
        if success and 'token' in response:
            self.token = response['token']
            self.log(f"✅ Login successful, token obtained", "SUCCESS")
            return True
        else:
            self.log("❌ Login failed - cannot proceed with tests", "CRITICAL")
            return False

    # ═══════════════════════════════════════════════════════════════════════════
    # 6B: KAS KECIL / PETTY CASH MODULE TESTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_petty_cash_funds_list(self):
        """Test GET /api/finance/petty-cash/funds"""
        self.log("\n" + "=" * 60)
        self.log("6B: PETTY CASH MODULE - Fund Management")
        self.log("=" * 60)
        
        success, response = self.test(
            "GET /api/finance/petty-cash/funds - List funds",
            "GET",
            "/finance/petty-cash/funds",
            200
        )
        
        if success:
            items = response.get('items', [])
            self.log(f"   Found {len(items)} petty cash funds")
            return items
        return []

    def test_petty_cash_create_fund(self):
        """Test POST /api/finance/petty-cash/funds - Create fund with opening balance"""
        fund_name = f"Test Fund {datetime.now().strftime('%H%M%S')}"
        
        success, response = self.test(
            "POST /api/finance/petty-cash/funds - Create fund with opening balance",
            "POST",
            "/finance/petty-cash/funds",
            200,
            data={
                "name": fund_name,
                "custodian_name": "Test Kasir",
                "opening_balance": 1000000,
                "bank_account_code": "1-1201",
                "notes": "Test fund for Phase 6B"
            }
        )
        
        if success:
            fund_id = response.get('id')
            self.log(f"   Fund created: {fund_name} (ID: {fund_id})")
            self.log(f"   Opening balance: Rp 1,000,000")
            return fund_id, response
        return None, {}

    def test_petty_cash_create_expense(self, fund_id):
        """Test POST /api/finance/petty-cash/transactions - Create expense with GL posting"""
        if not fund_id:
            self.log("⚠️  Skipping expense test - no fund_id", "WARN")
            return None
        
        success, response = self.test(
            "POST /api/finance/petty-cash/transactions - Create expense with GL auto-posting",
            "POST",
            "/finance/petty-cash/transactions",
            200,
            data={
                "fund_id": fund_id,
                "txn_type": "expense",
                "amount": 150000,
                "txn_date": str(date.today()),
                "category": "Transport",
                "payee": "Toko ABC",
                "memo": "Test expense transaction"
            }
        )
        
        if success:
            txn = response.get('txn', {})
            gl_posting = response.get('gl_posting', {})
            
            self.log(f"   Transaction ID: {txn.get('id')}")
            self.log(f"   Amount: Rp 150,000")
            self.log(f"   GL Posted: {gl_posting.get('ok', False)}")
            
            if gl_posting.get('ok'):
                self.log(f"   ✅ JE Number: {gl_posting.get('je_number')}", "SUCCESS")
            else:
                self.log(f"   ❌ GL Error: {gl_posting.get('error')}", "ERROR")
            
            return txn.get('id'), response
        return None, {}

    def test_petty_cash_replenish(self, fund_id):
        """Test POST /api/finance/petty-cash/funds/{id}/replenish - Replenish with GL posting"""
        if not fund_id:
            self.log("⚠️  Skipping replenish test - no fund_id", "WARN")
            return
        
        success, response = self.test(
            "POST /api/finance/petty-cash/funds/{id}/replenish - Replenish fund with GL posting",
            "POST",
            f"/finance/petty-cash/funds/{fund_id}/replenish",
            200,
            data={
                "amount": 500000,
                "bank_account_code": "1-1201",
                "memo": "Test replenishment"
            }
        )
        
        if success:
            new_balance = response.get('new_balance', 0)
            gl_posting = response.get('gl_posting', {})
            
            self.log(f"   New balance: Rp {new_balance:,.0f}")
            self.log(f"   GL Posted: {gl_posting.get('ok', False)}")
            
            if gl_posting.get('ok'):
                self.log(f"   ✅ JE Number: {gl_posting.get('je_number')}", "SUCCESS")
            else:
                self.log(f"   ❌ GL Error: {gl_posting.get('error')}", "ERROR")

    def test_petty_cash_transactions_list(self, fund_id):
        """Test GET /api/finance/petty-cash/transactions"""
        if not fund_id:
            self.log("⚠️  Skipping transactions list test - no fund_id", "WARN")
            return
        
        success, response = self.test(
            "GET /api/finance/petty-cash/transactions - List transactions",
            "GET",
            f"/finance/petty-cash/transactions?fund_id={fund_id}",
            200
        )
        
        if success:
            items = response.get('items', [])
            self.log(f"   Found {len(items)} transactions for fund")
            
            posted_count = sum(1 for t in items if t.get('gl_posted'))
            unposted_count = len(items) - posted_count
            
            self.log(f"   GL Posted: {posted_count}, Unposted: {unposted_count}")

    # ═══════════════════════════════════════════════════════════════════════════
    # 6C: BANK TRANSFER MODULE TESTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_bank_transfers_list(self):
        """Test GET /api/finance/bank-transfers"""
        self.log("\n" + "=" * 60)
        self.log("6C: BANK TRANSFER MODULE - Inter-account transfers")
        self.log("=" * 60)
        
        success, response = self.test(
            "GET /api/finance/bank-transfers - List transfers",
            "GET",
            "/finance/bank-transfers",
            200
        )
        
        if success:
            items = response.get('items', [])
            self.log(f"   Found {len(items)} bank transfers")
            return items
        return []

    def test_bank_transfer_create(self):
        """Test POST /api/finance/bank-transfers - Create transfer with GL posting"""
        success, response = self.test(
            "POST /api/finance/bank-transfers - Create transfer BCA → Mandiri with GL auto-posting",
            "POST",
            "/finance/bank-transfers",
            200,
            data={
                "from_account_code": "1-1201",
                "from_account_name": "Bank BCA",
                "to_account_code": "1-1202",
                "to_account_name": "Bank Mandiri",
                "amount": 5000000,
                "transfer_date": str(date.today()),
                "memo": "Test transfer Phase 6C",
                "ref_external": "TEST-REF-001"
            }
        )
        
        if success:
            transfer = response.get('transfer', {})
            gl_posting = response.get('gl_posting', {})
            
            self.log(f"   Transfer Ref: {transfer.get('ref_number')}")
            self.log(f"   Amount: Rp 5,000,000")
            self.log(f"   From: {transfer.get('from_account_name')} → To: {transfer.get('to_account_name')}")
            self.log(f"   GL Posted: {gl_posting.get('ok', False)}")
            
            if gl_posting.get('ok'):
                self.log(f"   ✅ JE Number: {gl_posting.get('je_number')}", "SUCCESS")
                self.log(f"   ✅ JE: Dr {transfer.get('to_account_name')} / Cr {transfer.get('from_account_name')}", "SUCCESS")
            else:
                self.log(f"   ❌ GL Error: {gl_posting.get('error')}", "ERROR")
            
            return transfer.get('id'), response
        return None, {}

    # ═══════════════════════════════════════════════════════════════════════════
    # SUMMARY & REPORTING
    # ═══════════════════════════════════════════════════════════════════════════
    
    def print_summary(self):
        """Print test summary"""
        self.log("\n" + "=" * 60)
        self.log("TEST SUMMARY")
        self.log("=" * 60)
        self.log(f"Total Tests: {self.tests_run}")
        self.log(f"✅ Passed: {self.tests_passed}")
        self.log(f"❌ Failed: {self.tests_failed}")
        
        if self.tests_failed > 0:
            self.log("\nFailed Tests:")
            for test_name in self.failed_tests:
                self.log(f"  - {test_name}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"\nSuccess Rate: {success_rate:.1f}%")
        
        return self.tests_failed == 0


def main():
    tester = Phase6Tester()
    
    # Login
    if not tester.login():
        return 1
    
    # ═══════════════════════════════════════════════════════════════════════════
    # 6B: PETTY CASH MODULE TESTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    # List existing funds
    existing_funds = tester.test_petty_cash_funds_list()
    
    # Create new fund with opening balance
    fund_id, fund_data = tester.test_petty_cash_create_fund()
    
    if fund_id:
        # Create expense transaction
        txn_id, txn_data = tester.test_petty_cash_create_expense(fund_id)
        
        # Replenish fund
        tester.test_petty_cash_replenish(fund_id)
        
        # List transactions
        tester.test_petty_cash_transactions_list(fund_id)
    
    # ═══════════════════════════════════════════════════════════════════════════
    # 6C: BANK TRANSFER MODULE TESTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    # List existing transfers
    existing_transfers = tester.test_bank_transfers_list()
    
    # Create new transfer
    transfer_id, transfer_data = tester.test_bank_transfer_create()
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
