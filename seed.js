require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Account = require('./models/Account');
const Beneficiary = require('./models/Beneficiary');
const Transaction = require('./models/Transaction');
const Approval = require('./models/Approval');

const seedData = async (autoDisconnect = true, onlyIfEmpty = false) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('Connected to MongoDB for seeding...');
    }

    if (onlyIfEmpty) {
      const existingUserCount = await User.countDocuments();
      if (existingUserCount > 0) {
        console.log(`Persistent database already initialized (${existingUserCount} users present). Preserving existing data.`);
        return;
      }
    }

    // Clear existing data in development
    await User.deleteMany({});
    await Account.deleteMany({});
    await Beneficiary.deleteMany({});
    await Transaction.deleteMany({});
    await Approval.deleteMany({});
    console.log('Cleared existing collections.');

    // 1. Create Admins & Staff (Indian Names)
    const admin = await User.create({
      name: 'Rajesh Sharma',
      email: 'admin@bank.com',
      passwordHash: 'Admin@123',
      role: 'admin',
      kycStatus: 'approved',
      phone: '+91-98200-11223',
      idDocumentType: 'passport',
      idDocumentNumber: 'IND-998877'
    });

    const staff1 = await User.create({
      name: 'Pooja Deshmukh (Senior Review Officer)',
      email: 'staff@bank.com',
      passwordHash: 'Staff@123',
      role: 'staff',
      kycStatus: 'approved',
      phone: '+91-98331-22334',
      idDocumentType: 'passport',
      idDocumentNumber: 'IND-443322'
    });

    const staff2 = await User.create({
      name: 'Vikram Malhotra (Compliance Officer)',
      email: 'vikram.malhotra@bank.com',
      passwordHash: 'Staff@123',
      role: 'staff',
      kycStatus: 'approved',
      phone: '+91-98110-33445',
      idDocumentType: 'passport',
      idDocumentNumber: 'IND-887766'
    });

    // 2. Create Customers (Indian Names)
    const aarav = await User.create({
      name: 'Aarav Mehta',
      email: 'aarav.mehta@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'approved',
      phone: '+91-98765-43210',
      address: {
        street: '42 MG Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India'
      },
      idDocumentType: 'passport',
      idDocumentNumber: 'P-98765432'
    });

    const priya = await User.create({
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'approved',
      phone: '+91-98234-56789',
      address: {
        street: '15 Brigade Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India'
      },
      idDocumentType: 'drivers_license',
      idDocumentNumber: 'DL-987654321'
    });

    const rohan = await User.create({
      name: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'approved',
      phone: '+91-98123-45678',
      address: {
        street: '88 Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      },
      idDocumentType: 'passport',
      idDocumentNumber: 'P-998822334'
    });

    const ananya = await User.create({
      name: 'Ananya Iyer',
      email: 'ananya.iyer@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'pending',
      phone: '+91-98450-12345',
      address: {
        street: '23 Anna Salai',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600002',
        country: 'India'
      },
      idDocumentType: 'national_id',
      idDocumentNumber: 'AADHAAR-554433'
    });

    const kavya = await User.create({
      name: 'Kavya Nair',
      email: 'kavya.nair@example.com',
      passwordHash: 'Customer@123',
      role: 'customer',
      kycStatus: 'pending',
      phone: '+91-98770-98765',
      address: {
        street: '12 Banjara Hills',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500034',
        country: 'India'
      },
      idDocumentType: 'drivers_license',
      idDocumentNumber: 'DL-112233'
    });

    // 3. Create Accounts
    // Aarav's Active Savings Account
    const aaravSavings = await Account.create({
      userId: aarav._id,
      accountNumber: '1098765432',
      type: 'savings',
      balance: 25450,
      status: 'active',
      dailyTransferLimit: 50000,
      minimumBalance: 1000
    });

    // Aarav's Active Business Current Account
    const aaravBusiness = await Account.create({
      userId: aarav._id,
      accountNumber: '2044881122',
      type: 'current',
      balance: 85200,
      status: 'active',
      dailyTransferLimit: 200000,
      minimumBalance: 5000
    });

    // Aarav's Pending Account (Awaiting Staff Review)
    const aaravPending = await Account.create({
      userId: aarav._id,
      accountNumber: '2098765432',
      type: 'current',
      balance: 12800,
      status: 'pending',
      dailyTransferLimit: 100000,
      minimumBalance: 5000
    });

    // Priya's Active Savings Account
    const priyaSavings = await Account.create({
      userId: priya._id,
      accountNumber: '1012345678',
      type: 'savings',
      balance: 18200,
      status: 'active',
      dailyTransferLimit: 50000,
      minimumBalance: 1000
    });

    // Rohan's Active Savings Account
    const rohanSavings = await Account.create({
      userId: rohan._id,
      accountNumber: '1077665544',
      type: 'savings',
      balance: 42100,
      status: 'active',
      dailyTransferLimit: 75000,
      minimumBalance: 1000
    });

    // Ananya's Pending Current Account (Awaiting Staff Review)
    const ananyaPending = await Account.create({
      userId: ananya._id,
      accountNumber: '2033445566',
      type: 'current',
      balance: 9500,
      status: 'pending',
      dailyTransferLimit: 50000,
      minimumBalance: 5000
    });

    // Kavya's Pending Savings Account (Awaiting Staff Review)
    const kavyaPending = await Account.create({
      userId: kavya._id,
      accountNumber: '1088990011',
      type: 'savings',
      balance: 4200,
      status: 'pending',
      dailyTransferLimit: 25000,
      minimumBalance: 1000
    });

    // 4. Beneficiaries
    await Beneficiary.create({
      accountId: aaravSavings._id,
      beneficiaryAccountNumber: priyaSavings.accountNumber,
      nickname: 'Priya Sharma (Savings)'
    });

    await Beneficiary.create({
      accountId: aaravSavings._id,
      beneficiaryAccountNumber: rohanSavings.accountNumber,
      nickname: 'Rohan Verma (Business Partner)'
    });

    await Beneficiary.create({
      accountId: priyaSavings._id,
      beneficiaryAccountNumber: aaravSavings.accountNumber,
      nickname: 'Aarav Mehta (Personal)'
    });

    // 5. Approvals
    await Approval.create({
      accountId: aaravSavings._id,
      staffId: staff1._id,
      decision: 'Approved',
      remarks: 'Customer KYC verified and identity confirmed. Savings account approved.'
    });

    await Approval.create({
      accountId: aaravBusiness._id,
      staffId: staff1._id,
      decision: 'Approved',
      remarks: 'Commercial documentation and corporate tax ID verified. Activated.'
    });

    await Approval.create({
      accountId: priyaSavings._id,
      staffId: staff2._id,
      decision: 'Approved',
      remarks: 'National ID verification passed. Account activated.'
    });

    await Approval.create({
      accountId: rohanSavings._id,
      staffId: staff2._id,
      decision: 'Approved',
      remarks: 'Passport verification passed without issues. Activated.'
    });

    console.log('\n=============================================');
    console.log('Dummy Data Seeded Successfully with Indian Names!');
    console.log('=============================================');
    console.log('Demo Credentials:');
    console.log('---------------------------------------------');
    console.log('1. Customer: aarav.mehta@example.com    / Customer@123 (Aarav Mehta - KYC Approved)');
    console.log('   - Active Savings:  1098765432 (₹25,450)');
    console.log('   - Active Current:  2044881122 (₹85,200)');
    console.log('   - Pending Current: 2098765432 (₹12,800)');
    console.log('2. Customer: priya.sharma@example.com   / Customer@123 (Priya Sharma - KYC Approved)');
    console.log('   - Active Savings:  1012345678 (₹18,200)');
    console.log('3. Customer: rohan.verma@example.com    / Customer@123 (Rohan Verma - KYC Approved)');
    console.log('   - Active Savings:  1077665544 (₹42,100)');
    console.log('4. Customer: ananya.iyer@example.com    / Customer@123 (Ananya Iyer - KYC Pending)');
    console.log('   - Pending Current: 2033445566 (₹9,500)');
    console.log('5. Staff:    staff@bank.com             / Staff@123 (Pooja Deshmukh)');
    console.log('6. Staff:    vikram.malhotra@bank.com   / Staff@123 (Vikram Malhotra)');
    console.log('7. Admin:    admin@bank.com             / Admin@123 (Rajesh Sharma)');
    console.log('=============================================\n');

    if (autoDisconnect) {
      await mongoose.disconnect();
      process.exit(0);
    }
  } catch (error) {
    console.error('Seeding error:', error);
    if (autoDisconnect) {
      process.exit(1);
    }
    throw error;
  }
};

if (require.main === module) {
  seedData(true);
}

module.exports = seedData;
