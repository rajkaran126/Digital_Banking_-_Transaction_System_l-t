const Joi = require('joi');
const AppError = require('../utils/appError');

/**
 * Generic validation middleware using Joi schemas.
 * Validates req.body (or specified property) and returns 400 with VALIDATION_ERROR on mismatch.
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map((detail) => detail.message.replace(/['"]/g, '')).join('; ');
      return next(new AppError(errorMessage, 400, 'VALIDATION_ERROR'));
    }

    // Replace request property with validated/sanitized value
    req[property] = value;
    next();
  };
};

// Common reusable Joi schemas for the project
const schemas = {
  // Auth Schemas
  register: Joi.object({
    name: Joi.string().trim().min(2).max(100).required().messages({
      'string.empty': 'Name cannot be empty',
      'any.required': 'Name is required'
    }),
    email: Joi.string().email().trim().lowercase().required().messages({
      'string.email': 'Please enter a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Password must be at least 6 characters long',
      'any.required': 'Password is required'
    }),
    role: Joi.string().valid('customer', 'staff', 'admin').default('customer'),
    phone: Joi.string().trim().allow('', null),
    address: Joi.object({
      street: Joi.string().trim().allow('', null),
      city: Joi.string().trim().allow('', null),
      state: Joi.string().trim().allow('', null),
      postalCode: Joi.string().trim().allow('', null),
      country: Joi.string().trim().allow('', null)
    }).optional(),
    idDocumentType: Joi.string().valid('passport', 'national_id', 'drivers_license', 'pan', 'aadhaar', 'other').optional(),
    idDocumentNumber: Joi.string().trim().optional()
  }),

  login: Joi.object({
    email: Joi.string().email().trim().lowercase().required().messages({
      'string.email': 'Please enter a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().required().messages({
      'any.required': 'Password is required'
    })
  }),

  // User Profile / KYC Update Schema
  updateProfile: Joi.object({
    name: Joi.string().trim().min(2).max(100).optional(),
    phone: Joi.string().trim().optional(),
    address: Joi.object({
      street: Joi.string().trim().allow('', null),
      city: Joi.string().trim().allow('', null),
      state: Joi.string().trim().allow('', null),
      postalCode: Joi.string().trim().allow('', null),
      country: Joi.string().trim().allow('', null)
    }).optional(),
    idDocumentType: Joi.string().valid('passport', 'national_id', 'drivers_license', 'pan', 'aadhaar', 'other').optional(),
    idDocumentNumber: Joi.string().trim().optional()
  }).min(1).messages({
    'object.min': 'At least one field must be provided for update'
  }),

  // Account Schemas
  createAccount: Joi.object({
    type: Joi.string().valid('savings', 'current').required().messages({
      'any.only': 'Account type must be either savings or current',
      'any.required': 'Account type is required'
    }),
    initialDeposit: Joi.number().min(0).default(0),
    dailyTransferLimit: Joi.number().min(0).default(50000)
  }),

  approveAccount: Joi.object({
    status: Joi.string().valid('Approved', 'Rejected', 'approved', 'rejected').required().messages({
      'any.only': 'Status must be Approved or Rejected',
      'any.required': 'Approval status is required'
    }),
    remarks: Joi.string().trim().allow('').default('')
  }),

  // Beneficiary Schemas
  createBeneficiary: Joi.object({
    accountId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required().messages({
      'string.pattern.base': 'accountId must be a valid 24-character hex ObjectId',
      'any.required': 'accountId is required'
    }),
    beneficiaryAccountNumber: Joi.string().trim().required().messages({
      'any.required': 'beneficiaryAccountNumber is required'
    }),
    nickname: Joi.string().trim().max(50).required().messages({
      'any.required': 'nickname is required',
      'string.max': 'nickname cannot exceed 50 characters'
    })
  }),

  // Sprint 3 Schemas
  reviewTransaction: Joi.object({
    remarks: Joi.string().trim().max(500).required().messages({
      'string.empty': 'Remarks cannot be empty',
      'any.required': 'Remarks are required for reviewing a transaction'
    })
  }),

  freezeAccount: Joi.object({
    reason: Joi.string().trim().max(250).allow('', null).default('Suspicious transaction activity')
  })
};

module.exports = {
  validate,
  schemas
};
