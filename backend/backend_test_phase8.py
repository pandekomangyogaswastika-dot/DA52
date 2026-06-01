"""
Phase 8 P0 Gaps Backend Testing
Tests: Asset Capitalization, Batch Depreciation, Accrual Module
"""
import requests
import sys
import json
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

class Phase8Tester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
    def log_test(self, name, passed, details=""):
        self.tests_run += 1
        if passed:
            self.tests_passed += 1
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {name}")
        if details:
            print(f"   {details}")
        self.test_results.append({
            "test": name,
            "passed": passed,
            "details": details
        })
        
    def login(self):
        """Login as superadmin"""
        print("\n🔐 Logging in as admin@garment.com...")
        try:
            resp = requests.post(
                f"{self.base_url}/api/auth/login",
                json={"email": "admin@garment.com", "password": "Admin@123"},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                self.token = data.get("token")
                self.log_test("Login", True, f"Token: {self.token[:20]}...")
                return True
            else:
                self.log_test("Login", False, f"Status {resp.status_code}: {resp.text[:200]}")
                return False
        except Exception as e:
            self.log_test("Login", False, str(e))
            return False
    
    def headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PHASE 8A: ASSET CAPITALIZATION FROM GRN
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_asset_capitalization(self):
        """Test Phase 8A: Asset capitalization from GRN"""
        print("\n" + "="*80)
        print("PHASE 8A: ASSET CAPITALIZATION FROM GRN")
        print("="*80)
        
        # Step 1: Create GRN with asset items
        print("\n📦 Step 1: Creating GRN with asset items...")
        grn_data = {
            "source_type": "supplier",
            "supplier_name": "PT Asset Supplier",
            "location_id": "loc-001",
            "location_name": "Warehouse A",
            "po_number": "PO-TEST-001",
            "notes": "Test GRN for asset capitalization",
            "items": [
                {
                    "product_name": "Laptop Dell Latitude 5420",
                    "sku": "LAPTOP-001",
                    "item_type": "asset",
                    "asset_category": "it",
                    "expected_qty": 2,
                    "received_qty": 2,
                    "rejected_qty": 0,
                    "unit": "pcs",
                    "unit_price": 15000000,
                    "serial_number": "SN-LAPTOP-001"
                },
                {
                    "product_name": "Office Chair Ergonomic",
                    "sku": "CHAIR-001",
                    "item_type": "asset",
                    "asset_category": "furnitur",
                    "expected_qty": 5,
                    "received_qty": 5,
                    "rejected_qty": 0,
                    "unit": "pcs",
                    "unit_price": 2500000
                },
                {
                    "product_name": "Fabric Cotton",
                    "sku": "FABRIC-001",
                    "item_type": "material",
                    "expected_qty": 100,
                    "received_qty": 100,
                    "rejected_qty": 0,
                    "unit": "meter",
                    "unit_price": 50000
                }
            ]
        }
        
        try:
            resp = requests.post(
                f"{self.base_url}/api/warehouse/receiving",
                json=grn_data,
                headers=self.headers(),
                timeout=10
            )
            if resp.status_code in [200, 201]:
                grn = resp.json()
                grn_id = grn.get("id")
                grn_number = grn.get("receipt_number")
                self.log_test("Create GRN with asset items", True, f"GRN: {grn_number}")
                
                # Step 2: Mark GRN as received (triggers asset capitalization)
                print(f"\n✅ Step 2: Marking GRN {grn_number} as received...")
                update_resp = requests.put(
                    f"{self.base_url}/api/warehouse/receiving/{grn_id}",
                    json={"status": "received", "items": grn.get("items", [])},
                    headers=self.headers(),
                    timeout=15
                )
                
                if update_resp.status_code == 200:
                    updated_grn = update_resp.json()
                    self.log_test("Mark GRN as received", True, f"Status: {updated_grn.get('status')}")
                    
                    # Step 3: Verify fixed assets were created
                    print("\n🔍 Step 3: Verifying fixed assets creation...")
                    assets_resp = requests.get(
                        f"{self.base_url}/api/rahaza/finance/fixed-assets",
                        headers=self.headers(),
                        timeout=10
                    )
                    
                    if assets_resp.status_code == 200:
                        assets = assets_resp.json()
                        # Filter assets created from this GRN
                        grn_assets = [a for a in assets if a.get("grn_number") == grn_number]
                        
                        if len(grn_assets) >= 2:
                            self.log_test("Fixed assets auto-created", True, 
                                        f"Created {len(grn_assets)} assets from GRN")
                            
                            # Step 4: Verify GL posting for each asset
                            print("\n💰 Step 4: Verifying GL postings...")
                            for asset in grn_assets:
                                asset_code = asset.get("code")
                                gl_je_id = asset.get("gl_je_id")
                                
                                if gl_je_id:
                                    # Fetch JE details
                                    je_resp = requests.get(
                                        f"{self.base_url}/api/rahaza/finance/journal-entries/{gl_je_id}",
                                        headers=self.headers(),
                                        timeout=10
                                    )
                                    
                                    if je_resp.status_code == 200:
                                        je = je_resp.json()
                                        lines = je.get("lines", [])
                                        
                                        # Verify Dr. Fixed Asset / Cr. AP Clearing
                                        debit_line = next((l for l in lines if l.get("debit") > 0), None)
                                        credit_line = next((l for l in lines if l.get("credit") > 0), None)
                                        
                                        if (debit_line and credit_line and
                                            debit_line.get("account_code") == "1-1501" and
                                            credit_line.get("account_code") == "2-1100"):
                                            self.log_test(f"Asset GL posting - {asset_code}", True,
                                                        f"Dr. 1-1501 / Cr. 2-1100 = Rp {debit_line.get('debit'):,.0f}")
                                        else:
                                            self.log_test(f"Asset GL posting - {asset_code}", False,
                                                        "Incorrect GL accounts")
                                    else:
                                        self.log_test(f"Asset GL posting - {asset_code}", False,
                                                    f"JE not found: {gl_je_id}")
                                else:
                                    self.log_test(f"Asset GL posting - {asset_code}", False,
                                                "No GL JE ID found")
                            
                            # Step 5: Verify GRN items updated with asset_id
                            print("\n🔗 Step 5: Verifying GRN item linking...")
                            grn_refresh = requests.get(
                                f"{self.base_url}/api/warehouse/receiving/{grn_id}",
                                headers=self.headers(),
                                timeout=10
                            ).json()
                            
                            asset_items = [i for i in grn_refresh.get("items", []) 
                                         if i.get("item_type") == "asset"]
                            capitalized_count = sum(1 for i in asset_items if i.get("capitalized"))
                            
                            if capitalized_count == len(asset_items):
                                self.log_test("GRN items linked to assets", True,
                                            f"{capitalized_count}/{len(asset_items)} items capitalized")
                            else:
                                self.log_test("GRN items linked to assets", False,
                                            f"Only {capitalized_count}/{len(asset_items)} items capitalized")
                        else:
                            self.log_test("Fixed assets auto-created", False,
                                        f"Expected 2+ assets, got {len(grn_assets)}")
                    else:
                        self.log_test("Fetch fixed assets", False, f"Status {assets_resp.status_code}")
                else:
                    self.log_test("Mark GRN as received", False, 
                                f"Status {update_resp.status_code}: {update_resp.text[:200]}")
            else:
                self.log_test("Create GRN with asset items", False,
                            f"Status {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            self.log_test("Asset capitalization flow", False, str(e))
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PHASE 8B: BATCH DEPRECIATION
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_batch_depreciation(self):
        """Test Phase 8B: Batch depreciation with multiple methods"""
        print("\n" + "="*80)
        print("PHASE 8B: BATCH DEPRECIATION")
        print("="*80)
        
        # Step 1: Create test assets with different depreciation methods
        print("\n📦 Step 1: Creating test assets...")
        test_assets = [
            {
                "code": f"TEST-DEPR-SL-{datetime.now().strftime('%H%M%S')}",
                "name": "Test Asset - Straight Line",
                "category": "peralatan",
                "purchase_date": date.today().isoformat(),
                "purchase_cost": 12000000,
                "residual_value": 0,
                "useful_life_months": 12,
                "depreciation_method": "straight_line"
            },
            {
                "code": f"TEST-DEPR-DD-{datetime.now().strftime('%H%M%S')}",
                "name": "Test Asset - Double Declining",
                "category": "it",
                "purchase_date": date.today().isoformat(),
                "purchase_cost": 24000000,
                "residual_value": 0,
                "useful_life_months": 24,
                "depreciation_method": "double_declining"
            },
            {
                "code": f"TEST-DEPR-NONE-{datetime.now().strftime('%H%M%S')}",
                "name": "Test Asset - No Depreciation",
                "category": "tanah",
                "purchase_date": date.today().isoformat(),
                "purchase_cost": 500000000,
                "residual_value": 0,
                "useful_life_months": 0,
                "depreciation_method": "none"
            },
            {
                "code": f"TEST-DEPR-MANUAL-{datetime.now().strftime('%H%M%S')}",
                "name": "Test Asset - Manual Depreciation",
                "category": "bangunan",
                "purchase_date": date.today().isoformat(),
                "purchase_cost": 1000000000,
                "residual_value": 0,
                "useful_life_months": 240,
                "depreciation_method": "manual"
            }
        ]
        
        created_asset_ids = []
        for asset_data in test_assets:
            try:
                resp = requests.post(
                    f"{self.base_url}/api/rahaza/finance/fixed-assets",
                    json=asset_data,
                    headers=self.headers(),
                    timeout=10
                )
                if resp.status_code in [200, 201]:
                    asset = resp.json()
                    created_asset_ids.append(asset.get("id"))
                    self.log_test(f"Create asset - {asset_data['depreciation_method']}", True,
                                f"Code: {asset.get('code')}")
                else:
                    self.log_test(f"Create asset - {asset_data['depreciation_method']}", False,
                                f"Status {resp.status_code}")
            except Exception as e:
                self.log_test(f"Create asset - {asset_data['depreciation_method']}", False, str(e))
        
        if len(created_asset_ids) < 2:
            print("⚠️  Not enough assets created, skipping batch depreciation test")
            return
        
        # Step 2: Run batch depreciation for current period
        print("\n⚙️  Step 2: Running batch depreciation...")
        current_period = date.today().strftime("%Y-%m")
        
        try:
            batch_resp = requests.post(
                f"{self.base_url}/api/rahaza/finance/fixed-assets/run-batch-depreciation",
                json={
                    "period": current_period,
                    "asset_ids": created_asset_ids,
                    "auto_post": True
                },
                headers=self.headers(),
                timeout=30
            )
            
            if batch_resp.status_code == 200:
                result = batch_resp.json()
                self.log_test("Run batch depreciation", True,
                            f"Processed: {result.get('assets_processed')}, Posted: {result.get('posted_count')}")
                
                # Step 3: Verify depreciation results
                print("\n🔍 Step 3: Verifying depreciation results...")
                results = result.get("results", [])
                
                # Check straight_line and double_declining were posted
                posted_assets = [r for r in results if r.get("status") == "posted"]
                skipped_assets = [r for r in results if r.get("status") == "skipped"]
                
                if len(posted_assets) >= 2:
                    self.log_test("Assets with auto methods posted", True,
                                f"{len(posted_assets)} assets posted")
                else:
                    self.log_test("Assets with auto methods posted", False,
                                f"Expected 2+, got {len(posted_assets)}")
                
                # Check none and manual were skipped
                if len(skipped_assets) >= 2:
                    self.log_test("Assets with none/manual skipped", True,
                                f"{len(skipped_assets)} assets skipped")
                else:
                    self.log_test("Assets with none/manual skipped", False,
                                f"Expected 2+, got {len(skipped_assets)}")
                
                # Step 4: Verify GL postings
                print("\n💰 Step 4: Verifying depreciation GL postings...")
                for asset_result in posted_assets:
                    je_number = asset_result.get("je_number")
                    if je_number:
                        # Fetch JE
                        je_resp = requests.get(
                            f"{self.base_url}/api/rahaza/finance/journal-entries",
                            params={"search": je_number},
                            headers=self.headers(),
                            timeout=10
                        )
                        
                        if je_resp.status_code == 200:
                            jes = je_resp.json()
                            je = next((j for j in jes if j.get("je_number") == je_number), None)
                            
                            if je:
                                lines = je.get("lines", [])
                                debit_line = next((l for l in lines if l.get("debit") > 0), None)
                                credit_line = next((l for l in lines if l.get("credit") > 0), None)
                                
                                if (debit_line and credit_line and
                                    debit_line.get("account_code") == "6-3100" and
                                    credit_line.get("account_code") == "1-1502"):
                                    self.log_test(f"Depreciation GL - {je_number}", True,
                                                f"Dr. 6-3100 / Cr. 1-1502 = Rp {debit_line.get('debit'):,.0f}")
                                else:
                                    self.log_test(f"Depreciation GL - {je_number}", False,
                                                "Incorrect GL accounts")
                
                # Step 5: Test idempotency - run again for same period
                print("\n🔄 Step 5: Testing idempotency...")
                batch_resp2 = requests.post(
                    f"{self.base_url}/api/rahaza/finance/fixed-assets/run-batch-depreciation",
                    json={
                        "period": current_period,
                        "asset_ids": created_asset_ids,
                        "auto_post": True
                    },
                    headers=self.headers(),
                    timeout=30
                )
                
                if batch_resp2.status_code == 200:
                    result2 = batch_resp2.json()
                    already_posted = [r for r in result2.get("results", []) 
                                    if r.get("status") == "already_posted"]
                    
                    if len(already_posted) >= 2:
                        self.log_test("Depreciation idempotency", True,
                                    f"{len(already_posted)} assets already posted (no duplicates)")
                    else:
                        self.log_test("Depreciation idempotency", False,
                                    f"Expected 2+ already_posted, got {len(already_posted)}")
                else:
                    self.log_test("Depreciation idempotency test", False,
                                f"Status {batch_resp2.status_code}")
            else:
                self.log_test("Run batch depreciation", False,
                            f"Status {batch_resp.status_code}: {batch_resp.text[:200]}")
        except Exception as e:
            self.log_test("Batch depreciation flow", False, str(e))
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PHASE 8C: ACCRUAL MODULE
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_accrual_module(self):
        """Test Phase 8C: Accrual CRUD, posting, reversal, recurring"""
        print("\n" + "="*80)
        print("PHASE 8C: ACCRUAL MODULE")
        print("="*80)
        
        current_period = date.today().strftime("%Y-%m")
        
        # Step 1: Create accrual entries
        print("\n📝 Step 1: Creating accrual entries...")
        accruals_data = [
            {
                "period": current_period,
                "accrual_type": "utility",
                "description": "Electricity expense accrual",
                "amount": 5000000,
                "is_recurring": True
            },
            {
                "period": current_period,
                "accrual_type": "rent",
                "description": "Office rent accrual",
                "amount": 15000000,
                "is_recurring": True
            },
            {
                "period": current_period,
                "accrual_type": "professional_fees",
                "description": "Consultant fee accrual",
                "amount": 10000000,
                "is_recurring": False
            }
        ]
        
        created_accrual_ids = []
        for accrual_data in accruals_data:
            try:
                resp = requests.post(
                    f"{self.base_url}/api/rahaza/finance/accruals",
                    json=accrual_data,
                    headers=self.headers(),
                    timeout=10
                )
                if resp.status_code in [200, 201]:
                    accrual = resp.json()
                    created_accrual_ids.append(accrual.get("id"))
                    self.log_test(f"Create accrual - {accrual_data['accrual_type']}", True,
                                f"Amount: Rp {accrual_data['amount']:,.0f}")
                else:
                    self.log_test(f"Create accrual - {accrual_data['accrual_type']}", False,
                                f"Status {resp.status_code}")
            except Exception as e:
                self.log_test(f"Create accrual - {accrual_data['accrual_type']}", False, str(e))
        
        if not created_accrual_ids:
            print("⚠️  No accruals created, skipping remaining tests")
            return
        
        # Step 2: Update draft accrual
        print("\n✏️  Step 2: Updating draft accrual...")
        first_accrual_id = created_accrual_ids[0]
        try:
            update_resp = requests.put(
                f"{self.base_url}/api/rahaza/finance/accruals/{first_accrual_id}",
                json={"amount": 5500000, "notes": "Updated amount"},
                headers=self.headers(),
                timeout=10
            )
            if update_resp.status_code == 200:
                updated = update_resp.json()
                self.log_test("Update draft accrual", True,
                            f"New amount: Rp {updated.get('amount'):,.0f}")
            else:
                self.log_test("Update draft accrual", False, f"Status {update_resp.status_code}")
        except Exception as e:
            self.log_test("Update draft accrual", False, str(e))
        
        # Step 3: Post accruals to GL
        print("\n💰 Step 3: Posting accruals to GL...")
        posted_accrual_ids = []
        for accrual_id in created_accrual_ids:
            try:
                post_resp = requests.post(
                    f"{self.base_url}/api/rahaza/finance/accruals/{accrual_id}/post",
                    headers=self.headers(),
                    timeout=15
                )
                if post_resp.status_code == 200:
                    posted = post_resp.json()
                    je_number = posted.get("je_number")
                    posted_accrual_ids.append(accrual_id)
                    self.log_test(f"Post accrual {accrual_id[:8]}", True, f"JE: {je_number}")
                    
                    # Verify GL posting
                    if je_number:
                        je_resp = requests.get(
                            f"{self.base_url}/api/rahaza/finance/journal-entries",
                            params={"search": je_number},
                            headers=self.headers(),
                            timeout=10
                        )
                        
                        if je_resp.status_code == 200:
                            jes = je_resp.json()
                            je = next((j for j in jes if j.get("je_number") == je_number), None)
                            
                            if je:
                                lines = je.get("lines", [])
                                debit_line = next((l for l in lines if l.get("debit") > 0), None)
                                credit_line = next((l for l in lines if l.get("credit") > 0), None)
                                
                                # Verify Dr. Expense / Cr. Accrued Expenses
                                if (debit_line and credit_line and
                                    debit_line.get("account_code") == "6-2400" and
                                    credit_line.get("account_code") == "2-1600"):
                                    self.log_test(f"Accrual GL - {je_number}", True,
                                                f"Dr. 6-2400 / Cr. 2-1600 = Rp {debit_line.get('debit'):,.0f}")
                                else:
                                    self.log_test(f"Accrual GL - {je_number}", False,
                                                f"Incorrect accounts: Dr {debit_line.get('account_code')} / Cr {credit_line.get('account_code')}")
                else:
                    self.log_test(f"Post accrual {accrual_id[:8]}", False,
                                f"Status {post_resp.status_code}: {post_resp.text[:200]}")
            except Exception as e:
                self.log_test(f"Post accrual {accrual_id[:8]}", False, str(e))
        
        # Step 4: Test accrual reversal
        print("\n🔄 Step 4: Testing accrual reversal...")
        if posted_accrual_ids:
            first_posted_id = posted_accrual_ids[0]
            try:
                reverse_resp = requests.post(
                    f"{self.base_url}/api/rahaza/finance/accruals/{first_posted_id}/reverse",
                    headers=self.headers(),
                    timeout=15
                )
                if reverse_resp.status_code == 200:
                    reversed = reverse_resp.json()
                    reversal_je_number = reversed.get("reversal_je_number")
                    self.log_test("Reverse accrual", True, f"Reversal JE: {reversal_je_number}")
                    
                    # Verify reversal GL
                    if reversal_je_number:
                        je_resp = requests.get(
                            f"{self.base_url}/api/rahaza/finance/journal-entries",
                            params={"search": reversal_je_number},
                            headers=self.headers(),
                            timeout=10
                        )
                        
                        if je_resp.status_code == 200:
                            jes = je_resp.json()
                            je = next((j for j in jes if j.get("je_number") == reversal_je_number), None)
                            
                            if je:
                                lines = je.get("lines", [])
                                debit_line = next((l for l in lines if l.get("debit") > 0), None)
                                credit_line = next((l for l in lines if l.get("credit") > 0), None)
                                
                                # Verify Dr. Accrued / Cr. Expense (reversed)
                                if (debit_line and credit_line and
                                    debit_line.get("account_code") == "2-1600" and
                                    credit_line.get("account_code") == "6-2400"):
                                    self.log_test(f"Reversal GL - {reversal_je_number}", True,
                                                f"Dr. 2-1600 / Cr. 6-2400 = Rp {debit_line.get('debit'):,.0f}")
                                else:
                                    self.log_test(f"Reversal GL - {reversal_je_number}", False,
                                                "Incorrect reversal accounts")
                else:
                    self.log_test("Reverse accrual", False,
                                f"Status {reverse_resp.status_code}: {reverse_resp.text[:200]}")
            except Exception as e:
                self.log_test("Reverse accrual", False, str(e))
        
        # Step 5: Test recurring accruals
        print("\n🔁 Step 5: Testing recurring accruals...")
        next_month = (date.today() + relativedelta(months=1)).strftime("%Y-%m")
        try:
            recurring_resp = requests.post(
                f"{self.base_url}/api/rahaza/finance/accruals/create-recurring",
                json={"target_period": next_month},
                headers=self.headers(),
                timeout=15
            )
            if recurring_resp.status_code == 200:
                result = recurring_resp.json()
                created_count = result.get("created_count", 0)
                
                if created_count >= 2:
                    self.log_test("Create recurring accruals", True,
                                f"Created {created_count} accruals for {next_month}")
                    
                    # Verify they are draft status
                    accruals = result.get("accruals", [])
                    all_draft = all(a.get("status") == "draft" for a in accruals)
                    
                    if all_draft:
                        self.log_test("Recurring accruals are draft", True,
                                    "All recurring accruals created as draft (flexible amounts)")
                    else:
                        self.log_test("Recurring accruals are draft", False,
                                    "Some recurring accruals not in draft status")
                else:
                    self.log_test("Create recurring accruals", False,
                                f"Expected 2+, got {created_count}")
            else:
                self.log_test("Create recurring accruals", False,
                            f"Status {recurring_resp.status_code}: {recurring_resp.text[:200]}")
        except Exception as e:
            self.log_test("Create recurring accruals", False, str(e))
        
        # Step 6: Test delete draft accrual
        print("\n🗑️  Step 6: Testing delete draft accrual...")
        # Get recurring accruals
        try:
            list_resp = requests.get(
                f"{self.base_url}/api/rahaza/finance/accruals",
                params={"period": next_month, "status": "draft"},
                headers=self.headers(),
                timeout=10
            )
            if list_resp.status_code == 200:
                draft_accruals = list_resp.json()
                if draft_accruals:
                    delete_id = draft_accruals[0].get("id")
                    delete_resp = requests.delete(
                        f"{self.base_url}/api/rahaza/finance/accruals/{delete_id}",
                        headers=self.headers(),
                        timeout=10
                    )
                    if delete_resp.status_code == 200:
                        self.log_test("Delete draft accrual", True, f"Deleted {delete_id[:8]}")
                    else:
                        self.log_test("Delete draft accrual", False,
                                    f"Status {delete_resp.status_code}")
        except Exception as e:
            self.log_test("Delete draft accrual", False, str(e))
    
    # ═══════════════════════════════════════════════════════════════════════════
    # REGRESSION: PHASE 7 FEATURES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def test_phase7_regression(self):
        """Quick regression test for Phase 7 features"""
        print("\n" + "="*80)
        print("REGRESSION: PHASE 7 FEATURES")
        print("="*80)
        
        # Test 1: Credit Note endpoint exists
        print("\n📋 Testing Credit Note endpoint...")
        try:
            resp = requests.get(
                f"{self.base_url}/api/rahaza/finance/credit-notes",
                headers=self.headers(),
                timeout=10
            )
            if resp.status_code == 200:
                self.log_test("Credit Note endpoint", True, "Endpoint accessible")
            else:
                self.log_test("Credit Note endpoint", False, f"Status {resp.status_code}")
        except Exception as e:
            self.log_test("Credit Note endpoint", False, str(e))
        
        # Test 2: Production Variance endpoint exists
        print("\n📊 Testing Production Variance endpoint...")
        try:
            resp = requests.get(
                f"{self.base_url}/api/rahaza/production/variances",
                headers=self.headers(),
                timeout=10
            )
            if resp.status_code == 200:
                self.log_test("Production Variance endpoint", True, "Endpoint accessible")
            else:
                self.log_test("Production Variance endpoint", False, f"Status {resp.status_code}")
        except Exception as e:
            self.log_test("Production Variance endpoint", False, str(e))
    
    def run_all_tests(self):
        """Run all Phase 8 tests"""
        print("\n" + "="*80)
        print("PHASE 8 P0 GAPS BACKEND TESTING")
        print("="*80)
        
        if not self.login():
            print("\n❌ Login failed. Cannot proceed with tests.")
            return False
        
        # Run all test suites
        self.test_asset_capitalization()
        self.test_batch_depreciation()
        self.test_accrual_module()
        self.test_phase7_regression()
        
        # Print summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        return self.tests_passed == self.tests_run


def main():
    # Get backend URL from environment
    import os
    backend_url = os.getenv("REACT_APP_BACKEND_URL", "https://repo-migration-guide.preview.emergentagent.com")
    
    print(f"Testing backend: {backend_url}")
    
    tester = Phase8Tester(backend_url)
    success = tester.run_all_tests()
    
    # Save results
    results = {
        "timestamp": datetime.now().isoformat(),
        "backend_url": backend_url,
        "total_tests": tester.tests_run,
        "passed_tests": tester.tests_passed,
        "failed_tests": tester.tests_run - tester.tests_passed,
        "success_rate": round(tester.tests_passed/tester.tests_run*100, 2) if tester.tests_run > 0 else 0,
        "test_results": tester.test_results
    }
    
    with open("/tmp/phase8_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n📄 Results saved to /tmp/phase8_test_results.json")
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
