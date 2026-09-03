const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cors = require('cors');

// Set dummy JWT secret for test
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

// Create test express app
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
  console.log('--- STARTING COMPREHENSIVE FOUNDATION TEST SUITE ---');
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  console.log('Connected to In-Memory MongoDB');

  let customerToken = '';
  let approvedCustomerToken = '';
  let staffToken = '';
  let customerAccountId = '';
  let activeCustomerAccountId = '';
  let beneficiaryId = '';

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
    // 1. Register Customer
    console.log('\n[TEST GROUP 1: AUTH & RBAC]');
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Wonder',
        email: 'alice@example.com',
        password: 'Password@123',
        role: 'customer',
        phone: '+1-555-1111'
      });
    assert(regRes.status === 201, 'POST /api/auth/register -> 201 Created', regRes.status);
    assert(regRes.body.success === true, 'Response body success === true');
    assert(regRes.body.data.user.passwordHash === undefined, 'passwordHash is excluded from response');
    assert(regRes.body.data.user.kycStatus === 'pending', 'Initial kycStatus is pending');
    assert(typeof regRes.body.data.token === 'string', 'JWT token is returned');
    customerToken = regRes.body.data.token;

    // 2. Register Validation Failure
    const regValRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad-email', password: '123' });
    assert(regValRes.status === 400, 'POST /api/auth/register with bad body -> 400', regValRes.status);
    assert(regValRes.body.errorCode === 'VALIDATION_ERROR', 'Validation error code === VALIDATION_ERROR');

    // 3. Register Duplicate Conflict
    const regDupRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Wonder 2',
        email: 'alice@example.com',
        password: 'Password@123'
      });
    assert(regDupRes.status === 409, 'POST /api/auth/register duplicate email -> 409 Conflict', regDupRes.status);
    assert(regDupRes.body.errorCode === 'CONFLICT', 'Duplicate email error code === CONFLICT');

    // Register Staff
    const staffRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Officer Bob',
        email: 'bob.staff@bank.com',
        password: 'StaffPassword@123',
        role: 'staff'
      });
    staffToken = staffRegRes.body.data.token;

    // Register Approved Customer (manually approve KYC in DB for KYC lock testing)
    const appCustReg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Verified John',
        email: 'john.verified@bank.com',
        password: 'CustomerPassword@123',
        role: 'customer'
      });
    approvedCustomerToken = appCustReg.body.data.token;
    const User = require('./models/User');
    await User.findByIdAndUpdate(appCustReg.body.data.user.id, { kycStatus: 'approved' });

    // 4. Login Happy Path
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice@example.com',
        password: 'Password@123'
      });
    assert(loginRes.status === 200, 'POST /api/auth/login -> 200 OK', loginRes.status);
    assert(loginRes.body.data.token !== undefined, 'Login returns JWT');

    // 5. Login Bad Credentials
    const badLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice@example.com',
        password: 'WrongPassword'
      });
    assert(badLoginRes.status === 401, 'POST /api/auth/login bad password -> 401 Unauthorized', badLoginRes.status);
    assert(badLoginRes.body.errorCode === 'UNAUTHORIZED', 'Bad login error code === UNAUTHORIZED');

    // 6. Access without token
    const noTokenRes = await request(app).get('/api/users/me');
    assert(noTokenRes.status === 401, 'GET /api/users/me without token -> 401 Unauthorized', noTokenRes.status);
    assert(noTokenRes.body.errorCode === 'UNAUTHORIZED', 'No token error code === UNAUTHORIZED');

    // [TEST GROUP 2: USER PROFILE & KYC]
    console.log('\n[TEST GROUP 2: USER PROFILE & KYC]');
    const meRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`);
    assert(meRes.status === 200, 'GET /api/users/me -> 200 OK', meRes.status);
    assert(meRes.body.data.user.email === 'alice@example.com', 'Returns current user profile');

    // Update profile while pending
    const updatePendingRes = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ phone: '+1-555-9999', idDocumentType: 'passport', idDocumentNumber: 'PASS-12345' });
    assert(updatePendingRes.status === 200, 'PUT /api/users/me with pending KYC -> 200 OK', updatePendingRes.status);
    assert(updatePendingRes.body.data.user.phone === '+1-555-9999', 'Phone updated successfully');

    // Update profile when approved -> 409 Conflict
    const updateApprovedRes = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${approvedCustomerToken}`)
      .send({ phone: '+1-555-0000' });
    assert(updateApprovedRes.status === 409, 'PUT /api/users/me on approved KYC -> 409 Conflict', updateApprovedRes.status);
    assert(updateApprovedRes.body.errorCode === 'CONFLICT', 'Approved KYC update error code === CONFLICT');

    // [TEST GROUP 3: ACCOUNT CREATION & APPROVAL]
    console.log('\n[TEST GROUP 3: ACCOUNT CREATION & APPROVAL]');
    // Customer creates account
    const createAccRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ type: 'savings', initialDeposit: 5000, dailyTransferLimit: 50000 });
    assert(createAccRes.status === 201, 'POST /api/accounts -> 201 Created', createAccRes.status);
    assert(createAccRes.body.data.account.status === 'pending', 'New account status is pending');
    assert(createAccRes.body.data.account.accountNumber.startsWith('10'), 'Savings account number starts with 10');
    customerAccountId = createAccRes.body.data.account._id;

    // Customer lists own accounts
    const listOwnAccRes = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${customerToken}`);
    assert(listOwnAccRes.status === 200, 'GET /api/accounts (customer) -> 200 OK', listOwnAccRes.status);
    assert(listOwnAccRes.body.data.accounts.length === 1, 'Customer sees only own accounts');

    // Staff lists all accounts with pagination
    const listAllStaffAccRes = await request(app)
      .get('/api/accounts?page=1&limit=10')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(listAllStaffAccRes.status === 200, 'GET /api/accounts (staff) -> 200 OK with pagination', listAllStaffAccRes.status);
    assert(listAllStaffAccRes.body.data.pagination !== undefined, 'Pagination metadata is returned for staff');

    // Customer gets own account by ID
    const getOwnAccRes = await request(app)
      .get(`/api/accounts/${customerAccountId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert(getOwnAccRes.status === 200, 'GET /api/accounts/:id (owner) -> 200 OK', getOwnAccRes.status);

    // Other customer attempts to get account by ID -> 403 Forbidden
    const getOtherAccRes = await request(app)
      .get(`/api/accounts/${customerAccountId}`)
      .set('Authorization', `Bearer ${approvedCustomerToken}`);
    assert(getOtherAccRes.status === 403, 'GET /api/accounts/:id (non-owner customer) -> 403 Forbidden', getOtherAccRes.status);
    assert(getOtherAccRes.body.errorCode === 'FORBIDDEN', 'Ownership denial error code === FORBIDDEN');

    // Staff gets pending accounts queue
    const pendingQueueRes = await request(app)
      .get('/api/staff/pending-accounts')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(pendingQueueRes.status === 200, 'GET /api/staff/pending-accounts (staff) -> 200 OK', pendingQueueRes.status);
    assert(pendingQueueRes.body.data.items.length >= 1, 'Pending accounts queue returns pending accounts');

    // Customer tries staff pending queue -> 403 Forbidden
    const custStaffQueueRes = await request(app)
      .get('/api/staff/pending-accounts')
      .set('Authorization', `Bearer ${customerToken}`);
    assert(custStaffQueueRes.status === 403, 'GET /api/staff/pending-accounts (customer) -> 403 Forbidden', custStaffQueueRes.status);

    // Customer attempts to approve account -> 403 Forbidden
    const custApproveRes = await request(app)
      .put(`/api/accounts/${customerAccountId}/approve`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'Approved', remarks: 'Self approve' });
    assert(custApproveRes.status === 403, 'PUT /api/accounts/:id/approve (customer) -> 403 Forbidden', custApproveRes.status);

    // Staff approves account -> 200 OK & Approval record created
    const staffApproveRes = await request(app)
      .put(`/api/accounts/${customerAccountId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'Approved', remarks: 'KYC verified and approved' });
    assert(staffApproveRes.status === 200, 'PUT /api/accounts/:id/approve (staff) -> 200 OK', staffApproveRes.status);
    assert(staffApproveRes.body.data.account.status === 'active', 'Account status transitions to active');
    assert(staffApproveRes.body.data.approval !== undefined, 'Approval record is logged');
    assert(staffApproveRes.body.data.approval.decision === 'Approved', 'Approval record has decision Approved');

    // Staff attempts to re-review non-pending account -> 409 Conflict
    const reApproveRes = await request(app)
      .put(`/api/accounts/${customerAccountId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'Approved', remarks: 'Second review' });
    assert(reApproveRes.status === 409, 'PUT /api/accounts/:id/approve on active account -> 409 Conflict', reApproveRes.status);
    assert(reApproveRes.body.errorCode === 'CONFLICT', 'Re-approval error code === CONFLICT');

    // Create an active account for verified customer for beneficiary target
    const createTargetAccRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${approvedCustomerToken}`)
      .send({ type: 'current', initialDeposit: 20000 });
    const targetAccountId = createTargetAccRes.body.data.account._id;
    const targetAccNumber = createTargetAccRes.body.data.account.accountNumber;

    // Approve the target account so it is active
    await request(app)
      .put(`/api/accounts/${targetAccountId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'Approved' });

    // [TEST GROUP 4: BENEFICIARIES]
    console.log('\n[TEST GROUP 4: BENEFICIARIES]');
    // Add beneficiary (happy path)
    const addBenRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        accountId: customerAccountId,
        beneficiaryAccountNumber: targetAccNumber,
        nickname: 'John Business Account'
      });
    assert(addBenRes.status === 201, 'POST /api/beneficiaries -> 201 Created', addBenRes.status);
    assert(addBenRes.body.data.beneficiary.nickname === 'John Business Account', 'Beneficiary nickname stored correctly');
    beneficiaryId = addBenRes.body.data.beneficiary._id;

    // Add duplicate beneficiary -> 409 Conflict
    const dupBenRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        accountId: customerAccountId,
        beneficiaryAccountNumber: targetAccNumber,
        nickname: 'John Business Duplicate'
      });
    assert(dupBenRes.status === 409, 'POST /api/beneficiaries duplicate -> 409 Conflict', dupBenRes.status);
    assert(dupBenRes.body.errorCode === 'CONFLICT', 'Duplicate beneficiary error code === CONFLICT');

    // Add nonexistent beneficiary account number -> 404 Not Found
    const nonExistBenRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        accountId: customerAccountId,
        beneficiaryAccountNumber: '9999999999',
        nickname: 'Ghost'
      });
    assert(nonExistBenRes.status === 404, 'POST /api/beneficiaries non-existent account -> 404 Not Found', nonExistBenRes.status);
    assert(nonExistBenRes.body.errorCode === 'NOT_FOUND', 'Non-existent beneficiary error code === NOT_FOUND');

    // Add beneficiary using another user's accountId -> 403 Forbidden
    const unauthorizedBenRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${approvedCustomerToken}`)
      .send({
        accountId: customerAccountId,
        beneficiaryAccountNumber: targetAccNumber,
        nickname: 'Unauthorized'
      });
    assert(unauthorizedBenRes.status === 403, 'POST /api/beneficiaries non-owned source account -> 403 Forbidden', unauthorizedBenRes.status);

    // List beneficiaries
    const listBenRes = await request(app)
      .get('/api/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`);
    assert(listBenRes.status === 200, 'GET /api/beneficiaries -> 200 OK', listBenRes.status);
    assert(listBenRes.body.data.beneficiaries.length === 1, 'Beneficiary is listed');

    // Delete beneficiary
    const delBenRes = await request(app)
      .delete(`/api/beneficiaries/${beneficiaryId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert(delBenRes.status === 200, 'DELETE /api/beneficiaries/:id -> 200 OK', delBenRes.status);

    // [TEST GROUP 5: TEAMMATE STUBS (501 NOT IMPLEMENTED)]
    console.log('\n[TEST GROUP 5: TEAMMATE STUBS (501 SERVER_ERROR)]');
    const transferStub = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});
    assert(transferStub.status === 501, 'POST /api/transactions/transfer (stub) -> 501 Not Implemented', transferStub.status);

    const statementStub = await request(app)
      .get(`/api/accounts/${customerAccountId}/statement`)
      .set('Authorization', `Bearer ${customerToken}`);
    assert(statementStub.status === 501, 'GET /api/accounts/:id/statement (stub) -> 501 Not Implemented', statementStub.status);

    const freezeStub = await request(app)
      .put(`/api/accounts/${customerAccountId}/freeze`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert(freezeStub.status === 501, 'PUT /api/accounts/:id/freeze (stub) -> 501 Not Implemented', freezeStub.status);

    const flaggedStub = await request(app)
      .get('/api/staff/flagged-transactions')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(flaggedStub.status === 501, 'GET /api/staff/flagged-transactions (stub) -> 501 Not Implemented', flaggedStub.status);

    const dashboardStub = await request(app)
      .get('/api/staff/dashboard')
      .set('Authorization', `Bearer ${staffToken}`);
    assert(dashboardStub.status === 501, 'GET /api/staff/dashboard (stub) -> 501 Not Implemented', dashboardStub.status);

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
