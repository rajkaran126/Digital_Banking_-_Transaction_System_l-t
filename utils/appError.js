class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    if (errorCode) {
      this.errorCode = errorCode;
    } else {
      switch (statusCode) {
        case 400:
          this.errorCode = 'VALIDATION_ERROR';
          break;
        case 401:
          this.errorCode = 'UNAUTHORIZED';
          break;
        case 403:
          this.errorCode = 'FORBIDDEN';
          break;
        case 404:
          this.errorCode = 'NOT_FOUND';
          break;
        case 409:
          this.errorCode = 'CONFLICT';
          break;
        default:
          this.errorCode = 'SERVER_ERROR';
      }
    }

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
