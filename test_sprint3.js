const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cors = require('cors');

process.env.JWT_SECRET = 'test_jwt_secret_key_12345';
process.env.JWT_EXPIRES_IN = '1d';
process.env.NODE_ENV = 'test';
process.env.ANNUAL_INTEREST_RATE = '0.04'; // 4%

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const accountRoutes = require('./routes/account.routes');
const beneficiaryRoutes = require('./routes/beneficiary.routes');
const staffRoutes = require('./routes/staff.routes');
const transactionRoutes = require('./routes/transaction.routes');
const errorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/appError');
const User = require('./models/User');
const Account = require('./models/Account');
const Transaction = require('./models/Transaction');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/beneficiaries', beneficiaryRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/transactions', transactionRoutes);
app.all('*', (req, res, next) => next(new AppError(`Cannot find endpoint ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND')));
app.use(errorHandler);

let mongoServer;

const runTests = async () => {
  console.log('--- STARTING SPRINT 3 INTEGRATION TEST SUITE ---');
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  console.log('Connected to In-Memory MongoDB ReplicaSet');

  let passed = 0;
  let failed = 0;

  const assert = (condition, testName, actual = '') => {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} - Actual:`, actual);
      failed++;
    }
  };

  try {
    console.log('\n[TEST GROUP 1: SETUP TEST DATA]');
    // 1. Admin
    const admin = await User.create({
      name: 'Admin Boss',
      email: 'admin@bank.com',
      passwordHash: 'Admin@123',
      role: 'admin',
      kycStatus: 'approved'
    });
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@bank.com', password: 'Admin@123' });
    const adminToken = adminLogin.body.data.token;

    // 2. Staff
    const staff = await User.create({
      name: 'Staff Reviewer',
      email: 'staff@bank.com',
      passwordHash: 'Staff@123',
      role: 'staff',
      kycStatus: 'approved'
    });
    const staffLogin = await request(app).post('/api/auth/login').send({ email: 'staff@bank.com', password: 'Staff@123' });
    const staffToken = staffLogin.body.data.token;

    // 3. Customer Alice
    const alice = await User.create({
      name: 'Alice Customer',
      email: 'alice@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'approved'
    });
    const aliceLogin = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'Customer@123' });
    const aliceToken = aliceLogin.body.data.token;

    // 4. Customer Bob
    const bob = await User.create({
      name: 'Bob Customer',
      email: 'bob@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'approved'
    });
    const bobLogin = await request(app).post('/api/auth/login').send({ email: 'bob@example.com', password: 'Customer@123' });
    const bobToken = bobLogin.body.data.token;

    // Accounts
    // Alice Active Savings: 50,000
    const aliceSavings = await Account.create({
      userId: alice._id,
      accountNumber: '1011111111',
      type: 'savings',
      balance: 50000,
      status: 'active',
      dailyTransferLimit: 100000,
      minimumBalance: 1000
    });

    // Bob Active Savings: 20,000
    const bobSavings = await Account.create({
      userId: bob._id,
      accountNumber: '1022222222',
      type: 'savings',
      balance: 20000,
      status: 'active',
      dailyTransferLimit: 100000,
      minimumBalance: 1000
    });

    // Bob Active Current: 15,000
    const bobCurrent = await Account.create({
      userId: bob._id,
      accountNumber: '2033333333',
      type: 'current',
      balance: 15000,
      status: 'active',
      dailyTransferLimit: 100000,
      minimumBalance: 5000
    });

    // Pending Savings Account: 5,000
    const pendingSavings = await Account.create({
      userId: alice._id,
      accountNumber: '1044444444',
      type: 'savings',
      balance: 5000,
      status: 'pending',
      dailyTransferLimit: 50000,
      minimumBalance: 1000
    });

    assert(aliceToken && bobToken && staffToken && adminToken, 'All user tokens generated successfully');

    // ==========================================
    // MODULE 9: SUSPICIOUS TRANSACTIONS & REVIEW
    // ==========================================
    console.log('\n[TEST GROUP 2: TRANSFERS & SUSPICIOUS FLAGGING]');

    // Standard transfer (2,000) -> not flagged
    const normalTransfer = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        fromAccountId: aliceSavings._id,
        toAccountNumber: bobSavings.accountNumber,
        amount: 2000,
        description: 'Normal rent share'
      });
    assert(normalTransfer.status === 200, 'Normal transfer succeeds -> 200');
    assert(normalTransfer.body.data.transfer.flagged === false, 'Transfer <= 10000 is not flagged');

    // Suspicious transfer (15,000) -> flagged: true
    const suspiciousTransfer = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        fromAccountId: aliceSavings._id,
        toAccountNumber: bobSavings.accountNumber,
        amount: 15000,
        description: 'Large payment transfer'
      });
    assert(suspiciousTransfer.status === 200, 'Large transfer succeeds -> 200');
    assert(suspiciousTransfer.body.data.transfer.flagged === true, 'Transfer > 10000 flagged === true');
    const flaggedDebitTxId = suspiciousTransfer.body.data.debitTransaction._id;
    const flaggedCreditTxId = suspiciousTransfer.body.data.creditTransaction._id;

    console.log('\n[TEST GROUP 3: MODULE 9 - GET FLAGGED TRANSACTIONS]');

    // Customer access denied
    const custFlaggedRes = await request(app)
      .get('/api/staff/flagged-transactions')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(custFlaggedRes.status === 403, 'Customer GET /api/staff/flagged-transactions -> 403 Forbidden');
    assert(custFlaggedRes.body.errorCode === 'FORBIDDEN', 'Customer receives FORBIDDEN errorCode');

    // Staff access granted
    const staffFlaggedRes = await request(app)
      .get('/api/staff/flagged-transactions')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(staffFlaggedRes.status === 200, 'Staff GET /api/staff/flagged-transactions -> 200 OK');
    assert(staffFlaggedRes.body.success === true, 'Response success is true');
    assert(staffFlaggedRes.body.data.items.length === 2, 'Returns 2 flagged transactions (debit + credit)');
    assert(staffFlaggedRes.body.data.items.every(tx => tx.flagged === true), 'All returned transactions have flagged === true');
    assert(staffFlaggedRes.body.data.pagination.totalItems === 2, 'Pagination metadata totalItems === 2');

    // Pagination test
    const paginatedRes = await request(app)
      .get('/api/staff/flagged-transactions?page=1&limit=1')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(paginatedRes.status === 200, 'Pagination page=1&limit=1 -> 200 OK');
    assert(paginatedRes.body.data.items.length === 1, 'Limit=1 returns exactly 1 item');
    assert(paginatedRes.body.data.pagination.hasNextPage === true, 'hasNextPage === true');
    assert(paginatedRes.body.data.pagination.totalPages === 2, 'totalPages === 2');

    // Filter by accountId
    const accountFilterRes = await request(app)
      .get(`/api/staff/flagged-transactions?accountId=${aliceSavings._id}`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(accountFilterRes.status === 200, 'Filter by accountId -> 200 OK');
    assert(accountFilterRes.body.data.items.length === 1, 'Returns 1 flagged transaction for Alice');
    assert(accountFilterRes.body.data.items[0]._id.toString() === flaggedDebitTxId.toString(), 'Matches Alice debit tx');

    // Filter by Date range
    const todayStr = new Date().toISOString().split('T')[0];
    const dateFilterRes = await request(app)
      .get(`/api/staff/flagged-transactions?startDate=${todayStr}&endDate=${todayStr}`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(dateFilterRes.status === 200, 'Filter by date range -> 200 OK');
    assert(dateFilterRes.body.data.items.length === 2, 'Date filter includes today transactions');

    // Past date filter returning 0
    const pastDateRes = await request(app)
      .get('/api/staff/flagged-transactions?startDate=2020-01-01&endDate=2020-01-02')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(pastDateRes.status === 200, 'Past date filter -> 200 OK');
    assert(pastDateRes.body.data.items.length === 0, 'Past date returns 0 items');

    console.log('\n[TEST GROUP 4: MODULE 9 - REVIEW FLAGGED TRANSACTIONS]');

    // Staff reviews flagged transaction 1
    const reviewRes1 = await request(app)
      .put(`/api/staff/flagged-transactions/${flaggedDebitTxId}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ remarks: 'Verified legitimate business disbursement with customer' });
    assert(reviewRes1.status === 200, 'Staff reviews flagged transaction -> 200 OK');
    assert(reviewRes1.body.data.transaction.reviewed === true, 'Transaction reviewed is now true');
    assert(reviewRes1.body.data.transaction.reviewedBy._id.toString() === staff._id.toString(), 'reviewedBy is staff User ID');
    assert(reviewRes1.body.data.transaction.reviewNote === 'Verified legitimate business disbursement with customer', 'reviewNote is recorded');
    assert(reviewRes1.body.data.transaction.flagged === true, 'Original flag is preserved');

    // Admin reviews flagged transaction 2
    const reviewRes2 = await request(app)
      .put(`/api/staff/flagged-transactions/${flaggedCreditTxId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ remarks: 'Executive compliance clearance granted' });
    assert(reviewRes2.status === 200, 'Admin reviews flagged transaction -> 200 OK');
    assert(reviewRes2.body.data.transaction.reviewed === true, 'Transaction reviewed is true');
    assert(reviewRes2.body.data.transaction.reviewedBy._id.toString() === admin._id.toString(), 'reviewedBy is admin User ID');

    // Customer attempt review -> 403 Forbidden
    const custReviewRes = await request(app)
      .put(`/api/staff/flagged-transactions/${flaggedDebitTxId}/review`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ remarks: 'Self review attempt' });
    assert(custReviewRes.status === 403, 'Customer attempt review -> 403 Forbidden');

    // Review non-flagged transaction -> 409 Conflict
    const nonFlaggedTx = normalTransfer.body.data.debitTransaction._id;
    const reviewNonFlagged = await request(app)
      .put(`/api/staff/flagged-transactions/${nonFlaggedTx}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ remarks: 'Trying to review non-flagged' });
    assert(reviewNonFlagged.status === 409, 'Review non-flagged transaction -> 409 Conflict');
    assert(reviewNonFlagged.body.errorCode === 'CONFLICT', 'ErrorCode is CONFLICT');

    // Review non-existent transaction -> 404 Not Found
    const fakeId = new mongoose.Types.ObjectId();
    const reviewNotFound = await request(app)
      .put(`/api/staff/flagged-transactions/${fakeId}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ remarks: 'Missing tx' });
    assert(reviewNotFound.status === 404, 'Review non-existent transaction -> 404 Not Found');

    // Missing remarks validation -> 400
    const reviewNoRemarks = await request(app)
      .put(`/api/staff/flagged-transactions/${flaggedDebitTxId}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    assert(reviewNoRemarks.status === 400, 'Review without remarks -> 400 Bad Request');
    assert(reviewNoRemarks.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode is VALIDATION_ERROR');

    // ==========================================
    // MODULE 10: ACCOUNT FREEZE / UNFREEZE
    // ==========================================
    console.log('\n[TEST GROUP 5: MODULE 10 - ACCOUNT FREEZE & UNFREEZE]');

    // 1. Active -> Frozen succeeds
    const freezeRes = await request(app)
      .put(`/api/accounts/${aliceSavings._id}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Suspected AML activity' });
    assert(freezeRes.status === 200, 'Staff freeze active account -> 200 OK');
    assert(freezeRes.body.data.account.status === 'frozen', 'Account status transitions to frozen');
    assert(freezeRes.body.data.account.freezeReason === 'Suspected AML activity', 'Freeze reason is recorded');

    // 2. Frozen -> Frozen gives 409 Conflict
    const freezeAgainRes = await request(app)
      .put(`/api/accounts/${aliceSavings._id}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Freeze again' });
    assert(freezeAgainRes.status === 409, 'Freeze already frozen account -> 409 Conflict');
    assert(freezeAgainRes.body.errorCode === 'CONFLICT', 'ErrorCode is CONFLICT');

    // 3. Customer attempt freeze -> 403 Forbidden
    const custFreezeRes = await request(app)
      .put(`/api/accounts/${bobSavings._id}/freeze`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ reason: 'Customer prank' });
    assert(custFreezeRes.status === 403, 'Customer attempt freeze -> 403 Forbidden');

    // 4. Freeze non-existent account -> 404
    const freezeNonExist = await request(app)
      .put(`/api/accounts/${fakeId}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Fake account' });
    assert(freezeNonExist.status === 404, 'Freeze non-existent account -> 404 Not Found');

    // 5. Transfer from frozen account is rejected -> 409 Conflict
    const transferFromFrozen = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        fromAccountId: aliceSavings._id,
        toAccountNumber: bobSavings.accountNumber,
        amount: 500,
        description: 'Transfer while frozen'
      });
    assert(transferFromFrozen.status === 409, 'Transfer from frozen account -> 409 Conflict');
    assert(transferFromFrozen.body.errorCode === 'CONFLICT', 'ErrorCode is CONFLICT');

    // 6. Transfer to frozen account is rejected -> 409 Conflict
    const transferToFrozen = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({
        fromAccountId: bobSavings._id,
        toAccountNumber: aliceSavings.accountNumber,
        amount: 500,
        description: 'Transfer to frozen account'
      });
    assert(transferToFrozen.status === 409, 'Transfer to frozen account -> 409 Conflict');
    assert(transferToFrozen.body.errorCode === 'CONFLICT', 'ErrorCode is CONFLICT');

    // 7. Frozen -> Active unfreeze succeeds
    const unfreezeRes = await request(app)
      .put(`/api/accounts/${aliceSavings._id}/unfreeze`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(unfreezeRes.status === 200, 'Staff unfreeze frozen account -> 200 OK');
    assert(unfreezeRes.body.data.account.status === 'active', 'Account status transitions back to active');
    assert(unfreezeRes.body.data.account.freezeReason === null, 'Freeze reason is cleared');

    // 8. Active -> Active unfreeze gives 409 Conflict
    const unfreezeActiveRes = await request(app)
      .put(`/api/accounts/${aliceSavings._id}/unfreeze`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(unfreezeActiveRes.status === 409, 'Unfreeze already active account -> 409 Conflict');
    assert(unfreezeActiveRes.body.errorCode === 'CONFLICT', 'ErrorCode is CONFLICT');

    // 9. Customer attempt unfreeze -> 403 Forbidden
    const custUnfreezeRes = await request(app)
      .put(`/api/accounts/${aliceSavings._id}/unfreeze`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(custUnfreezeRes.status === 403, 'Customer attempt unfreeze -> 403 Forbidden');

    // ==========================================
    // MODULE 11: INTEREST CALCULATION JOB
    // ==========================================
    console.log('\n[TEST GROUP 6: MODULE 11 - INTEREST CALCULATION]');

    // Prepare specific accounts for interest testing:
    // 1. Re-freeze Alice's account to prove frozen accounts are skipped
    await request(app)
      .put(`/api/accounts/${aliceSavings._id}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Freeze for interest test' });

    // 2. Bob active savings (balance is 20000 + 2000 + 15000 = 37000)
    // Daily interest at 4%: (37000 * 0.04) / 365 = 4.05479 -> 4.05
    const bobBeforeInterest = await Account.findById(bobSavings._id);
    const bobExpectedInterest = Math.round(((bobBeforeInterest.balance * 0.04) / 365 + Number.EPSILON) * 100) / 100;

    // 3. Create zero-balance active savings account to verify zero interest skipped
    const zeroSavings = await Account.create({
      userId: bob._id,
      accountNumber: '1099999999',
      type: 'savings',
      balance: 0,
      status: 'active',
      dailyTransferLimit: 50000,
      minimumBalance: 0
    });

    // RBAC: Customer attempt -> 403
    const custInterestRes = await request(app)
      .post('/api/staff/run-interest-job')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(custInterestRes.status === 403, 'Customer POST /api/staff/run-interest-job -> 403 Forbidden');

    // RBAC: Staff attempt -> 403 (Admin only!)
    const staffInterestRes = await request(app)
      .post('/api/staff/run-interest-job')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(staffInterestRes.status === 403, 'Staff POST /api/staff/run-interest-job -> 403 Forbidden (Admin only)');

    // Admin runs interest job -> 200 OK
    const adminInterestRes = await request(app)
      .post('/api/staff/run-interest-job')
      .set('Authorization', `Bearer ${adminToken}`);
    assert(adminInterestRes.status === 200, 'Admin POST /api/staff/run-interest-job -> 200 OK');
    assert(adminInterestRes.body.success === true, 'Interest job execution success === true');
    const summary = adminInterestRes.body.data.summary;
    assert(summary.accountsProcessed === 2, 'accountsProcessed === 2 (Bob active savings + zero balance savings; Alice frozen excluded)');
    assert(summary.accountsCredited === 1, 'accountsCredited === 1 (Bob credited, zero balance skipped)');
    assert(summary.totalInterestCredited === bobExpectedInterest, `totalInterestCredited === ${bobExpectedInterest}`);

    // Verify Bob's account balance updated in DB
    const bobAfterInterest = await Account.findById(bobSavings._id);
    assert(bobAfterInterest.balance === bobBeforeInterest.balance + bobExpectedInterest, 'Bob balance credited correctly');

    // Verify Alice (frozen savings) balance was NOT changed
    const aliceAfterInterest = await Account.findById(aliceSavings._id);
    assert(aliceAfterInterest.balance === 33000, 'Alice (frozen savings) balance unchanged (no interest credited)');

    // Verify Bob's current account was NOT changed
    const currentAfterInterest = await Account.findById(bobCurrent._id);
    assert(currentAfterInterest.balance === 15000, 'Current account balance unchanged (not savings)');

    // Verify Pending savings account was NOT changed
    const pendingAfterInterest = await Account.findById(pendingSavings._id);
    assert(pendingAfterInterest.balance === 5000, 'Pending savings account balance unchanged (not active)');

    // Verify ledger entry created for Bob
    const interestLedgerTx = await Transaction.findOne({
      accountId: bobSavings._id,
      description: 'Daily interest credit'
    });
    assert(interestLedgerTx !== null, 'Interest credit transaction ledger entry created');
    assert(interestLedgerTx.type === 'credit', 'Ledger entry type === credit');
    assert(interestLedgerTx.amount === bobExpectedInterest, 'Ledger entry amount matches interest credited');
    assert(interestLedgerTx.balanceAfter === bobAfterInterest.balance, 'balanceAfter in ledger matches account balance');
    assert(interestLedgerTx.relatedAccount === null, 'relatedAccount is null');
    assert(interestLedgerTx.flagged === false, 'Interest transaction is not flagged');

    // Verify zero balance account has NO ledger entry
    const zeroLedgerTx = await Transaction.findOne({ accountId: zeroSavings._id });
    assert(zeroLedgerTx === null, 'Zero balance account has no ledger entries');

    // ==========================================
    // MODULE 12: STAFF DASHBOARD
    // ==========================================
    console.log('\n[TEST GROUP 7: MODULE 12 - STAFF DASHBOARD]');

    // Customer attempt -> 403 Forbidden
    const custDashboardRes = await request(app)
      .get('/api/staff/dashboard')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(custDashboardRes.status === 403, 'Customer GET /api/staff/dashboard -> 403 Forbidden');

    // Staff dashboard
    const staffDashboardRes = await request(app)
      .get('/api/staff/dashboard')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(staffDashboardRes.status === 200, 'Staff GET /api/staff/dashboard -> 200 OK');
    const dbData = staffDashboardRes.body.data;
    assert(typeof dbData.pendingAccountApprovals === 'number', 'pendingAccountApprovals is a number');
    assert(dbData.pendingAccountApprovals === 1, 'pendingAccountApprovals === 1 (pendingSavings)');
    assert(dbData.frozenAccounts === 1, 'frozenAccounts === 1 (aliceSavings is currently frozen)');
    assert(dbData.unreviewedFlaggedTransactions === 0, 'unreviewedFlaggedTransactions === 0 (both flagged were reviewed earlier)');
    assert(Array.isArray(dbData.recentTransactions), 'recentTransactions is an array');
    assert(dbData.recentTransactions.length <= 10, 'recentTransactions length <= 10');
    assert(dbData.recentTransactions.length > 0, 'recentTransactions contains transactions');

    // Admin dashboard
    const adminDashboardRes = await request(app)
      .get('/api/staff/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    assert(adminDashboardRes.status === 200, 'Admin GET /api/staff/dashboard -> 200 OK');

    console.log('\n=============================================');
    console.log(`SPRINT 3 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('=============================================\n');

    await mongoose.disconnect();
    await mongoServer.stop();

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    process.exit(1);
  }
};

runTests();
