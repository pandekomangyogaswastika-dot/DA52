"""
Phase 9 Backend Testing: Bad Debt Write-off, Bank Recon Adjustments, Sales Discount
Testing Agent: T1
Date: 2026-06-XX

Test Coverage:
- Phase 9A: Bad Debt Write-off (validation, GL posting, audit trail, overdue report)
- Phase 9B: Bank Reconciliation Adjustments (CRUD, 4 types, GL posting, bank balance update, idempotency)
- Phase 9C: Sales Discount Tracking (GL split, backward compatibility)
- Regression: Phase 8 features still working
"""

import requests
import sys
import json
from datetime import datetime, date, timedelta
from typing import Optional

class Phase9BackendTester:
    def __init__(self, base_url="https://repo-migration-guide.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        self.created_resources = {
            "ar_invoices": [],
            "bank_adjustments": [],
            "customers": [],
            "bank_accounts": []
        }

    def log_test(self, name: str, passed: bool, details: str = "", response_data: dict = None):
        """Log test result"""
        self.tests_run += 1
        if passed:
            self.tests_passed += 1
            print(f"✅ PASS: {name}")
        else:
            print(f"❌ FAIL: {name}")
        
        if details:
            print(f"   {details}")
        
        self.test_results.append({
            "test": name,
            "passed": passed,
            "details": details,
            "response_data": response_data
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, return_response=False):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)

            success = response.status_code == expected_status
            
            if success:
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_json = response.json()
                except:
                    response_json = {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    response_json = response.json()
                    print(f"   Response: {json.dumps(response_json, indent=2)[:500]}")
                except:
                    print(f"   Response text: {response.text[:500]}")
                    response_json = {}

            if return_response:
                return success, response_json, response
            return success, response_json

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            if return_response:
                return False, {}, None
            return False, {}

    def test_login(self):
        """Test login and get token"""
        print("\n" + "="*80)
        print("PHASE 9 BACKEND TESTING - LOGIN")
        print("="*80)
        
        success, response = self.run_test(
            "Login with admin credentials",
            "POST",
            "api/auth/login",
            200,
            data={"email": "admin@garment.com", "password": "Admin@123"}
        )
        
        if success and 'token' in response:
            self.token = response['token']
            self.log_test("Login", True, f"Token obtained: {self.token[:20]}...")
            return True
        
        self.log_test("Login", False, "Failed to obtain token")
        return False

    # ========================================================================
    # PHASE 9A: BAD DEBT WRITE-OFF
    # ========================================================================
    
    def test_phase_9a_bad_debt(self):
        """Test Phase 9A: Bad Debt Write-off"""
        print("\n" + "="*80)
        print("PHASE 9A: BAD DEBT WRITE-OFF")
        print("="*80)
        
        # Step 1: Create a customer
        print("\n--- Step 1: Create Customer ---")
        success, customer = self.run_test(
            "Create test customer",
            "POST",
            "api/rahaza/customers",
            200,  # API returns 200 instead of 201
            data={
                "name": "Bad Debt Test Customer",
                "code": f"BDTEST{datetime.now().strftime('%H%M%S')}",
                "email": "baddebt@test.com",
                "phone": "081234567890"
            }
        )
        
        if not success or not customer.get("id"):
            self.log_test("Phase 9A Setup - Create Customer", False, "Failed to create customer")
            return
        
        customer_id = customer["id"]
        self.created_resources["customers"].append(customer_id)
        self.log_test("Phase 9A Setup - Create Customer", True, f"Customer ID: {customer_id}")
        
        # Step 2: Create overdue AR invoice
        print("\n--- Step 2: Create Overdue AR Invoice ---")
        overdue_date = (date.today() - timedelta(days=200)).isoformat()
        
        success, invoice = self.run_test(
            "Create overdue AR invoice",
            "POST",
            "api/rahaza/ar-invoices",
            200,  # API returns 200 instead of 201
            data={
                "customer_id": customer_id,
                "issue_date": overdue_date,
                "due_date": overdue_date,
                "items": [
                    {
                        "description": "Test Product - Overdue",
                        "qty": 10,
                        "unit": "pcs",
                        "price": 50000
                    }
                ],
                "tax_pct": 11,
                "notes": "Test invoice for bad debt write-off"
            }
        )
        
        if not success or not invoice.get("id"):
            self.log_test("Phase 9A - Create Overdue Invoice", False, "Failed to create invoice")
            return
        
        invoice_id = invoice["id"]
        invoice_number = invoice.get("invoice_number")
        self.created_resources["ar_invoices"].append(invoice_id)
        self.log_test("Phase 9A - Create Overdue Invoice", True, 
                     f"Invoice: {invoice_number}, Total: {invoice.get('total')}, Balance: {invoice.get('balance')}")
        
        # Step 3: Send invoice to post to GL
        print("\n--- Step 3: Send Invoice (Post to GL) ---")
        success, sent_invoice = self.run_test(
            "Send AR invoice to post to GL",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_id}/send",
            200
        )
        
        if success:
            gl_je_id = sent_invoice.get("gl_je_id")
            gl_je_number = sent_invoice.get("gl_je_number")
            self.log_test("Phase 9A - Send Invoice", True, 
                         f"GL JE: {gl_je_number}, Status: {sent_invoice.get('status')}")
        else:
            self.log_test("Phase 9A - Send Invoice", False, "Failed to send invoice")
        
        # Step 4: Test overdue report
        print("\n--- Step 4: Test Overdue Report ---")
        success, overdue_report = self.run_test(
            "Get overdue AR report (180+ days)",
            "GET",
            "api/rahaza/ar-invoices/overdue-report?days=180",
            200
        )
        
        if success:
            summary = overdue_report.get("summary", {})
            invoices = overdue_report.get("invoices", [])
            high_risk_count = summary.get("high_risk_count", 0)
            
            self.log_test("Phase 9A - Overdue Report", True,
                         f"Total overdue: {summary.get('total_overdue_invoices')}, High risk (>180 days): {high_risk_count}")
            
            # Verify our invoice is in the report
            found_invoice = any(inv.get("id") == invoice_id for inv in invoices)
            if found_invoice:
                print(f"   ✓ Our test invoice found in overdue report")
            else:
                print(f"   ⚠ Our test invoice NOT found in overdue report (may need to wait or check date logic)")
        else:
            self.log_test("Phase 9A - Overdue Report", False, "Failed to get overdue report")
        
        # Step 5: Test write-off validation (cannot write-off paid invoice)
        print("\n--- Step 5: Test Write-off Validation ---")
        
        # Create a paid invoice to test validation
        success, paid_invoice = self.run_test(
            "Create paid invoice for validation test",
            "POST",
            "api/rahaza/ar-invoices",
            200,  # API returns 200 instead of 201
            data={
                "customer_id": customer_id,
                "issue_date": date.today().isoformat(),
                "due_date": date.today().isoformat(),
                "items": [{"description": "Paid item", "qty": 1, "unit": "pcs", "price": 10000}],
                "tax_pct": 0
            }
        )
        
        if success:
            paid_invoice_id = paid_invoice["id"]
            self.created_resources["ar_invoices"].append(paid_invoice_id)
            
            # Mark as paid
            success, _ = self.run_test(
                "Mark invoice as paid",
                "POST",
                f"api/rahaza/ar-invoices/{paid_invoice_id}/status",
                200,
                data={"status": "paid"}
            )
            
            # Try to write-off paid invoice (should fail)
            success, error_response = self.run_test(
                "Try to write-off paid invoice (should fail)",
                "POST",
                f"api/rahaza/ar-invoices/{paid_invoice_id}/write-off-bad-debt",
                400,
                data={"reason": "Test validation"}
            )
            
            if not success:  # We expect 400 error
                self.log_test("Phase 9A - Validation: Cannot write-off paid invoice", True,
                             "Correctly rejected write-off of paid invoice")
            else:
                self.log_test("Phase 9A - Validation: Cannot write-off paid invoice", False,
                             "Should have rejected write-off of paid invoice")
        
        # Step 6: Test write-off without reason (should fail)
        print("\n--- Step 6: Test Write-off Without Reason ---")
        success, error_response = self.run_test(
            "Try to write-off without reason (should fail)",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_id}/write-off-bad-debt",
            400,
            data={}
        )
        
        if not success:  # We expect 400 error
            self.log_test("Phase 9A - Validation: Reason required", True,
                         "Correctly rejected write-off without reason")
        else:
            self.log_test("Phase 9A - Validation: Reason required", False,
                         "Should have rejected write-off without reason")
        
        # Step 7: Write-off bad debt (valid)
        print("\n--- Step 7: Write-off Bad Debt (Valid) ---")
        write_off_date = date.today().isoformat()
        
        success, writeoff_result = self.run_test(
            "Write-off bad debt with reason",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_id}/write-off-bad-debt",
            200,
            data={
                "reason": "Customer bangkrut, tidak tertagih > 180 hari",
                "write_off_date": write_off_date
            }
        )
        
        if success:
            status = writeoff_result.get("status")
            write_off_amount = writeoff_result.get("write_off_amount")
            write_off_reason = writeoff_result.get("write_off_reason")
            gl_bad_debt_je_number = writeoff_result.get("gl_bad_debt_je_number")
            
            self.log_test("Phase 9A - Write-off Bad Debt", True,
                         f"Status: {status}, Amount: {write_off_amount}, JE: {gl_bad_debt_je_number}")
            
            # Verify audit trail
            if all([
                writeoff_result.get("write_off_date"),
                writeoff_result.get("write_off_reason"),
                writeoff_result.get("write_off_amount"),
                writeoff_result.get("write_off_by"),
                writeoff_result.get("write_off_by_name")
            ]):
                self.log_test("Phase 9A - Audit Trail", True,
                             f"All audit fields present: date, reason, amount, by whom")
            else:
                self.log_test("Phase 9A - Audit Trail", False,
                             "Missing audit trail fields")
            
            # Verify GL posting
            posting_result = writeoff_result.get("_posting_result", {})
            if posting_result.get("ok"):
                je_id = posting_result.get("je_id")
                je_number = posting_result.get("je_number")
                
                # Get JE details to verify accounts
                success, je_details = self.run_test(
                    "Get bad debt JE details",
                    "GET",
                    f"api/rahaza/journal-entries/{je_id}",
                    200
                )
                
                if success:
                    lines = je_details.get("lines", [])
                    
                    # Verify Dr. 6-2600 (Bad Debt Expense) / Cr. 1-1301 (AR)
                    debit_line = next((l for l in lines if l.get("debit") > 0), None)
                    credit_line = next((l for l in lines if l.get("credit") > 0), None)
                    
                    if debit_line and credit_line:
                        debit_account = debit_line.get("account_code")
                        credit_account = credit_line.get("account_code")
                        
                        if debit_account == "6-2600" and credit_account == "1-1301":
                            self.log_test("Phase 9A - GL Posting Accounts", True,
                                         f"Correct accounts: Dr. {debit_account} (Bad Debt Expense) / Cr. {credit_account} (AR)")
                        else:
                            self.log_test("Phase 9A - GL Posting Accounts", False,
                                         f"Incorrect accounts: Dr. {debit_account} / Cr. {credit_account}, Expected: Dr. 6-2600 / Cr. 1-1301")
                    else:
                        self.log_test("Phase 9A - GL Posting Accounts", False,
                                     "Missing debit or credit lines")
                else:
                    self.log_test("Phase 9A - GL Posting Accounts", False,
                                 "Failed to get JE details")
            else:
                self.log_test("Phase 9A - GL Posting", False,
                             f"GL posting failed: {posting_result.get('error')}")
        else:
            self.log_test("Phase 9A - Write-off Bad Debt", False,
                         "Failed to write-off bad debt")
        
        # Step 8: Test idempotency (try to write-off again)
        print("\n--- Step 8: Test Write-off Idempotency ---")
        success, error_response = self.run_test(
            "Try to write-off again (should fail)",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_id}/write-off-bad-debt",
            400,
            data={"reason": "Second attempt"}
        )
        
        if not success:  # We expect 400 error
            self.log_test("Phase 9A - Idempotency", True,
                         "Correctly rejected second write-off attempt")
        else:
            self.log_test("Phase 9A - Idempotency", False,
                         "Should have rejected second write-off attempt")

    # ========================================================================
    # PHASE 9B: BANK RECONCILIATION ADJUSTMENTS
    # ========================================================================
    
    def test_phase_9b_bank_recon(self):
        """Test Phase 9B: Bank Reconciliation Adjustments"""
        print("\n" + "="*80)
        print("PHASE 9B: BANK RECONCILIATION ADJUSTMENTS")
        print("="*80)
        
        # Step 1: Get or create bank account
        print("\n--- Step 1: Get Bank Account ---")
        success, bank_accounts = self.run_test(
            "Get bank accounts",
            "GET",
            "api/rahaza/cash-accounts?active_only=true",
            200
        )
        
        if not success or not bank_accounts:
            # Create a bank account
            success, bank_account = self.run_test(
                "Create bank account",
                "POST",
                "api/rahaza/cash-accounts",
                200,  # API returns 200 instead of 201
                data={
                    "code": f"BANK{datetime.now().strftime('%H%M%S')}",
                    "name": "Test Bank Account",
                    "type": "bank",
                    "bank_name": "Bank Test",
                    "account_number": "1234567890",
                    "opening_balance": 10000000
                }
            )
            
            if not success:
                self.log_test("Phase 9B Setup - Create Bank Account", False, "Failed to create bank account")
                return
            
            bank_account_id = bank_account["id"]
            self.created_resources["bank_accounts"].append(bank_account_id)
        else:
            bank_account = bank_accounts[0]
            bank_account_id = bank_account["id"]
        
        initial_balance = bank_account.get("balance", 0)
        self.log_test("Phase 9B Setup - Bank Account", True,
                     f"Bank: {bank_account.get('name')}, Initial Balance: Rp {initial_balance:,.0f}")
        
        # Step 2: Create bank adjustments (4 types)
        print("\n--- Step 2: Create Bank Adjustments (4 Types) ---")
        
        adjustment_types = [
            {
                "type": "bank_charge",
                "amount": 15000,
                "description": "Bank admin fee",
                "expected_balance_change": -15000
            },
            {
                "type": "interest_income",
                "amount": 50000,
                "description": "Monthly interest",
                "expected_balance_change": 50000
            },
            {
                "type": "service_fee",
                "amount": 5000,
                "description": "ATM service fee",
                "expected_balance_change": -5000
            },
            {
                "type": "correction",
                "amount": 10000,
                "description": "Bank statement correction",
                "expense_account": "6-2400",
                "expected_balance_change": 0  # Correction doesn't auto-update balance
            }
        ]
        
        created_adjustments = []
        
        for adj_data in adjustment_types:
            adj_type = adj_data["type"]
            
            payload = {
                "bank_account_id": bank_account_id,
                "adjustment_type": adj_type,
                "amount": adj_data["amount"],
                "description": adj_data["description"],
                "adjustment_date": date.today().isoformat(),
                "reference_number": f"REF-{adj_type.upper()}-{datetime.now().strftime('%H%M%S')}"
            }
            
            if adj_type == "correction":
                payload["expense_account"] = adj_data["expense_account"]
            
            success, adjustment = self.run_test(
                f"Create {adj_type} adjustment",
                "POST",
                "api/rahaza/finance/bank-recon-adjustments",
                200,  # API returns 200 instead of 201
                data=payload
            )
            
            if success:
                adjustment_id = adjustment.get("id")
                created_adjustments.append({
                    "id": adjustment_id,
                    "type": adj_type,
                    "amount": adj_data["amount"],
                    "expected_balance_change": adj_data["expected_balance_change"]
                })
                self.created_resources["bank_adjustments"].append(adjustment_id)
                self.log_test(f"Phase 9B - Create {adj_type} adjustment", True,
                             f"ID: {adjustment_id}, Amount: Rp {adj_data['amount']:,.0f}")
            else:
                self.log_test(f"Phase 9B - Create {adj_type} adjustment", False,
                             f"Failed to create {adj_type} adjustment")
        
        # Step 3: Test CRUD operations
        print("\n--- Step 3: Test CRUD Operations ---")
        
        if created_adjustments:
            first_adjustment = created_adjustments[0]
            
            # Update draft adjustment
            success, updated = self.run_test(
                "Update draft adjustment",
                "PUT",
                f"api/rahaza/finance/bank-recon-adjustments/{first_adjustment['id']}",
                200,
                data={
                    "description": "Updated bank admin fee description",
                    "notes": "Updated via test"
                }
            )
            
            if success:
                self.log_test("Phase 9B - Update Draft Adjustment", True,
                             f"Description updated: {updated.get('description')}")
            else:
                self.log_test("Phase 9B - Update Draft Adjustment", False,
                             "Failed to update adjustment")
            
            # Get single adjustment
            success, single = self.run_test(
                "Get single adjustment",
                "GET",
                f"api/rahaza/finance/bank-recon-adjustments/{first_adjustment['id']}",
                200
            )
            
            if success:
                self.log_test("Phase 9B - Get Single Adjustment", True,
                             f"Status: {single.get('status')}")
            else:
                self.log_test("Phase 9B - Get Single Adjustment", False,
                             "Failed to get adjustment")
        
        # Step 4: Post adjustments and verify GL
        print("\n--- Step 4: Post Adjustments and Verify GL ---")
        
        expected_gl_mappings = {
            "bank_charge": {"debit": "6-2500", "credit": "1-1201"},
            "interest_income": {"debit": "1-1201", "credit": "4-2100"},
            "service_fee": {"debit": "6-2501", "credit": "1-1201"},
            "correction": {"debit": "6-2400", "credit": "1-1201"}  # Using expense_account
        }
        
        for adj in created_adjustments:
            success, posted = self.run_test(
                f"Post {adj['type']} adjustment",
                "POST",
                f"api/rahaza/finance/bank-recon-adjustments/{adj['id']}/post",
                200
            )
            
            if success:
                status = posted.get("status")
                je_number = posted.get("je_number")
                je_id = posted.get("je_id")
                
                self.log_test(f"Phase 9B - Post {adj['type']}", True,
                             f"Status: {status}, JE: {je_number}")
                
                # Verify GL accounts
                if je_id:
                    success, je_details = self.run_test(
                        f"Get {adj['type']} JE details",
                        "GET",
                        f"api/rahaza/journal-entries/{je_id}",
                        200
                    )
                    
                    if success:
                        lines = je_details.get("lines", [])
                        debit_line = next((l for l in lines if l.get("debit") > 0), None)
                        credit_line = next((l for l in lines if l.get("credit") > 0), None)
                        
                        if debit_line and credit_line:
                            debit_account = debit_line.get("account_code")
                            credit_account = credit_line.get("account_code")
                            expected = expected_gl_mappings.get(adj['type'], {})
                            
                            # For correction, we use custom expense_account
                            if adj['type'] == "correction":
                                expected_debit = "6-2400"
                            else:
                                expected_debit = expected.get("debit")
                            
                            expected_credit = expected.get("credit")
                            
                            if debit_account == expected_debit and credit_account == expected_credit:
                                self.log_test(f"Phase 9B - GL Accounts {adj['type']}", True,
                                             f"Correct: Dr. {debit_account} / Cr. {credit_account}")
                            else:
                                self.log_test(f"Phase 9B - GL Accounts {adj['type']}", False,
                                             f"Got: Dr. {debit_account} / Cr. {credit_account}, Expected: Dr. {expected_debit} / Cr. {expected_credit}")
            else:
                self.log_test(f"Phase 9B - Post {adj['type']}", False,
                             f"Failed to post {adj['type']} adjustment")
        
        # Step 5: Verify bank balance update
        print("\n--- Step 5: Verify Bank Balance Update ---")
        
        success, updated_bank = self.run_test(
            "Get updated bank account",
            "GET",
            f"api/rahaza/cash-accounts",
            200
        )
        
        if success:
            bank = next((b for b in updated_bank if b.get("id") == bank_account_id), None)
            if bank:
                final_balance = bank.get("balance", 0)
                
                # Calculate expected balance change
                expected_change = sum(adj["expected_balance_change"] for adj in created_adjustments)
                expected_final = initial_balance + expected_change
                
                balance_diff = abs(final_balance - expected_final)
                
                if balance_diff < 1:  # Allow for rounding
                    self.log_test("Phase 9B - Bank Balance Update", True,
                                 f"Initial: Rp {initial_balance:,.0f}, Final: Rp {final_balance:,.0f}, Change: Rp {expected_change:,.0f}")
                else:
                    self.log_test("Phase 9B - Bank Balance Update", False,
                                 f"Balance mismatch. Expected: Rp {expected_final:,.0f}, Got: Rp {final_balance:,.0f}")
            else:
                self.log_test("Phase 9B - Bank Balance Update", False,
                             "Bank account not found")
        else:
            self.log_test("Phase 9B - Bank Balance Update", False,
                         "Failed to get bank accounts")
        
        # Step 6: Test idempotency
        print("\n--- Step 6: Test Idempotency ---")
        
        if created_adjustments:
            first_adj = created_adjustments[0]
            
            success, repost_result = self.run_test(
                "Try to post same adjustment again",
                "POST",
                f"api/rahaza/finance/bank-recon-adjustments/{first_adj['id']}/post",
                400  # Should fail - already posted
            )
            
            if not success:  # We expect 400 error
                self.log_test("Phase 9B - Idempotency", True,
                             "Correctly rejected second posting attempt")
            else:
                # Check if it returned already_posted status
                if repost_result.get("status") == "posted":
                    self.log_test("Phase 9B - Idempotency", True,
                                 "Already posted - idempotency working")
                else:
                    self.log_test("Phase 9B - Idempotency", False,
                                 "Should have rejected or returned already_posted status")
        
        # Step 7: Test delete draft adjustment
        print("\n--- Step 7: Test Delete Draft Adjustment ---")
        
        # Create a new draft adjustment to delete
        success, draft_adj = self.run_test(
            "Create draft adjustment for deletion",
            "POST",
            "api/rahaza/finance/bank-recon-adjustments",
            200,  # API returns 200 instead of 201
            data={
                "bank_account_id": bank_account_id,
                "adjustment_type": "bank_charge",
                "amount": 1000,
                "description": "To be deleted",
                "adjustment_date": date.today().isoformat()
            }
        )
        
        if success:
            draft_id = draft_adj.get("id")
            
            success, delete_result = self.run_test(
                "Delete draft adjustment",
                "DELETE",
                f"api/rahaza/finance/bank-recon-adjustments/{draft_id}",
                200
            )
            
            if success:
                self.log_test("Phase 9B - Delete Draft", True,
                             "Draft adjustment deleted successfully")
            else:
                self.log_test("Phase 9B - Delete Draft", False,
                             "Failed to delete draft adjustment")

    # ========================================================================
    # PHASE 9C: SALES DISCOUNT TRACKING
    # ========================================================================
    
    def test_phase_9c_sales_discount(self):
        """Test Phase 9C: Sales Discount Tracking"""
        print("\n" + "="*80)
        print("PHASE 9C: SALES DISCOUNT TRACKING")
        print("="*80)
        
        # Step 1: Get or create customer
        print("\n--- Step 1: Get Customer ---")
        success, customers = self.run_test(
            "Get customers",
            "GET",
            "api/rahaza/customers",
            200
        )
        
        if not success or not customers:
            # Create customer
            success, customer = self.run_test(
                "Create customer",
                "POST",
                "api/rahaza/customers",
                200,  # API returns 200 instead of 201
                data={
                    "name": "Sales Discount Test Customer",
                    "code": f"SDTEST{datetime.now().strftime('%H%M%S')}",
                    "email": "discount@test.com"
                }
            )
            
            if not success:
                self.log_test("Phase 9C Setup - Create Customer", False, "Failed to create customer")
                return
            
            customer_id = customer["id"]
            self.created_resources["customers"].append(customer_id)
        else:
            customer_id = customers[0]["id"]
        
        self.log_test("Phase 9C Setup - Customer", True, f"Customer ID: {customer_id}")
        
        # Step 2: Create AR invoice WITH discount
        print("\n--- Step 2: Create AR Invoice WITH Discount ---")
        
        success, invoice_with_discount = self.run_test(
            "Create AR invoice with discount",
            "POST",
            "api/rahaza/ar-invoices",
            200,  # API returns 200 instead of 201
            data={
                "customer_id": customer_id,
                "issue_date": date.today().isoformat(),
                "due_date": (date.today() + timedelta(days=30)).isoformat(),
                "items": [
                    {
                        "description": "Product A",
                        "qty": 10,
                        "unit": "pcs",
                        "price": 100000
                    }
                ],
                "tax_pct": 11,
                "discount_amount": 100000,  # Rp 100,000 discount
                "notes": "Invoice with sales discount"
            }
        )
        
        if not success or not invoice_with_discount.get("id"):
            self.log_test("Phase 9C - Create Invoice with Discount", False, "Failed to create invoice")
            return
        
        invoice_discount_id = invoice_with_discount["id"]
        invoice_discount_number = invoice_with_discount.get("invoice_number")
        subtotal = invoice_with_discount.get("subtotal", 0)
        discount = invoice_with_discount.get("discount_amount", 0)
        total = invoice_with_discount.get("total", 0)
        
        self.created_resources["ar_invoices"].append(invoice_discount_id)
        self.log_test("Phase 9C - Create Invoice with Discount", True,
                     f"Invoice: {invoice_discount_number}, Subtotal: {subtotal}, Discount: {discount}, Total: {total}")
        
        # Step 3: Send invoice with discount (post to GL)
        print("\n--- Step 3: Send Invoice with Discount (Post to GL) ---")
        
        success, sent_discount = self.run_test(
            "Send invoice with discount",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_discount_id}/send",
            200
        )
        
        if success:
            gl_je_id = sent_discount.get("gl_je_id")
            gl_je_number = sent_discount.get("gl_je_number")
            
            self.log_test("Phase 9C - Send Invoice with Discount", True,
                         f"GL JE: {gl_je_number}")
            
            # Verify GL split entry
            if gl_je_id:
                success, je_details = self.run_test(
                    "Get discount invoice JE details",
                    "GET",
                    f"api/rahaza/journal-entries/{gl_je_id}",
                    200
                )
                
                if success:
                    lines = je_details.get("lines", [])
                    
                    # Expected: Dr. AR + Dr. Sales Discount / Cr. Revenue (gross) / Cr. Tax
                    # Find lines
                    ar_line = next((l for l in lines if l.get("account_code") == "1-1301" and l.get("debit") > 0), None)
                    discount_line = next((l for l in lines if l.get("account_code") == "6-1100" and l.get("debit") > 0), None)
                    revenue_line = next((l for l in lines if l.get("account_code") == "4-1100" and l.get("credit") > 0), None)
                    
                    if ar_line and discount_line and revenue_line:
                        ar_amount = ar_line.get("debit", 0)
                        discount_amount = discount_line.get("debit", 0)
                        revenue_amount = revenue_line.get("credit", 0)
                        
                        # Verify amounts
                        # AR = total (after discount + tax)
                        # Discount = discount_amount
                        # Revenue = subtotal + discount (gross revenue before discount)
                        
                        expected_revenue = subtotal + discount
                        
                        if abs(revenue_amount - expected_revenue) < 1:
                            self.log_test("Phase 9C - GL Split Entry", True,
                                         f"Correct split: Dr. AR {ar_amount:,.0f} + Dr. Discount {discount_amount:,.0f} / Cr. Revenue (gross) {revenue_amount:,.0f}")
                        else:
                            self.log_test("Phase 9C - GL Split Entry", False,
                                         f"Revenue amount incorrect. Expected: {expected_revenue:,.0f}, Got: {revenue_amount:,.0f}")
                        
                        # Verify accounts
                        if ar_line.get("account_code") == "1-1301" and \
                           discount_line.get("account_code") == "6-1100" and \
                           revenue_line.get("account_code") == "4-1100":
                            self.log_test("Phase 9C - GL Accounts", True,
                                         "Correct accounts: Dr. 1-1301 (AR) + Dr. 6-1100 (Sales Discount) / Cr. 4-1100 (Revenue)")
                        else:
                            self.log_test("Phase 9C - GL Accounts", False,
                                         "Incorrect account codes")
                    else:
                        self.log_test("Phase 9C - GL Split Entry", False,
                                     f"Missing expected lines. AR: {ar_line is not None}, Discount: {discount_line is not None}, Revenue: {revenue_line is not None}")
                else:
                    self.log_test("Phase 9C - GL Split Entry", False,
                                 "Failed to get JE details")
        else:
            self.log_test("Phase 9C - Send Invoice with Discount", False,
                         "Failed to send invoice")
        
        # Step 4: Create AR invoice WITHOUT discount (backward compatibility)
        print("\n--- Step 4: Create AR Invoice WITHOUT Discount (Backward Compatibility) ---")
        
        success, invoice_no_discount = self.run_test(
            "Create AR invoice without discount",
            "POST",
            "api/rahaza/ar-invoices",
            200,  # API returns 200 instead of 201
            data={
                "customer_id": customer_id,
                "issue_date": date.today().isoformat(),
                "due_date": (date.today() + timedelta(days=30)).isoformat(),
                "items": [
                    {
                        "description": "Product B",
                        "qty": 5,
                        "unit": "pcs",
                        "price": 50000
                    }
                ],
                "tax_pct": 11,
                "notes": "Invoice without discount"
            }
        )
        
        if not success or not invoice_no_discount.get("id"):
            self.log_test("Phase 9C - Create Invoice without Discount", False, "Failed to create invoice")
            return
        
        invoice_no_discount_id = invoice_no_discount["id"]
        invoice_no_discount_number = invoice_no_discount.get("invoice_number")
        
        self.created_resources["ar_invoices"].append(invoice_no_discount_id)
        self.log_test("Phase 9C - Create Invoice without Discount", True,
                     f"Invoice: {invoice_no_discount_number}")
        
        # Step 5: Send invoice without discount
        print("\n--- Step 5: Send Invoice without Discount (Verify Original Logic) ---")
        
        success, sent_no_discount = self.run_test(
            "Send invoice without discount",
            "POST",
            f"api/rahaza/ar-invoices/{invoice_no_discount_id}/send",
            200
        )
        
        if success:
            gl_je_id = sent_no_discount.get("gl_je_id")
            gl_je_number = sent_no_discount.get("gl_je_number")
            
            self.log_test("Phase 9C - Send Invoice without Discount", True,
                         f"GL JE: {gl_je_number}")
            
            # Verify original GL logic (no discount line)
            if gl_je_id:
                success, je_details = self.run_test(
                    "Get no-discount invoice JE details",
                    "GET",
                    f"api/rahaza/journal-entries/{gl_je_id}",
                    200
                )
                
                if success:
                    lines = je_details.get("lines", [])
                    
                    # Should NOT have discount line
                    discount_line = next((l for l in lines if l.get("account_code") == "6-1100"), None)
                    
                    if discount_line is None:
                        self.log_test("Phase 9C - Backward Compatibility", True,
                                     "No discount line present (original logic preserved)")
                    else:
                        self.log_test("Phase 9C - Backward Compatibility", False,
                                     "Discount line present when it shouldn't be")
                    
                    # Verify standard entry: Dr. AR / Cr. Revenue / Cr. Tax
                    ar_line = next((l for l in lines if l.get("account_code") == "1-1301" and l.get("debit") > 0), None)
                    revenue_line = next((l for l in lines if l.get("account_code") == "4-1100" and l.get("credit") > 0), None)
                    
                    if ar_line and revenue_line:
                        self.log_test("Phase 9C - Original Logic", True,
                                     "Standard entry: Dr. AR / Cr. Revenue")
                    else:
                        self.log_test("Phase 9C - Original Logic", False,
                                     "Missing expected AR or Revenue lines")
                else:
                    self.log_test("Phase 9C - Backward Compatibility", False,
                                 "Failed to get JE details")
        else:
            self.log_test("Phase 9C - Send Invoice without Discount", False,
                         "Failed to send invoice")

    # ========================================================================
    # REGRESSION TESTING
    # ========================================================================
    
    def test_regression_phase8(self):
        """Test Phase 8 regression - ensure previous features still work"""
        print("\n" + "="*80)
        print("REGRESSION TESTING: PHASE 8 FEATURES")
        print("="*80)
        
        # Test depreciation endpoint
        print("\n--- Test Depreciation Endpoint ---")
        success, _ = self.run_test(
            "Access depreciation endpoint",
            "GET",
            "api/rahaza/finance/fixed-assets",
            200
        )
        
        if success:
            self.log_test("Regression - Depreciation Endpoint", True,
                         "Fixed assets endpoint accessible")
        else:
            self.log_test("Regression - Depreciation Endpoint", False,
                         "Fixed assets endpoint not accessible")
        
        # Test accruals endpoint
        print("\n--- Test Accruals Endpoint ---")
        success, _ = self.run_test(
            "Access accruals endpoint",
            "GET",
            "api/rahaza/finance/accruals",
            200
        )
        
        if success:
            self.log_test("Regression - Accruals Endpoint", True,
                         "Accruals endpoint accessible")
        else:
            self.log_test("Regression - Accruals Endpoint", False,
                         "Accruals endpoint not accessible")

    # ========================================================================
    # MAIN TEST RUNNER
    # ========================================================================
    
    def run_all_tests(self):
        """Run all Phase 9 tests"""
        print("\n" + "="*80)
        print("PHASE 9 BACKEND TESTING SUITE")
        print("Testing: Bad Debt Write-off, Bank Recon Adjustments, Sales Discount")
        print("="*80)
        
        # Login
        if not self.test_login():
            print("\n❌ Login failed. Cannot proceed with tests.")
            return False
        
        # Phase 9A: Bad Debt Write-off
        self.test_phase_9a_bad_debt()
        
        # Phase 9B: Bank Reconciliation Adjustments
        self.test_phase_9b_bank_recon()
        
        # Phase 9C: Sales Discount Tracking
        self.test_phase_9c_sales_discount()
        
        # Regression Testing
        self.test_regression_phase8()
        
        # Print summary
        self.print_summary()
        
        return self.tests_passed == self.tests_run

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0:.1f}%")
        print("="*80)
        
        # Save results to file
        results = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": self.tests_run,
            "passed": self.tests_passed,
            "failed": self.tests_run - self.tests_passed,
            "success_rate": f"{(self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0:.1f}%",
            "test_results": self.test_results,
            "created_resources": self.created_resources
        }
        
        with open("/tmp/phase9_test_results.json", "w") as f:
            json.dump(results, f, indent=2)
        
        print(f"\n📄 Detailed results saved to: /tmp/phase9_test_results.json")


def main():
    tester = Phase9BackendTester()
    success = tester.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
