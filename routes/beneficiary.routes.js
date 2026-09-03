const express = require('express');
const router = express.Router();
const beneficiaryController = require('../controllers/beneficiary.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All beneficiary routes require authentication
router.use(protect);

router.post('/', validate(schemas.createBeneficiary), beneficiaryController.addBeneficiary);
router.get('/', beneficiaryController.getBeneficiaries);
router.delete('/:id', beneficiaryController.deleteBeneficiary);

module.exports = router;
