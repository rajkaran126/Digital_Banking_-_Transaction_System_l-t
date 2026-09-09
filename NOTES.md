# P10 Digital Banking System — Engineering Notes & RBAC Audit

This document records the architectural findings, Role-Based Access Control (RBAC) audit, teammate code reviews, and test suite discrepancies identified during the implementation of Sprint 3.

---

## 1. Teammate Implementation Audits

### 1.1 Sprint 2 Transfer Engine & Frozen Account Validation
- **Location**: [`controllers/transaction.controller.js`](file:///c:/Users/Krupa/Digital_Banking_-_Transaction_System_l-t/Digital_Banking_-_Transaction_System_l-t/controllers/transaction.controller.js#L68-L86)
- **Status**: Verified compliant.
- **Details**:
  - The transfer engine checks the status of both source (`fromAccount`) and destination (`toAccount`) accounts:
    ```javascript
    if (fromAccount.status !== 'active') {
      return next(new AppError("Source account cannot execute transfers...", 409, 'CONFLICT'));
    }
    if (toAccount.status !== 'active') {
      return next(new AppError("Destination account cannot receive transfers...", 409, 'CONFLICT'));
    }
    ```
  - It re-verifies `sourceInSession.status !== 'active' || destInSession.status !== 'active'` inside the atomic MongoDB transaction session (lines 170–172).
  - Consequently, frozen accounts (`status === 'frozen'`) are automatically rejected from executing or receiving fund transfers with HTTP 409 Conflict.
  - Per project instructions, **no modifications were made** to Member 2's transfer controller.

### 1.2 Outdated Stub Expectations in Foundation Test Suite
- **Location**: [`test_foundation.js`](file:///c:/Users/Krupa/Digital_Banking_-_Transaction_System_l-t/Digital_Banking_-_Transaction_System_l-t/test_foundation.js#L330-L345)
- **Issue**:
  - In `test_foundation.js` (authored during Sprint 1), Test Group 5 asserts that `POST /api/transactions/transfer` and `GET /api/accounts/:id/statement` return HTTP 501 Not Implemented.
  - However, in Sprint 2, Member 2 implemented real transfer and statement handlers with Joi and query validation. As a result, calling those routes with empty dummy payloads now produces HTTP 400 `VALIDATION_ERROR`, causing two assertion failures in `test_foundation.js`.
- **Recommendation**:
  - Update `test_foundation.js` or separate foundation tests from legacy stub assertions now that Sprint 2 and Sprint 3 are fully operational.
  - `test_sprint2.js` (60/60 tests pass) and `test_sprint3.js` (82/82 tests pass) accurately validate the live endpoints.

### 1.3 Beneficiary Deletion Null Check Semantic Nuance
- **Location**: [`controllers/beneficiary.controller.js`](file:///c:/Users/Krupa/Digital_Banking_-_Transaction_System_l-t/Digital_Banking_-_Transaction_System_l-t/controllers/beneficiary.controller.js#L178-L188)
- **Observation**:
  - `deleteBeneficiary` retrieves `parentAccount = await Account.findById(beneficiary.accountId)`.
  - If `parentAccount` is null (e.g. if the parent account was purged from the database), the check evaluates:
    ```javascript
    if (req.user.role === 'customer' && (!parentAccount || parentAccount.userId.toString() !== req.user._id.toString()))
    ```
    and yields HTTP 403 `FORBIDDEN`.
  - While this is completely secure (it prevents any unauthorized deletion), a 404 `NOT_FOUND` would be more semantically descriptive if the parent account no longer exists.
  - Controller left intact per teammate code preservation guidelines.

---

## 2. Comprehensive RBAC & Ownership Audit

Every route across the application was audited for authentication (`protect`), role-level authorization (`restrictTo`), and resource-level ownership verification.

| Route | Method | Authentication Required | Required Role(s) | Resource Ownership Verification | Audit Status |
|---|---|---|---|---|---|
| `/api/auth/register` | `POST` | No | Public | N/A (Creates new user entity) | Compliant |
| `/api/auth/login` | `POST` | No | Public | N/A (Authenticates credentials) | Compliant |
| `/api/users/me` | `GET` | Yes (`protect`) | Any authenticated (`customer`, `staff`, `admin`) | Yes — controller queries `req.user._id` directly | Compliant |
| `/api/users/me` | `PUT` | Yes (`protect`) | Any authenticated (`customer`, `staff`, `admin`) | Yes — controller updates `req.user._id` directly | Compliant |
| `/api/accounts` | `POST` | Yes (`protect`) | Any authenticated | Yes — assigns `userId: req.user._id` | Compliant |
| `/api/accounts` | `GET` | Yes (`protect`) | Any authenticated | Yes — customers receive only `{ userId: req.user._id }`; staff/admin receive paginated all | Compliant |
| `/api/accounts/:id` | `GET` | Yes (`protect`) | Owner customer, Staff, Admin | Yes — explicitly validates `account.userId._id === req.user._id` for customers | Compliant |
| `/api/accounts/:id/approve` | `PUT` | Yes (`protect`) | `staff`, `admin` | N/A (Staff administrative approval action) | Compliant |
| `/api/accounts/:id/transactions` | `GET` | Yes (`protect`) | Owner customer, Staff, Admin | Yes — explicitly validates `account.userId === req.user._id` for customers | Compliant |
| `/api/accounts/:id/statement` | `GET` | Yes (`protect`) | Owner customer, Staff, Admin | Yes — explicitly validates `account.userId === req.user._id` for customers | Compliant |
| `/api/accounts/:id/freeze` | `PUT` | Yes (`protect`) | `staff`, `admin` | N/A (Compliance / Administrative freeze action) | Compliant |
| `/api/accounts/:id/unfreeze` | `PUT` | Yes (`protect`) | `staff`, `admin` | N/A (Compliance / Administrative unfreeze action) | Compliant |
| `/api/beneficiaries` | `POST` | Yes (`protect`) | Customer (Owner) | Yes — verifies `sourceAccount.userId === req.user._id` | Compliant |
| `/api/beneficiaries` | `GET` | Yes (`protect`) | Any authenticated | Yes — customers only see beneficiaries under their owned accounts; staff/admin see all | Compliant |
| `/api/beneficiaries/:id` | `DELETE` | Yes (`protect`) | Owner customer, Staff, Admin | Yes — verifies parent account ownership for customers | Compliant |
| `/api/transactions/transfer` | `POST` | Yes (`protect`) | Customer (Owner) | Yes — verifies `fromAccount.userId === req.user._id` | Compliant |
| `/api/staff/pending-accounts` | `GET` | Yes (`protect`) | `staff`, `admin` | N/A (Staff queue) | Compliant |
| `/api/staff/flagged-transactions` | `GET` | Yes (`protect`) | `staff`, `admin` | N/A (Compliance queue) | Compliant |
| `/api/staff/flagged-transactions/:id/review` | `PUT` | Yes (`protect`) | `staff`, `admin` | N/A (Staff compliance review action) | Compliant |
| `/api/staff/run-interest-job` | `POST` | Yes (`protect`) | `admin` strictly | N/A (Executive batch trigger) | Compliant |
| `/api/staff/dashboard` | `GET` | Yes (`protect`) | `staff`, `admin` | N/A (Aggregated system-wide analytics) | Compliant |

---

## 3. Sprint 3 Architectural Decisions & Conventions

1. **Schema Migration Safety**:
   - Added optional fields `reviewed` (Boolean, default `false`, indexed), `reviewedBy` (ObjectId ref User, default `null`), and `reviewNote` (String, default `null`) to `models/Transaction.js`.
   - Added optional field `freezeReason` (String, default `null`) to `models/Account.js`.
   - No existing fields were renamed, modified, or deleted. All existing documents continue to validate and query without migration scripts.
2. **Interest Calculation Engine**:
   - Callable service implemented in [`services/interest.service.js`](file:///c:/Users/Krupa/Digital_Banking_-_Transaction_System_l-t/Digital_Banking_-_Transaction_System_l-t/services/interest.service.js).
   - Daily interest calculated using simple interest: `dailyInterest = (balance * annualInterestRate) / 365`.
   - Strictly targets accounts with `type: 'savings'` and `status: 'active'`. Frozen, pending, closed, and current accounts are excluded.
   - Atomicity achieved using the exact same pattern as Sprint 2 transfers (`session.withTransaction` with standalone fallback).
   - Zero-balance accounts or interest amounts `< 0.01` produce no ledger entries.
3. **Staff Dashboard Performance**:
   - Utilizes parallel MongoDB `$facet` aggregation pipelines across `Account` and `Transaction` collections to extract pending approvals, frozen account counts, unreviewed flagged counts, and the 10 most recent transactions without redundant query roundtrips.
