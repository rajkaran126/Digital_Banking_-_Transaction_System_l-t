const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cors = require('cors');

process.env.JWT_SECRET = 'journey_jwt_secret_98765';
process.env.JWT_EXPIRES_IN = '1d';
process.env.NODE_ENV = 'test';
process.env.ANNUAL_INTEREST_RATE = '0.04';

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

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/beneficiaries', beneficiaryRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/transactions', transactionRoutes);
app.all('*', (req, res, next) => next(new AppError(`Cannot find endpoint ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND')));
app.use(errorHandler);

const runUserJourney = async () => {
  console.log('===============================================================');
  console.log('--- EXECUTING SPRINT 3 FULL USER JOURNEY (STEPS 1 TO 16) ---');
  console.log('===============================================================\n');

  const mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());

  let step = 1;
  const logStep = (title) => console.log(`\n[STEP ${step++}]: ${title}`);

  try {
    // Pre-create Staff & Admin
    await User.create({
      name: 'Pooja Staff',
      email: 'staff@bank.com',
      passwordHash: 'Staff@123',
      role: 'staff',
      kycStatus: 'approved'
    });
    const staffLogin = await request(app).post('/api/auth/login').send({ email: 'staff@bank.com', password: 'Staff@123' });
    const staffToken = staffLogin.body.data.token;

    await User.create({
      name: 'Rajesh Admin',
      email: 'admin@bank.com',
      passwordHash: 'Admin@123',
      role: 'admin',
      kycStatus: 'approved'
    });
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@bank.com', password: 'Admin@123' });
    const adminToken = adminLogin.body.data.token;

    // STEP 1: Customer registration / onboarding
    logStep('Customer registration/onboarding');
    const regRes = await request(app).post('/api/auth/register').send({
      name: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      password: 'Password@123',
      role: 'customer',
      phone: '+91-98123-45678'
    });
    if (regRes.status !== 201) throw new Error(`Registration failed: ${regRes.body.message}`);
    const customerToken = regRes.body.data.token;
    console.log('  -> Customer registered successfully. User ID:', regRes.body.data.user.id);

    // Also register Recipient customer
    const regRes2 = await request(app).post('/api/auth/register').send({
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      password: 'Password@123',
      role: 'customer',
      phone: '+91-98234-56789'
    });
    const priyaToken = regRes2.body.data.token;

    // STEP 2: Account creation
    logStep('Account creation (Savings)');
    const accRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ type: 'savings', initialDeposit: 50000, dailyTransferLimit: 100000 });
    if (accRes.status !== 201) throw new Error(`Account creation failed: ${accRes.body.message}`);
    const accountId = accRes.body.data.account._id;
    const accountNumber = accRes.body.data.account.accountNumber;
    console.log(`  -> Account created: ${accountNumber} (Status: ${accRes.body.data.account.status}, Balance: ₹50,000)`);

    // Create Priya's account
    const priyaAccRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${priyaToken}`)
      .send({ type: 'savings', initialDeposit: 10000, dailyTransferLimit: 100000 });
    const priyaAccountId = priyaAccRes.body.data.account._id;
    const priyaAccountNumber = priyaAccRes.body.data.account.accountNumber;

    // STEP 3: Staff approval
    logStep('Staff approval of accounts');
    const approveRes = await request(app)
      .put(`/api/accounts/${accountId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'Approved', remarks: 'KYC verified and account activated' });
    if (approveRes.status !== 200) throw new Error(`Staff approval failed: ${approveRes.body.message}`);
    console.log(`  -> Rohan's account ${accountNumber} approved (Status: ${approveRes.body.data.account.status})`);

    await request(app)
      .put(`/api/accounts/${priyaAccountId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'Approved', remarks: 'KYC verified' });
    console.log(`  -> Priya's account ${priyaAccountNumber} approved`);

    // STEP 4: Fund transfer (standard below threshold)
    logStep('Standard Fund transfer (₹3,000)');
    const transfer1Res = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fromAccountId: accountId,
        toAccountNumber: priyaAccountNumber,
        amount: 3000,
        description: 'Standard payment'
      });
    if (transfer1Res.status !== 200) throw new Error(`Transfer failed: ${transfer1Res.body.message}`);
    console.log('  -> Transfer completed. Flagged:', transfer1Res.body.data.transfer.flagged);

    // STEP 5: Make a transfer that crosses the suspicious-amount threshold (> ₹10,000)
    logStep('Suspicious-amount transfer crossing threshold (₹25,000 > ₹10,000)');
    const transfer2Res = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fromAccountId: accountId,
        toAccountNumber: priyaAccountNumber,
        amount: 25000,
        description: 'Large supplier advance'
      });
    if (transfer2Res.status !== 200) throw new Error(`Suspicious transfer failed: ${transfer2Res.body.message}`);

    // STEP 6: Confirm the resulting transaction has flagged === true
    logStep('Confirm the resulting transaction has flagged === true');
    const flaggedDebitTx = transfer2Res.body.data.debitTransaction;
    if (!flaggedDebitTx.flagged) throw new Error('Transaction was NOT flagged!');
    console.log(`  -> Debit Transaction ID ${flaggedDebitTx._id} has flagged: ${flaggedDebitTx.flagged}`);

    // STEP 7: Staff retrieves flagged transactions
    logStep('Staff retrieves flagged transactions');
    const flaggedListRes = await request(app)
      .get('/api/staff/flagged-transactions')
      .set('Authorization', `Bearer ${staffToken}`);
    if (flaggedListRes.status !== 200) throw new Error(`Retrieve flagged failed: ${flaggedListRes.body.message}`);
    console.log(`  -> Found ${flaggedListRes.body.data.items.length} flagged transaction(s) in system.`);

    // STEP 8: Staff reviews the flagged transaction
    logStep('Staff reviews the flagged transaction');
    const reviewRes = await request(app)
      .put(`/api/staff/flagged-transactions/${flaggedDebitTx._id}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ remarks: 'Transaction flagged for AML review; verified invoice provided' });
    if (reviewRes.status !== 200) throw new Error(`Review failed: ${reviewRes.body.message}`);
    const reviewedTx = reviewRes.body.data.transaction;
    console.log(`  -> Reviewed: ${reviewedTx.reviewed}, ReviewedBy: ${reviewedTx.reviewedBy?.name || reviewedTx.reviewedBy}, Note: "${reviewedTx.reviewNote}"`);

    // STEP 9: Staff freezes the account
    logStep('Staff freezes the account');
    const freezeRes = await request(app)
      .put(`/api/accounts/${accountId}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Investigation pending on high-value transaction flow' });
    if (freezeRes.status !== 200) throw new Error(`Freeze failed: ${freezeRes.body.message}`);
    console.log(`  -> Account ${accountNumber} status: ${freezeRes.body.data.account.status}, Reason: "${freezeRes.body.data.account.freezeReason}"`);

    // STEP 10: Attempt transfer from frozen account and confirm it is rejected
    logStep('Attempt transfer from frozen account and confirm rejection (409 Conflict)');
    const frozenTxRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fromAccountId: accountId,
        toAccountNumber: priyaAccountNumber,
        amount: 1000,
        description: 'Attempt while frozen'
      });
    if (frozenTxRes.status !== 409) throw new Error(`Expected 409 Conflict, got ${frozenTxRes.status}`);
    console.log(`  -> Transfer properly blocked with HTTP 409: "${frozenTxRes.body.message}"`);

    // STEP 11: Run the interest job
    logStep('Run the interest job via Admin endpoint');
    const interestJobRes = await request(app)
      .post('/api/staff/run-interest-job')
      .set('Authorization', `Bearer ${adminToken}`);
    if (interestJobRes.status !== 200) throw new Error(`Interest job failed: ${interestJobRes.body.message}`);
    const summary = interestJobRes.body.data.summary;
    console.log('  -> Interest Job Summary:', JSON.stringify(summary));

    // STEP 12: Confirm the frozen account is skipped
    logStep("Confirm Rohan's frozen account was skipped from receiving interest");
    const rohanAcc = await Account.findById(accountId);
    // Rohan started with 50,000 - 3,000 - 25,000 = 22,000
    if (rohanAcc.balance !== 22000) throw new Error(`Frozen account balance altered! Found: ${rohanAcc.balance}`);
    console.log(`  -> Rohan's account balance strictly maintained at ₹${rohanAcc.balance} (No interest credited)`);

    // STEP 13: Confirm active savings accounts receive interest
    logStep("Confirm Priya's active savings account received interest");
    const priyaAcc = await Account.findById(priyaAccountId);
    // Priya started with 10,000 + 3,000 + 25,000 = 38,000
    // Expected interest: (38000 * 0.04) / 365 = 4.16438 -> 4.16
    const expectedPriyaInterest = 4.16;
    if (priyaAcc.balance !== 38000 + expectedPriyaInterest) {
      throw new Error(`Priya's active savings balance mismatch! Found: ${priyaAcc.balance}, Expected: ${38000 + expectedPriyaInterest}`);
    }
    console.log(`  -> Priya's balance updated from ₹38,000 to ₹${priyaAcc.balance} (+₹${expectedPriyaInterest} interest)`);

    // STEP 14: Confirm corresponding ledger entries exist
    logStep('Confirm corresponding ledger entries exist for interest credit');
    const interestLedger = await Transaction.findOne({
      accountId: priyaAccountId,
      description: 'Daily interest credit'
    });
    if (!interestLedger) throw new Error('Interest ledger entry not found!');
    console.log(`  -> Found ledger record: ID ${interestLedger._id}, Type: ${interestLedger.type}, Amount: ₹${interestLedger.amount}, BalanceAfter: ₹${interestLedger.balanceAfter}`);

    // STEP 15: Open the staff dashboard
    logStep('Open the staff dashboard');
    const dashboardRes = await request(app)
      .get('/api/staff/dashboard')
      .set('Authorization', `Bearer ${staffToken}`);
    if (dashboardRes.status !== 200) throw new Error(`Dashboard retrieval failed: ${dashboardRes.body.message}`);
    const dData = dashboardRes.body.data;

    // STEP 16: Confirm dashboard reflects expected counts & recent transactions
    logStep('Confirm dashboard reflects pending approvals, unreviewed flagged, frozen accounts, and recent transactions');
    console.log('  -> Dashboard Metrics:');
    console.log(`     - Pending Account Approvals:      ${dData.pendingAccountApprovals}`);
    console.log(`     - Unreviewed Flagged Transactions: ${dData.unreviewedFlaggedTransactions}`);
    console.log(`     - Frozen Accounts:                 ${dData.frozenAccounts}`);
    console.log(`     - Recent Transactions Count:       ${dData.recentTransactions.length}`);

    if (dData.frozenAccounts !== 1) throw new Error(`Expected 1 frozen account, got ${dData.frozenAccounts}`);
    if (dData.recentTransactions.length === 0) throw new Error('Expected recent transactions array to contain records');

    console.log('\n===============================================================');
    console.log('  ✓ FULL USER JOURNEY COMPLETED SUCCESSFULLY (16/16 STEPS PASS)!');
    console.log('===============================================================\n');

    await mongoose.disconnect();
    await mongoServer.stop();
    process.exit(0);
  } catch (err) {
    console.error('\n✗ USER JOURNEY FAILED AT STEP:', err.message);
    await mongoose.disconnect();
    await mongoServer.stop();
    process.exit(1);
  }
};

runUserJourney();
