const getPagination = (query, defaultLimit = 10, maxLimit = 100) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = Math.max(1, parseInt(query.limit, 10) || defaultLimit);
  if (limit > maxLimit) limit = maxLimit;
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip
  };
};

const formatPaginatedResponse = (data, totalItems, page, limit) => {
  const totalPages = Math.ceil(totalItems / limit) || 1;
  return {
    items: data,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    }
  };
};

module.exports = {
  getPagination,
  formatPaginatedResponse
};
