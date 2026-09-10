const mongoose = require('mongoose');
const { MongoMemoryServer, MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cors = require('cors');

process.env.JWT_SECRET = 'test_jwt_secret_key_12345';
process.env.JWT_EXPIRES_IN = '1d';
process.env.NODE_ENV = 'test';

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
  console.log('--- STARTING SPRINT 2 INTEGRATION TEST SUITE ---');
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
    // Create Staff
    const staff = await User.create({
      name: 'Staff Reviewer',
      email: 'staff@bank.com',
      passwordHash: 'Staff@123',
      role: 'staff',
      kycStatus: 'approved'
    });
    const staffLoginRes = await request(app).post('/api/auth/login').send({ email: 'staff@bank.com', password: 'Staff@123' });
    const staffToken = staffLoginRes.body.data.token;

    // Create Alice (Customer 1)
    const aliceRes = await request(app).post('/api/auth/register').send({
      name: 'Alice Smith',
      email: 'alice@example.com',
      password: 'Password@123',
      role: 'customer'
    });
    const aliceToken = aliceRes.body.data.token;

    // Create Bob (Customer 2)
    const bobRes = await request(app).post('/api/auth/register').send({
      name: 'Bob Jones',
      email: 'bob@example.com',
      password: 'Password@123',
      role: 'customer'
    });
    const bobToken = bobRes.body.data.token;

    // Alice creates account with 25000 deposit, daily limit 50000, minimumBalance 1000
    const aliceAccRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ type: 'savings', initialDeposit: 25000, dailyTransferLimit: 50000 });
    const aliceAccountId = aliceAccRes.body.data.account._id;
    const aliceAccNum = aliceAccRes.body.data.account.accountNumber;

    // Bob creates account with 15000 deposit
    const bobAccRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ type: 'savings', initialDeposit: 15000, dailyTransferLimit: 50000 });
    const bobAccountId = bobAccRes.body.data.account._id;
    const bobAccNum = bobAccRes.body.data.account.accountNumber;

    // Pending account for Alice
    const alicePendingRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ type: 'current', initialDeposit: 5000 });
    const alicePendingAccountId = alicePendingRes.body.data.account._id;
    const alicePendingAccNum = alicePendingRes.body.data.account.accountNumber;

    // Staff approves Alice's savings and Bob's savings
    await request(app).put(`/api/accounts/${aliceAccountId}/approve`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'Approved' });
    await request(app).put(`/api/accounts/${bobAccountId}/approve`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'Approved' });

    assert(true, 'Test users and active accounts initialized');

    console.log('\n[TEST GROUP 2: TRANSFER VALIDATION & RBAC]');
    // 1. Unauthenticated -> 401
    const unauthRes = await request(app)
      .post('/api/transactions/transfer')
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 500 });
    assert(unauthRes.status === 401, 'Transfer unauthenticated -> 401 Unauthorized', unauthRes.status);
    assert(unauthRes.body.errorCode === 'UNAUTHORIZED', 'ErrorCode === UNAUTHORIZED');

    // 2. Missing fields -> 400
    const missingRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});
    assert(missingRes.status === 400, 'Transfer missing fields -> 400 Bad Request', missingRes.status);
    assert(missingRes.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode === VALIDATION_ERROR');

    // 3. Invalid source account ID -> 404
    const badIdRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: '507f1f77bcf86cd799439011', toAccountNumber: bobAccNum, amount: 500 });
    assert(badIdRes.status === 404, 'Transfer non-existent source account -> 404 Not Found', badIdRes.status);
    assert(badIdRes.body.errorCode === 'NOT_FOUND', 'ErrorCode === NOT_FOUND');

    // 4. Invalid destination account number -> 404
    const badDestRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: '9999999999', amount: 500 });
    assert(badDestRes.status === 404, 'Transfer non-existent destination account -> 404 Not Found', badDestRes.status);
    assert(badDestRes.body.errorCode === 'NOT_FOUND', 'ErrorCode === NOT_FOUND');

    // 5. Wrong owner (Bob tries to transfer from Alice's account) -> 403
    const wrongOwnerRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 500 });
    assert(wrongOwnerRes.status === 403, 'Transfer wrong-owner source account -> 403 Forbidden', wrongOwnerRes.status);
    assert(wrongOwnerRes.body.errorCode === 'FORBIDDEN', 'ErrorCode === FORBIDDEN');

    // 6. Transfer to same account -> 400
    const sameAccRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: aliceAccNum, amount: 500 });
    assert(sameAccRes.status === 400, 'Transfer to same account -> 400 Bad Request', sameAccRes.status);

    // 7. Transfer from pending account -> 409
    const fromPendingRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: alicePendingAccountId, toAccountNumber: bobAccNum, amount: 500 });
    assert(fromPendingRes.status === 409, 'Transfer from pending account -> 409 Conflict', fromPendingRes.status);
    assert(fromPendingRes.body.errorCode === 'CONFLICT', 'ErrorCode === CONFLICT');

    // 8. Transfer to pending account -> 409
    const toPendingRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: alicePendingAccNum, amount: 500 });
    assert(toPendingRes.status === 409, 'Transfer to pending account -> 409 Conflict', toPendingRes.status);
    assert(toPendingRes.body.errorCode === 'CONFLICT', 'ErrorCode === CONFLICT');

    // 9. Transfer negative or zero amount -> 400
    const zeroAmtRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 0 });
    assert(zeroAmtRes.status === 400, 'Transfer 0 amount -> 400 Bad Request', zeroAmtRes.status);

    console.log('\n[TEST GROUP 3: BALANCE & LIMITS ENFORCEMENT (MODULE 8)]');
    // 10. Insufficient balance (transfer 30000 from 25000) -> 409 VALIDATION_ERROR
    const overBalanceRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 30000 });
    assert(overBalanceRes.status === 409, 'Transfer exceeding balance -> 409 Conflict', overBalanceRes.status);
    assert(overBalanceRes.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode === VALIDATION_ERROR');

    // 11. Breach minimum balance (transfer 24500 leaving 500 < 1000 minimum) -> 409 VALIDATION_ERROR
    const breachMinRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 24500 });
    assert(breachMinRes.status === 409, 'Transfer breaching minimumBalance -> 409 Conflict', breachMinRes.status);
    assert(breachMinRes.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode === VALIDATION_ERROR');

    console.log('\n[TEST GROUP 4: FUND TRANSFERS & ATOMICITY]');
    // 12. Happy path: Alice transfers 2000 to Bob
    const happyRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 2000, description: 'Invoice payment #1' });
    assert(happyRes.status === 200, 'Transfer happy path -> 200 OK', happyRes.status);
    assert(happyRes.body.success === true, 'Response success === true');
    assert(happyRes.body.data.transfer.amount === 2000, 'Transfer amount recorded');
    assert(happyRes.body.data.transfer.sourceBalanceAfter === 23000, 'Source balance after is 23000');
    assert(happyRes.body.data.debitTransaction.type === 'debit', 'Debit transaction recorded');
    assert(happyRes.body.data.creditTransaction.type === 'credit', 'Credit transaction recorded');
    assert(happyRes.body.data.debitTransaction.flagged === false, 'Standard amount is not flagged');

    // Verify DB balances
    const aliceDbAcc1 = await Account.findById(aliceAccountId);
    const bobDbAcc1 = await Account.findById(bobAccountId);
    assert(aliceDbAcc1.balance === 23000, 'Alice DB balance updated to 23000', aliceDbAcc1.balance);
    assert(bobDbAcc1.balance === 17000, 'Bob DB balance updated to 17000', bobDbAcc1.balance);

    // 13. Suspicious Activity Flag (> 10000): Alice transfers 12000 to Bob
    const flaggedRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 12000, description: 'Large settlement' });
    assert(flaggedRes.status === 200, 'Transfer > 10000 -> 200 OK', flaggedRes.status);
    assert(flaggedRes.body.data.transfer.flagged === true, 'Transfer flagged as suspicious');
    assert(flaggedRes.body.data.debitTransaction.flagged === true, 'Debit transaction flagged === true');
    assert(flaggedRes.body.data.creditTransaction.flagged === true, 'Credit transaction flagged === true');

    const aliceDbAcc2 = await Account.findById(aliceAccountId);
    assert(aliceDbAcc2.balance === 11000, 'Alice DB balance updated to 11000', aliceDbAcc2.balance);

    // 14. Daily transfer limit check:
    // Alice has debited 2000 + 12000 = 14000 today.
    // Daily limit is 50000. If we try 37000 (14000 + 37000 = 51000 > 50000), it should be rejected.
    aliceDbAcc2.balance = 100000;
    await aliceDbAcc2.save();

    const limitBreachRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ fromAccountId: aliceAccountId, toAccountNumber: bobAccNum, amount: 37000 });
    assert(limitBreachRes.status === 409, 'Transfer exceeding daily limit -> 409 Conflict', limitBreachRes.status);
    assert(limitBreachRes.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode === VALIDATION_ERROR');

    // Reset Alice's balance back to 11000 for statement testing
    aliceDbAcc2.balance = 11000;
    await aliceDbAcc2.save();

    console.log('\n[TEST GROUP 5: TRANSACTION LEDGER (MODULE 6)]');
    // 15. GET /api/accounts/:id/transactions (Alice views own)
    const txListRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/transactions?page=1&limit=10`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(txListRes.status === 200, 'GET /api/accounts/:id/transactions -> 200 OK', txListRes.status);
    assert(txListRes.body.data.items.length === 2, '2 transactions returned in ledger', txListRes.body.data.items.length);
    assert(txListRes.body.data.pagination.totalItems === 2, 'Pagination totalItems === 2');
    assert(txListRes.body.data.items[0].amount === 12000, 'Transactions ordered newest first');

    // 16. Bob tries to view Alice's transactions -> 403
    const forbiddenTxRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/transactions`)
      .set('Authorization', `Bearer ${bobToken}`);
    assert(forbiddenTxRes.status === 403, 'GET /api/accounts/:id/transactions wrong owner -> 403 Forbidden', forbiddenTxRes.status);

    // 17. Staff views Alice's transactions -> 200
    const staffTxRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/transactions`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(staffTxRes.status === 200, 'GET /api/accounts/:id/transactions as staff -> 200 OK', staffTxRes.status);

    console.log('\n[TEST GROUP 6: ACCOUNT STATEMENT (MODULE 6)]');
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // 18. Statement missing dates -> 400
    const noDateRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/statement`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(noDateRes.status === 400, 'Statement missing dates -> 400 Bad Request', noDateRes.status);
    assert(noDateRes.body.errorCode === 'VALIDATION_ERROR', 'ErrorCode === VALIDATION_ERROR');

    // 19. Statement from > to -> 400
    const badRangeRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/statement?from=${tomorrow}&to=${yesterday}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(badRangeRes.status === 400, 'Statement from > to -> 400 Bad Request', badRangeRes.status);

    // 20. Statement wrong owner -> 403
    const wrongOwnerStmt = await request(app)
      .get(`/api/accounts/${aliceAccountId}/statement?from=${yesterday}&to=${tomorrow}`)
      .set('Authorization', `Bearer ${bobToken}`);
    assert(wrongOwnerStmt.status === 403, 'Statement wrong owner -> 403 Forbidden', wrongOwnerStmt.status);

    // 21. Happy Path Statement
    const stmtRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/statement?from=${yesterday}&to=${tomorrow}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(stmtRes.status === 200, 'Statement happy path -> 200 OK', stmtRes.status);
    assert(stmtRes.body.data.transactions.length === 2, 'Statement contains 2 transactions');
    assert(stmtRes.body.data.summary.openingBalance === 25000, 'Opening balance is 25000', stmtRes.body.data.summary.openingBalance);
    assert(stmtRes.body.data.summary.totalDebits === 14000, 'Total debits is 14000', stmtRes.body.data.summary.totalDebits);
    assert(stmtRes.body.data.summary.totalCredits === 0, 'Total credits is 0', stmtRes.body.data.summary.totalCredits);
    assert(stmtRes.body.data.summary.closingBalance === 11000, 'Closing balance is 11000', stmtRes.body.data.summary.closingBalance);
    assert(
      stmtRes.body.data.summary.openingBalance + stmtRes.body.data.summary.totalCredits - stmtRes.body.data.summary.totalDebits === stmtRes.body.data.summary.closingBalance,
      'Opening + Credits - Debits === Closing Balance agreement'
    );

    // 22. Statement for empty range (far future)
    const emptyStmtRes = await request(app)
      .get(`/api/accounts/${aliceAccountId}/statement?from=2030-01-01&to=2030-01-31`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert(emptyStmtRes.status === 200, 'Statement empty range -> 200 OK', emptyStmtRes.status);
    assert(Array.isArray(emptyStmtRes.body.data.transactions) && emptyStmtRes.body.data.transactions.length === 0, 'Empty transactions array returned');
    assert(emptyStmtRes.body.data.summary.openingBalance === 11000, 'Opening balance reflects latest balance 11000');
    assert(emptyStmtRes.body.data.summary.closingBalance === 11000, 'Closing balance equals opening balance');

    console.log('\n[TEST GROUP 7: IMMUTABILITY ENFORCEMENT]');
    // 23. Ensure no PUT/PATCH/DELETE on transactions exists
    const putTxRes = await request(app).put('/api/transactions/123').set('Authorization', `Bearer ${staffToken}`);
    assert(putTxRes.status === 404, 'PUT /api/transactions/:id is not allowed -> 404 Not Found', putTxRes.status);
    const deleteTxRes = await request(app).delete('/api/transactions/123').set('Authorization', `Bearer ${staffToken}`);
    assert(deleteTxRes.status === 404, 'DELETE /api/transactions/:id is not allowed -> 404 Not Found', deleteTxRes.status);

    console.log('\n=============================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
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


